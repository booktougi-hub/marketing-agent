import { logger, schemaTask, tasks } from "@trigger.dev/sdk";
import Anthropic from "@anthropic-ai/sdk";
import FirecrawlApp from "@mendable/firecrawl-js";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { resolveAppIconUrl } from "@/lib/favicon";
import type { strategyGeneration } from "@/trigger/strategy-generation";

const CLAUDE_MODEL = "claude-sonnet-5";

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
});

const SYSTEM_PROMPT = `You are extracting a structured "DNA" profile for a software product from raw source material.

You may receive content from multiple sources: the app website, additional context provided by the developer, and supporting documents. Use all sources together to extract the most accurate and complete information.

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
  "additional_urls": string[]
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
      const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

      let scrapedMarkdown = "";
      let iconUrl: string | null = null;
      logger.info("dna-extraction: scraping URL", { source_url });
      try {
        const scraped = await firecrawl.scrapeUrl(source_url, {
          formats: ["markdown", "html"],
        });
        if ("markdown" in scraped && scraped.markdown) {
          scrapedMarkdown = scraped.markdown;
        }
        logger.info("dna-extraction: scrape finished", {
          got_markdown: !!scrapedMarkdown,
          markdown_length: scrapedMarkdown.length,
        });

        // Favicon/logo resolution failing is never fatal to DNA extraction —
        // worst case the UI falls back to a first-letter avatar.
        try {
          iconUrl = await resolveAppIconUrl({
            html: "html" in scraped ? scraped.html : null,
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
      const message = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Extract the app DNA from the following content:\n\n${combinedContext}`,
          },
        ],
      });
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
        throw new Error(
          `Claude returned an unparseable DNA object: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      logger.info("dna-extraction: DNA parsed successfully", { name: dna.name });

      await supabaseAdmin
        .from("apps")
        .update({
          name: dna.name,
          dna,
          status: "strategy_pending",
          // Only overwrite icon_url when a new one was actually found this
          // run — a transient resolution failure on a later re-analysis
          // shouldn't null out an icon that was already found before.
          ...(iconUrl ? { icon_url: iconUrl } : {}),
        })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      logger.info("dna-extraction: app row updated to strategy_pending", { app_id });

      await tasks.trigger<typeof strategyGeneration>("strategy-generation", {
        app_id,
        workspace_id,
      });

      logger.info("dna-extraction: strategy-generation triggered", { app_id });

      return { app_id, status: "strategy_pending" as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : "DNA extraction failed.";
      logger.error("dna-extraction failed", {
        app_id,
        workspace_id,
        error: message,
        stack: err instanceof Error ? err.stack : undefined,
      });

      await supabaseAdmin
        .from("apps")
        .update({ status: "error", error_message: message })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      throw err;
    }
  },
});
