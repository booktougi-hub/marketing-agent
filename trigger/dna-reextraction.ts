import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";
import { runDnaExtraction } from "@/lib/dna-extraction-core";
import { extractDocTexts } from "@/lib/supporting-docs";
import type { AppDna, DnaExtractionSource } from "@/types";

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

// The narrow, non-pipeline counterpart to trigger/dna-extraction.ts —
// triggered only from the Product Information page's own "Re-analyze"
// button (via the credit-gated "dna_reextraction" agent action), same
// relationship trigger/brand-info-extraction.ts has to the full onboarding
// pipeline. Re-crawls and re-extracts only the `dna` JSON column: never
// touches apps.status/pending_run_id/pending_run_task, never triggers
// competitor-research or diagnosis, never pauses the app or supersedes the
// active strategy, and never overwrites a field the customer has manually
// edited on the Product Information page (tracked via
// apps.dna_extraction_source, same "auto"/"manual" mechanism as
// brand_information.extraction_source). Settings > App Identity's
// "Re-analyse App" (trigger/dna-extraction.ts, full pipeline restart)
// remains the heavier option and does not carry this manual-edit
// protection — that's a deliberate full restart, this is a gentle refresh.
export const dnaReextraction = schemaTask({
  id: "dna-reextraction",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;

    logger.info("dna-reextraction: run started", { app_id, workspace_id });

    try {
      const { data: appRow, error: appRowError } = await supabaseAdmin
        .from("apps")
        .select("source_url, dna, dna_extraction_source, additional_context, doc_paths")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appRowError || !appRow) {
        throw new Error(`Failed to load app record for dna-reextraction: ${appRowError?.message}`);
      }
      if (!appRow.dna) {
        throw new Error(`App ${app_id} has no existing DNA — run the initial extraction before re-extracting.`);
      }

      const sourceUrl = appRow.source_url as string;
      const existingDna = appRow.dna as AppDna;
      const existingSource: DnaExtractionSource = (appRow.dna_extraction_source ?? {}) as DnaExtractionSource;

      const firecrawl = createFirecrawlClient();

      let homepageMarkdown = "";
      logger.info("dna-reextraction: scraping homepage", { sourceUrl });
      try {
        const homepage = await firecrawl.scrapeUrl(sourceUrl, {
          formats: ["markdown"],
          timeout: SCRAPE_TIMEOUT_MS,
        });
        if ("markdown" in homepage && homepage.markdown) {
          homepageMarkdown = homepage.markdown;
        }
        logger.info("dna-reextraction: homepage scrape finished", {
          got_markdown: !!homepageMarkdown,
          markdown_length: homepageMarkdown.length,
        });
      } catch (err) {
        logger.warn("dna-reextraction: homepage scrape failed, continuing with other sources", {
          sourceUrl,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const additionalContext: string | null = (appRow.additional_context as string | null)?.trim() || null;
      const docPaths: string[] = (appRow.doc_paths as string[] | null) ?? [];
      const docTexts = await extractDocTexts(docPaths);

      const { dna: freshDna, secondaryPageCount } = await runDnaExtraction({
        appId: app_id,
        workspaceId: workspace_id,
        sourceUrl,
        homepageMarkdown,
        additionalContext,
        docTexts,
        jobName: "dna-reextraction",
      });

      logger.info("dna-reextraction: fresh DNA parsed successfully", {
        name: freshDna.name,
        secondary_page_count: secondaryPageCount,
      });

      // Field-level merge — never overwrite a key the customer has already
      // marked "manual" by editing it on the Product Information page. Any
      // key of AppDna not present in freshDna (shouldn't happen given the
      // schema, but defensive) simply keeps whatever existingDna already had.
      const mergedDna: AppDna = { ...existingDna };
      const nextSource: DnaExtractionSource = { ...existingSource };

      for (const key of Object.keys(freshDna) as (keyof AppDna)[]) {
        if (existingSource[key] === "manual") continue;
        (mergedDna as unknown as Record<string, unknown>)[key] = freshDna[key];
        nextSource[key] = "auto";
      }

      const { error: updateError } = await supabaseAdmin
        .from("apps")
        .update({
          dna: mergedDna,
          dna_extraction_source: nextSource,
          dna_reextraction_status: "complete",
          dna_reextraction_error: null,
          dna_reextraction_pending_run_id: null,
        })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      if (updateError) {
        throw new Error(`Failed to save re-extracted DNA: ${updateError.message}`);
      }

      logger.info("dna-reextraction: saved successfully", { app_id });

      return { app_id, status: "complete" as const };
    } catch (err) {
      // Side/enrichment job, not one of the three pipeline-blocking jobs —
      // never touches apps.status. Its own dna_reextraction_status/
      // dna_reextraction_error columns play that role for this narrow job
      // instead (see SCHEMA.md).
      await handleJobError(err, {
        appId: app_id,
        workspaceId: workspace_id,
        jobName: "dna-reextraction",
        updateAppStatus: false,
      });

      const message = err instanceof Error ? err.message : ErrorMessages.generic.UNKNOWN;
      await supabaseAdmin
        .from("apps")
        .update({
          dna_reextraction_status: "error",
          dna_reextraction_error: message,
          dna_reextraction_pending_run_id: null,
        })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      throw err;
    }
  },
});
