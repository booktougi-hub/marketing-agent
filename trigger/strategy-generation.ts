import { logger, schemaTask } from "@trigger.dev/sdk";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { AppDna } from "@/types";

const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

const personaSchema = z.object({
  name: z.string(),
  role: z.string(),
  pain_points: z.array(z.string()),
  where_they_hang_out: z.array(z.string()),
});

const contentPillarSchema = z.object({
  name: z.string(),
  description: z.string(),
  example_topics: z.array(z.string()),
});

const strategySchema = z.object({
  personas: z.array(personaSchema),
  content_pillars: z.array(contentPillarSchema),
  tone: z.string(),
  channels: z.array(z.string()),
  twitter_strategy: z.string(),
  linkedin_strategy: z.string(),
});

const SYSTEM_PROMPT = `You are a marketing strategist creating a go-to-market content strategy for a software product.

You are given the product's extracted DNA (name, tagline, problem, features, target audience, pricing, competitors, tone). The developer may also provide additional notes directly — when present, prioritise those notes alongside the DNA since they come straight from the person who built the product.

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "personas": [{ "name": string, "role": string, "pain_points": string[], "where_they_hang_out": string[] }],
  "content_pillars": [{ "name": string, "description": string, "example_topics": string[] }],
  "tone": string,
  "channels": string[],
  "twitter_strategy": string,
  "linkedin_strategy": string
}

Generate exactly 3 personas and exactly 5 content pillars. "channels" should only include platforms this product should actually be marketed on for V1: "twitter" and/or "linkedin".`;

export const strategyGeneration = schemaTask({
  id: "strategy-generation",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;

    try {
      const { data: app, error: appError } = await supabaseAdmin
        .from("apps")
        .select("dna, additional_context")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appError) {
        throw new Error(`Failed to load app record: ${appError.message}`);
      }

      if (!app.dna) {
        throw new Error("App has no DNA to build a strategy from.");
      }

      const dna = app.dna as AppDna;

      const userMessage = `=== APP DNA ===
${JSON.stringify(dna, null, 2)}
${
  app.additional_context
    ? `
=== ADDITIONAL DEVELOPER NOTES ===
${app.additional_context}

Use this additional context to make the strategy more specific and accurate. The developer has told you directly what their app does — prioritise this alongside the extracted DNA.`
    : ""
}`;

      const message = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      let responseText = "";
      for (const block of message.content) {
        if (block.type === "text") {
          responseText += block.text;
        }
      }
      responseText = responseText
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "");

      let strategy: z.infer<typeof strategySchema>;
      try {
        strategy = strategySchema.parse(JSON.parse(responseText));
      } catch (err) {
        throw new Error(
          `Claude returned an unparseable strategy object: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      const { error: insertError } = await supabaseAdmin.from("strategies").insert({
        app_id,
        workspace_id,
        personas: strategy.personas,
        content_pillars: strategy.content_pillars,
        tone: strategy.tone,
        channels: strategy.channels,
        twitter_strategy: strategy.twitter_strategy,
        linkedin_strategy: strategy.linkedin_strategy,
        status: "draft",
      });

      if (insertError) {
        throw new Error(`Failed to save strategy: ${insertError.message}`);
      }

      await supabaseAdmin
        .from("apps")
        .update({ status: "awaiting_approval" })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      return { app_id, status: "awaiting_approval" as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Strategy generation failed.";
      logger.error("strategy-generation failed", { app_id, workspace_id, error: message });

      await supabaseAdmin
        .from("apps")
        .update({ status: "error", error_message: message })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      throw err;
    }
  },
});
