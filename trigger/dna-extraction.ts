import { logger, schemaTask, tasks } from "@trigger.dev/sdk";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { resolveAppIconUrl } from "@/lib/favicon";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { callExternalService, ExternalServiceError } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";
import { MODELS } from "@/lib/ai/models";
import type { competitorResearch } from "@/trigger/competitor-research";

const CLAUDE_MODEL: string = MODELS.STANDARD;

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
  source_url: z.string().url(),
  has_additional_context: z.boolean(),
  has_docs: z.boolean(),
});

const dnaSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  problem: z.string(),
  features: z.array(z.string()),
  target_audience: z.string(),
  pricing: z.string(),
  competitors: z.array(z.string()),
  tone: z.enum(["casual", "professional", "technical"]),
  additional_urls: z.array(z.string()),
  app_store_urls: z.object({
    play_store: z.string().nullable(),
    app_store: z.string().nullable(),
  }),
});

const SYSTEM_PROMPT = `You are extracting a structured "DNA" profile for a software product from raw source material.

You may receive content from multiple sources: the app website, additional context provided by the developer, and supporting documents. Use all sources together to extract the most accurate and complete information.

Many sites are landing/marketing pages whose actual product is a mobile app — look for "Get it on Google Play" / "Download on the App Store" badges or links to play.google.com or apps.apple.com anywhere in the content, even if the page otherwise reads like a normal website. This matters regardless of what the developer may have labeled the product as — a page can be a mobile app's marketing site even when nothing else about it looks like one.

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "name": string,
  "tagline": string,
  "problem": string,
  "features": string[],
  "target_audience": string,
  "pricing": string,
  "competitors": string[],
  "tone": "casual" | "professional" | "technical",
  "additional_urls": string[],
  "app_store_urls": { "play_store": string | null, "app_store": string | null }  // the actual URLs found in the content, or null if that store isn't linked — never invent a URL that isn't present in the source material
}`;

function getExtension(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

async function extractDocText(path: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from("app-docs")
    .download(path);

  if (error || !data) {
    logger.error("Failed to download supporting document", {
      path,
      error: error?.message,
    });
    return null;
  }

  const extension = getExtension(path);

  try {
    if (extension === "pdf") {
      const buffer = Buffer.from(await data.arrayBuffer());
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();
      return result.text;
    }

    if (extension === "docx") {
      const buffer = Buffer.from(await data.arrayBuffer());
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    if (extension === "txt" || extension === "md") {
      return await data.text();
    }

    logger.warn("Unsupported document type, skipping", { path, extension });
    return null;
  } catch (err) {
    logger.error("Failed to extract text from document", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export const dnaExtraction = schemaTask({
  id: "dna-extraction",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id, source_url } = payload;

    logger.info("dna-extraction: run started", { app_id, workspace_id, source_url });

    try {
      const firecrawl = createFirecrawlClient();
      const anthropic = createAnthropicClient();

      let scrapedMarkdown = "";
      let iconUrl: string | null = null;
      let screenshotUrl: string | null = null;
      logger.info("dna-extraction: scraping URL", { source_url });
      try {
        const scraped = await firecrawl.scrapeUrl(source_url, {
          // "html" is Firecrawl's cleaned main-content extraction — it
          // strips <head> entirely, so favicon <link> tags never appear
          // there. "rawHtml" is the true unprocessed source and is what
          // icon resolution below actually needs. "screenshot" (viewport
          // only, not "screenshot@fullPage") piggybacks on this same
          // request for Settings > App Identity's live-preview box — no
          // extra Firecrawl call.
          formats: ["markdown", "rawHtml", "screenshot"],
          timeout: SCRAPE_TIMEOUT_MS,
        });
        if ("markdown" in scraped && scraped.markdown) {
          scrapedMarkdown = scraped.markdown;
        }
        if ("screenshot" in scraped && scraped.screenshot) {
          screenshotUrl = scraped.screenshot;
        }
        logger.info("dna-extraction: scrape finished", {
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
        logger.warn("dna-extraction: Firecrawl scrape failed, continuing with other sources", {
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
      const docTexts: string[] = [];

      logger.info("dna-extraction: extracting supporting documents", {
        doc_count: docPaths.length,
      });
      for (const path of docPaths) {
        const text = await extractDocText(path);
        if (text?.trim()) {
          docTexts.push(text.trim());
        }
      }
      logger.info("dna-extraction: document extraction finished", {
        extracted_count: docTexts.length,
      });

      if (!scrapedMarkdown && !additionalContext && docTexts.length === 0) {
        throw new Error(
          "No content available to extract DNA from (scrape, context, and docs all empty)."
        );
      }

      // Step 2C — combined context block
      const combinedContext = `
=== APP WEBSITE CONTENT ===
${scrapedMarkdown}

${additionalContext ? `=== ADDITIONAL CONTEXT PROVIDED BY DEVELOPER ===\n${additionalContext}` : ""}

${docTexts.length > 0 ? `=== SUPPORTING DOCUMENTS ===\n${docTexts.map((text, i) => `Document ${i + 1}:\n${text}`).join("\n\n")}` : ""}
`.trim();

      logger.info(
        `DNA extraction used: website scrape ${scrapedMarkdown ? "yes" : "no"} + additional context ${additionalContext ? "yes" : "no"} + ${docTexts.length} documents`
      );

      logger.info("dna-extraction: calling Claude", {
        model: CLAUDE_MODEL,
        context_length: combinedContext.length,
      });
      const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
        anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Extract the app DNA from the following content:\n\n${combinedContext}`,
            },
          ],
        })
      );
      logger.info("dna-extraction: Claude call finished", {
        stop_reason: message.stop_reason,
        usage: message.usage,
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

      let dna: z.infer<typeof dnaSchema>;
      try {
        dna = dnaSchema.parse(JSON.parse(responseText));
      } catch (err) {
        logger.error("dna-extraction: failed to parse Claude's response", {
          raw_response: responseText.slice(0, 2000),
          error: err instanceof Error ? err.message : String(err),
        });
        throw new ExternalServiceError(ErrorMessages.external.CLAUDE_FAILED, "claude");
      }

      logger.info("dna-extraction: DNA parsed successfully", { name: dna.name });

      await supabaseAdmin
        .from("apps")
        .update({
          name: dna.name,
          dna,
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
