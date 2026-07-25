import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { callExternalService, ExternalServiceError } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import type { AppDna, DiagnosisData } from "@/types";

const CLAUDE_MODEL = "claude-sonnet-5";

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
  // Free-text correction the founder typed on the diagnosis screen (only
  // shown when confidence was 'low') — folded into this call as additional
  // context so it actually influences the resulting strategy, per
  // PATCH /api/apps/[id]/acknowledge-diagnosis.
  diagnosis_correction: z.string().nullable().optional(),
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

// Diagnosis-first redesign (PHASES.md, 2026-07-14): the diagnosis
// (bottleneck + primary_lever) is now the headline of the strategy, not the
// DNA in isolation. Personas and pillars exist to execute the diagnosed
// lever, not as a generic 5-pillar template unrelated to it.
const SYSTEM_PROMPT = `You are a marketing strategist turning a growth diagnosis into an executable content strategy for a software product.

You are given: the product's DNA, a growth diagnosis (the single biggest bottleneck holding this product back, why, and the one primary lever recommended to address it), and real competitor research the diagnosis was based on.

The diagnosis and primary_lever are the headline of this strategy, not background color. Every persona and content pillar you generate must visibly serve the primary_lever and address the diagnosed bottleneck — do not produce a generic 5-pillar template that ignores the diagnosis. For example, if the bottleneck is "trust" and the primary_lever is "publish comparison content showing why you're a safer choice than [competitor]", your content pillars must include comparison/trust-building content by name, not just generically-relevant topics. If the bottleneck is "awareness", pillars and channel choices should prioritize reach and discovery over conversion-focused content. If "activation", pillars should focus on onboarding clarity, quick wins, and reducing time-to-value. If "distribution", pillars and channels should target wherever the diagnosis says the real buyers actually gather.

The developer may also provide additional notes or a correction to the diagnosis directly — when present, prioritise those alongside the DNA and diagnosis since they come straight from the person who built the product and know things Claude doesn't.

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "personas": [{ "name": string, "role": string, "pain_points": string[], "where_they_hang_out": string[] }],
  "content_pillars": [{ "name": string, "description": string, "example_topics": string[] }],
  "tone": string,
  "channels": string[],
  "twitter_strategy": string,
  "linkedin_strategy": string
}

Generate exactly 3 personas and exactly 5 content pillars, but make sure at least the majority of the pillars are direct executions of the primary_lever — not a checklist of unrelated generic content types. "channels" should only include platforms this product should actually be marketed on for V1: "twitter" and/or "linkedin".`;

export const strategyGeneration = schemaTask({
  id: "strategy-generation",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id, diagnosis_correction } = payload;

    try {
      const anthropic = createAnthropicClient();

      const { data: app, error: appError } = await supabaseAdmin
        .from("apps")
        .select("dna, additional_context, diagnosis")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appError) {
        throw new Error(`Failed to load app record: ${appError.message}`);
      }

      if (!app.dna) {
        throw new Error("App has no DNA to build a strategy from.");
      }

      if (!app.diagnosis) {
        // Required input, not optional context — strategy-generation should
        // only ever run after diagnosis.ts has completed (via the
        // acknowledge-diagnosis route). A missing diagnosis here means the
        // pipeline was called out of order.
        throw new Error("App has no diagnosis to build a strategy from.");
      }

      const dna = app.dna as AppDna;
      const diagnosisData = app.diagnosis as DiagnosisData;

      const userMessage = `=== GROWTH DIAGNOSIS (build the strategy around this) ===
${JSON.stringify(diagnosisData, null, 2)}

=== APP DNA ===
${JSON.stringify(dna, null, 2)}
${
  app.additional_context
    ? `
=== ADDITIONAL DEVELOPER NOTES ===
${app.additional_context}

Use this additional context to make the strategy more specific and accurate. The developer has told you directly what their app does — prioritise this alongside the extracted DNA.`
    : ""
}${
        diagnosis_correction
          ? `
=== FOUNDER'S CORRECTION TO THE DIAGNOSIS (prioritize this over the diagnosis above where they conflict) ===
${diagnosis_correction}`
          : ""
      }`;

      const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
        anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        })
      );

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
        logger.error("strategy-generation: failed to parse Claude's response", {
          raw_response: responseText.slice(0, 2000),
          error: err instanceof Error ? err.message : String(err),
        });
        throw new ExternalServiceError(ErrorMessages.external.CLAUDE_FAILED, "claude");
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
        diagnosis_snapshot: diagnosisData,
        built_from_diagnosis: true,
      });

      if (insertError) {
        throw new Error(`Failed to save strategy: ${insertError.message}`);
      }

      await supabaseAdmin
        .from("apps")
        .update({ status: "awaiting_approval", pending_run_id: null, pending_run_task: null })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      return { app_id, status: "awaiting_approval" as const };
    } catch (err) {
      await handleJobError(err, { appId: app_id, workspaceId: workspace_id, jobName: "strategy-generation" });
      throw err;
    }
  },
});
