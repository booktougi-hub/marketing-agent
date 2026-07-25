import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { discoverAndSummarizeCompetitors, type DiscoveredCompetitor } from "@/lib/competitor-discovery";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { callExternalService, ExternalServiceError } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { diagnosisSchema } from "@/trigger/diagnosis";
import type { AppDna, CompetitorResearch, DiagnosisData, ProductType } from "@/types";

const CLAUDE_MODEL = "claude-sonnet-5";

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

const assessmentSchema = z.object({
  material_change_detected: z.boolean(),
  change_summary: z.string().nullable(),
  proposed_diagnosis: diagnosisSchema.nullable(),
});

const SYSTEM_PROMPT = `You are an experienced startup growth advisor doing a quarterly check-in on a diagnosis you wrote for a founder previously — deciding whether anything has genuinely changed enough to revisit it, not producing a fresh diagnosis from scratch every time.

You'll be given: the founder's CURRENT diagnosis (bottleneck, reasoning, competitive_context, primary_lever, confidence), the competitor research it was based on, freshly re-researched competitor data gathered just now, the product's DNA, and freshly re-scraped homepage content compared against that DNA.

The stored and fresh competitor lists were gathered independently (separate searches, possibly weeks apart) — the same real competitor can appear with a slightly different name string each time (a year suffix like "2026" added or dropped, "& More" appended, punctuation differences, a listing platform prefix). Before judging anything, first match each fresh competitor to its most likely counterpart in the stored list by what the product actually IS (its URL/app-store package id if both have one, and what scraped_summary/positioning_notes describe) — not by exact string equality. Only treat a fresh competitor as genuinely NEW if it doesn't plausibly correspond to anything in the stored list at all.

Decide "material_change_detected" using a high bar — set it true ONLY if something would plausibly change the diagnosed bottleneck, the competitive_context, or the primary_lever itself:
- A genuinely new named competitor appeared that wasn't in the original research.
- An existing competitor's pricing or packaging changed in a real, substantive way (a new tier, a materially different price point, free tier added/removed) — not just reworded marketing copy describing the same offer.
- The app's own homepage now describes meaningfully different pricing, positioning, or core features than what's in the stored DNA — not just copy edits that say the same thing differently.

Do NOT flag cosmetic or trivial differences: rewritten headlines that mean the same thing, minor wording changes, formatting differences, or noise from an imperfect scrape. If you're not confident something is a REAL substantive change, set material_change_detected to false.

If material_change_detected is true:
- "change_summary" must be plain-language, specific, and must directly reference the founder's actual current bottleneck, reasoning, and primary_lever by their real content (not paraphrased vaguely) — explain concretely why the new evidence affects THAT specific diagnosis, not growth diagnosis in general.
- "proposed_diagnosis" must be a complete new diagnosis in the exact same shape and held to the exact same rules as an original diagnosis: reasoning must cite a specific real detail (from DNA or competitor research); competitive_context must name real competitors when available; primary_lever is ONE specific high-leverage recommendation, not a list; confidence must honestly reflect how much real evidence you had.

If material_change_detected is false, set change_summary and proposed_diagnosis to null.

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "material_change_detected": boolean,
  "change_summary": string | null,
  "proposed_diagnosis": { "bottleneck": "awareness" | "trust" | "activation" | "distribution", "reasoning": string, "competitive_context": string, "primary_lever": string, "confidence": "high" | "medium" | "low" } | null
}`;

function formatCompetitors(label: string, rows: Array<{ name: string | null; url: string | null; pricing_notes: string | null; positioning_notes: string | null; scraped_summary: string | null }>): string {
  if (rows.length === 0) return `${label}: none`;
  return `${label}:\n${rows
    .map((r) => `- ${r.name ?? "Unknown"} (${r.url ?? "no URL"})\n  What they do: ${r.scraped_summary ?? "unknown"}\n  Pricing: ${r.pricing_notes ?? "unknown"}\n  Positioning: ${r.positioning_notes ?? "unknown"}`)
    .join("\n")}`;
}

