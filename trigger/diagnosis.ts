import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { callExternalService, ExternalServiceError } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import type { AppDna, CompetitorResearch } from "@/types";

// Spec called for "claude-sonnet-4-20250514" — CLAUDE.md is explicit and
// non-negotiable: always claude-sonnet-5, never a different model string.
const CLAUDE_MODEL = "claude-sonnet-5";

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

// Exported so trigger/diagnosis-refresh-check.ts's proposed_diagnosis is
// structurally guaranteed to match this task's own diagnosis output shape —
// one schema, not a hand-copied duplicate that could drift.
export const diagnosisSchema = z.object({
  bottleneck: z.enum(["awareness", "trust", "activation", "distribution"]),
  reasoning: z.string(),
  competitive_context: z.string(),
  primary_lever: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});

const SYSTEM_PROMPT = `You are an experienced startup growth advisor doing a real diagnostic session for a founder — not a content generator producing marketing copy. Your job is to identify the single most likely reason this specific product isn't growing faster, grounded in real evidence, not to produce generic startup advice.

You'll be given the product's DNA (name, tagline, problem, features, target audience, pricing, tone) and real research on 0-3 of its actual competitors (what they do, their pricing, their positioning — scraped from their own real sites, when available).

Diagnose the single most likely growth bottleneck:
- "awareness" — nobody knows this product exists yet
- "trust" — people find it but don't believe the value or don't trust it enough to convert
- "activation" — people sign up but don't experience the core value fast enough to stick
- "distribution" — the product itself is fine, but there's no channel where its actual buyers already gather

Rules for your response:
- The reasoning MUST cite a specific, real detail from the DNA or the competitor research — never a generic statement that could apply to any product. "Your competitor X offers a free tier and yours does not, which likely creates a trust/activation barrier at signup" is the bar. "You should focus on awareness" with no supporting reason is not acceptable and will be rejected.
- competitive_context must state explicitly what is different, better, or worse about this app compared to the real competitors found — by name, when competitor research is available. If no competitor research is available, say so plainly and reason from the DNA and target audience alone instead of inventing a comparison.
- primary_lever is ONE specific, high-leverage recommendation — not a list, not five generic pillars. It should be the single change in marketing approach that most directly addresses the diagnosed bottleneck.
- confidence should honestly reflect how much real evidence you actually had. If competitor research is thin or absent, or the DNA itself is sparse, say "low" — don't inflate confidence to sound more authoritative.

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "bottleneck": "awareness" | "trust" | "activation" | "distribution",
  "reasoning": string,
  "competitive_context": string,
  "primary_lever": string,
  "confidence": "high" | "medium" | "low"
}`;

function formatCompetitorResearch(rows: CompetitorResearch[]): string {
  if (rows.length === 0) {
    return "No competitor research was found for this app — reason from the DNA and target audience alone, and say so plainly in competitive_context rather than inventing a comparison.";
  }
  return rows
    .map(
      (r) =>
        `- ${r.competitor_name ?? "Unknown"} (${r.competitor_url ?? "no URL"})\n  What they do: ${r.scraped_summary ?? "unknown"}\n  Pricing: ${r.pricing_notes ?? "unknown"}\n  Positioning: ${r.positioning_notes ?? "unknown"}`
    )
    .join("\n\n");
}

export const diagnosis = schemaTask({
  id: "diagnosis",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;
    logger.info("diagnosis: run started", { app_id, workspace_id });

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
        throw new Error("App has no DNA to diagnose from.");
      }

      const dna = app.dna as AppDna;

      const { data: competitorRows } = await supabaseAdmin
        .from("competitor_research")
        .select("*")
        .eq("app_id", app_id)
        .eq("workspace_id", workspace_id)
        .order("created_at", { ascending: false });

      const competitors = (competitorRows ?? []) as CompetitorResearch[];

      const userMessage = `=== APP DNA ===
${JSON.stringify(dna, null, 2)}
${app.additional_context ? `\n=== ADDITIONAL DEVELOPER NOTES ===\n${app.additional_context}` : ""}

=== REAL COMPETITOR RESEARCH ===
${formatCompetitorResearch(competitors)}`;

      const anthropic = createAnthropicClient();
      const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
        anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        })
      );

      let responseText = "";
      for (const block of message.content) {
        if (block.type === "text") responseText += block.text;
      }
      responseText = responseText
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "");

      let diagnosisData: z.infer<typeof diagnosisSchema>;
      try {
        diagnosisData = diagnosisSchema.parse(JSON.parse(responseText));
      } catch (err) {
        logger.error("diagnosis: failed to parse Claude's response", {
          app_id,
          raw_response: responseText.slice(0, 2000),
          error: err instanceof Error ? err.message : String(err),
        });
        throw new ExternalServiceError(ErrorMessages.external.CLAUDE_FAILED, "claude");
      }

      logger.info(`diagnosis: diagnosed app ${app_id} as bottleneck="${diagnosisData.bottleneck}" confidence="${diagnosisData.confidence}"`, {
        app_id,
        bottleneck: diagnosisData.bottleneck,
        confidence: diagnosisData.confidence,
        competitorCount: competitors.length,
      });

      // Deliberate checkpoint — status goes to 'diagnosis_ready' and stays
      // there until the founder acknowledges it via
      // PATCH /api/apps/[id]/acknowledge-diagnosis, which is what triggers
      // strategy-generation. Nothing here auto-advances past this point, so
      // pending_run_id/task are cleared — no job is actually running while
      // we wait on the user, same as 'awaiting_approval' after
      // strategy-generation.
      await supabaseAdmin
        .from("apps")
        .update({
          diagnosis: diagnosisData,
          diagnosis_status: "shown",
          status: "diagnosis_ready",
          pending_run_id: null,
          pending_run_task: null,
        })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      return { app_id, status: "diagnosis_ready" as const };
    } catch (err) {
      await handleJobError(err, { appId: app_id, workspaceId: workspace_id, jobName: "diagnosis" });
      throw err;
    }
  },
});
