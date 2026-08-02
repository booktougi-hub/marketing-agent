import { logger, schemaTask, tasks } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { resolveAppIconUrl } from "@/lib/favicon";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";
import { runDnaExtraction } from "@/lib/dna-extraction-core";
import { extractDocTexts } from "@/lib/supporting-docs";
import type { competitorResearch } from "@/trigger/competitor-research";
import type { DnaExtractionSource } from "@/types";

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
  source_url: z.string().url(),
  has_additional_context: z.boolean(),
  has_docs: z.boolean(),
});

export const dnaExtraction = schemaTask({
  id: "dna-extraction",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id, source_url } = payload;

    logger.info("dna-extraction: run started", { app_id, workspace_id, source_url });

    try {
      const firecrawl = createFirecrawlClient();

      let scrapedMarkdown = "";
      let iconUrl: string | null = null;
      let screenshotUrl: string | null = null;
      logger.info("dna-extraction: scraping homepage", { source_url });
      try {
        const scraped = await firecrawl.scrapeUrl(source_url, {
          // "html" is Firecrawl's cleaned main-content extraction — it
          // strips <head> entirely, so favicon <link> tags never appear
          // there. "rawHtml" is the true unprocessed source and is what
          // icon resolution below actually needs. "screenshot" (viewport
          // only, not "screenshot@fullPage") piggybacks on this same
          // request for Settings > App Identity's live-preview box — no
          // extra Firecrawl call. Secondary pages (features/pricing/docs/
          // about) are discovered and scraped separately inside
          // runDnaExtraction, markdown-only — they have no reason to
          // duplicate rawHtml/screenshot capture.
          formats: ["markdown", "rawHtml", "screenshot"],
          timeout: SCRAPE_TIMEOUT_MS,
        });
        if ("markdown" in scraped && scraped.markdown) {
          scrapedMarkdown = scraped.markdown;
        }
        if ("screenshot" in scraped && scraped.screenshot) {
          screenshotUrl = scraped.screenshot;
        }
        logger.info("dna-extraction: homepage scrape finished", {
          got_markdown: !!scrapedMarkdown,
          markdown_length: scrapedMarkdown.length,
          got_screenshot: !!screenshotUrl,
        });

        // Favicon/logo resolution failing is never fatal to DNA extraction —
        // worst case the UI falls back to a first-letter avatar.
        try {
          iconUrl = await resolveAppIconUrl({
            html: "rawHtml" in scraped ? scraped.rawHtml : null,
            ogImage: "metadata" in scraped ? scraped.metadata?.ogImage : null,
            sourceUrl: source_url,
          });
          logger.info("dna-extraction: icon resolution finished", { found: !!iconUrl, iconUrl });
        } catch (err) {
          logger.warn("dna-extraction: icon resolution failed, continuing without an icon", {
            source_url,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } catch (err) {
        logger.warn("dna-extraction: Firecrawl homepage scrape failed, continuing with other sources", {
          source_url,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Step 2A — additional context
      logger.info("dna-extraction: loading app record", { app_id });
      const { data: appRow, error: appRowError } = await supabaseAdmin
        .from("apps")
        .select("additional_context, doc_paths")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appRowError) {
        throw new Error(`Failed to load app record: ${appRowError.message}`);
      }

      const additionalContext: string | null =
        appRow.additional_context?.trim() || null;

      // Step 2B — extract text from uploaded documents
      const docPaths: string[] = appRow.doc_paths ?? [];
      logger.info("dna-extraction: extracting supporting documents", {
        doc_count: docPaths.length,
      });
      const docTexts = await extractDocTexts(docPaths);
      logger.info("dna-extraction: document extraction finished", {
        extracted_count: docTexts.length,
      });

      logger.info(
        `DNA extraction used: homepage scrape ${scrapedMarkdown ? "yes" : "no"} + additional context ${additionalContext ? "yes" : "no"} + ${docTexts.length} documents`
      );

      const { dna, secondaryPageCount } = await runDnaExtraction({
        appId: app_id,
        workspaceId: workspace_id,
        sourceUrl: source_url,
        homepageMarkdown: scrapedMarkdown,
        additionalContext,
        docTexts,
        jobName: "dna-extraction",
      });

      logger.info("dna-extraction: DNA parsed successfully", {
        name: dna.name,
        secondary_page_count: secondaryPageCount,
      });

      // A full pipeline run (initial onboarding, or Settings > App
      // Identity's "Re-analyse App") is a deliberate full restart — every
      // field it produces is fresh and marked "auto", which does mean any
      // manual edit made on the Product Information page is overwritten
      // here. That's expected for this specific action (it also pauses the
      // app and supersedes the active strategy — see
      // app/api/apps/[id]/reanalyse/route.ts); only the narrower
      // trigger/dna-reextraction.ts (Product Information page's own
      // "Re-analyze") respects per-field manual edits.
      const dnaExtractionSource: DnaExtractionSource = Object.fromEntries(
        Object.keys(dna).map((key) => [key, "auto" as const])
      );

      await supabaseAdmin
        .from("apps")
        .update({
          name: dna.name,
          dna,
          dna_extraction_source: dnaExtractionSource,
          status: "competitor_research_pending",
          // Only overwrite icon_url/screenshot_url when a new one was
          // actually found this run — a transient resolution/scrape
          // failure on a later re-analysis shouldn't null out an icon or
          // screenshot that was already found before.
          ...(iconUrl ? { icon_url: iconUrl } : {}),
          ...(screenshotUrl ? { screenshot_url: screenshotUrl } : {}),
        })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      logger.info("dna-extraction: app row updated to competitor_research_pending", { app_id });

      // Diagnosis-first pipeline (PHASES.md, 2026-07-14): dna-extraction no
      // longer triggers strategy-generation directly — competitor-research
      // runs first, then diagnosis, and strategy-generation only fires once
      // the founder acknowledges the diagnosis (see
      // PATCH /api/apps/[id]/acknowledge-diagnosis).
      const competitorResearchHandle = await tasks.trigger<typeof competitorResearch>("competitor-research", {
        app_id,
        workspace_id,
      });

      // Replaces this run's own tracking with the chained job's — dna-
      // extraction is done, so from here trigger/job-watchdog.ts should be
      // watching competitor-research instead.
      await supabaseAdmin
        .from("apps")
        .update({ pending_run_id: competitorResearchHandle.id, pending_run_task: "competitor-research" })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      logger.info("dna-extraction: competitor-research triggered", { app_id });

      return { app_id, status: "competitor_research_pending" as const };
    } catch (err) {
      await handleJobError(err, { appId: app_id, workspaceId: workspace_id, jobName: "dna-extraction" });
      throw err;
    }
  },
});