export const diagnosisRefreshCheck = schemaTask({
  id: "diagnosis-refresh-check",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;
    logger.info("diagnosis-refresh-check: run started", { app_id, workspace_id });

    try {
      const { data: app, error: appError } = await supabaseAdmin
        .from("apps")
        .select("dna, product_type, additional_context, source_url, diagnosis, diagnosis_status")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appError) {
        throw new Error(`Failed to load app record: ${appError.message}`);
      }

      // Only re-examine apps that have completed the initial diagnosis-first
      // onboarding flow — an app still mid-onboarding has no diagnosis yet
      // for this to refresh.
      if (!app.dna || !app.diagnosis || app.diagnosis_status !== "acknowledged") {
        logger.info(`diagnosis-refresh-check: app ${app_id} has no acknowledged diagnosis yet, skipping`, {
          app_id,
          diagnosis_status: app.diagnosis_status,
        });
        return { app_id, skipped: true as const };
      }

      const dna = app.dna as AppDna;
      const productType = (app.product_type as ProductType) ?? "other";
      const originalDiagnosis = app.diagnosis as DiagnosisData;

      const { data: storedRows } = await supabaseAdmin
        .from("competitor_research")
        .select("*")
        .eq("app_id", app_id)
        .eq("workspace_id", workspace_id)
        .order("created_at", { ascending: false });

      const storedCompetitors = (storedRows ?? []) as CompetitorResearch[];

      // Reuses the exact same discovery logic trigger/competitor-research.ts
      // runs at onboarding — see lib/competitor-discovery.ts — but only for
      // a fresh comparison snapshot, never inserted or chained into
      // diagnosis directly the way the onboarding job does.
      const freshCompetitors: DiscoveredCompetitor[] = await discoverAndSummarizeCompetitors(
        dna,
        productType,
        app.additional_context,
        app_id
      );

      let freshHomepageMarkdown = "";
      try {
        const firecrawl = createFirecrawlClient();
        const scraped = await firecrawl.scrapeUrl(app.source_url, {
          formats: ["markdown"],
          timeout: SCRAPE_TIMEOUT_MS,
        });
        if ("markdown" in scraped && scraped.markdown) freshHomepageMarkdown = scraped.markdown;
      } catch (err) {
        // Non-fatal — the comparison still has competitor data to go on
        // even without a fresh homepage scrape.
        logger.warn(`diagnosis-refresh-check: homepage re-scrape failed for app ${app_id}, continuing without it`, {
          app_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const userMessage = `=== FOUNDER'S CURRENT DIAGNOSIS ===
${JSON.stringify(originalDiagnosis, null, 2)}

=== APP DNA (as last extracted) ===
${JSON.stringify(dna, null, 2)}

=== ORIGINAL COMPETITOR RESEARCH (what the current diagnosis was based on) ===
${formatCompetitors("Stored competitors", storedCompetitors.map((r) => ({
  name: r.competitor_name,
  url: r.competitor_url,
  pricing_notes: r.pricing_notes,
  positioning_notes: r.positioning_notes,
  scraped_summary: r.scraped_summary,
})))}

=== FRESH COMPETITOR RESEARCH (just re-gathered) ===
${formatCompetitors("Fresh competitors", freshCompetitors.map((c) => ({
  name: c.name,
  url: c.url,
  pricing_notes: c.pricing_notes,
  positioning_notes: c.positioning_notes,
  scraped_summary: c.scraped_summary,
})))}

=== FRESHLY RE-SCRAPED HOMEPAGE (compare at a high level against the DNA above — not word-for-word) ===
${freshHomepageMarkdown ? freshHomepageMarkdown.slice(0, 4000) : "(homepage re-scrape failed or returned nothing — reason from competitor data alone)"}`;

      const anthropic = createAnthropicClient();
      const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
        anthropic.messages.create({
          model: CLAUDE_MODEL,
          // Output includes both a written change_summary AND a full
          // proposed_diagnosis (same shape as diagnosis.ts's own output) —
          // 1536 was observed truncating valid JSON mid-string during
          // testing, so this gives real headroom above diagnosis.ts's 1024
          // (which only ever emits one diagnosis, no summary alongside it).
          max_tokens: 2048,
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

      let assessment: z.infer<typeof assessmentSchema>;
      try {
        assessment = assessmentSchema.parse(JSON.parse(responseText));
      } catch (err) {
        logger.error("diagnosis-refresh-check: failed to parse Claude's response", {
          app_id,
          raw_response: responseText.slice(0, 2000),
          error: err instanceof Error ? err.message : String(err),
        });
        throw new ExternalServiceError(ErrorMessages.external.CLAUDE_FAILED, "claude");
      }

      const nowIso = new Date().toISOString();

      if (!assessment.material_change_detected || !assessment.change_summary || !assessment.proposed_diagnosis) {
        logger.info(`diagnosis-refresh-check: no significant changes detected for app ${app_id}`, { app_id });
        await supabaseAdmin
          .from("apps")
          .update({ last_diagnosis_refresh_at: nowIso })
          .eq("id", app_id)
          .eq("workspace_id", workspace_id);
        return { app_id, materialChange: false as const };
      }

      logger.info(`diagnosis-refresh-check: material change detected for app ${app_id}, saving proposal`, {
        app_id,
        proposedBottleneck: assessment.proposed_diagnosis.bottleneck,
      });

      const { error: insertError } = await supabaseAdmin.from("diagnosis_proposals").insert({
        app_id,
        workspace_id,
        change_summary: assessment.change_summary,
        proposed_diagnosis: assessment.proposed_diagnosis,
        status: "pending",
      });

      if (insertError) {
        throw new Error(`Failed to save diagnosis proposal: ${insertError.message}`);
      }

      await supabaseAdmin
        .from("apps")
        .update({ diagnosis_refresh_status: "proposal_ready", last_diagnosis_refresh_at: nowIso })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      return { app_id, materialChange: true as const };
    } catch (err) {
      await handleJobError(err, { appId: app_id, workspaceId: workspace_id, jobName: "diagnosis-refresh-check" });
      throw err;
    }
  },
});
