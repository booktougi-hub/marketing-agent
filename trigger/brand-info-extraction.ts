import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { callExternalService, ExternalServiceError } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";
import type { BrandExtractionSource } from "@/types";

const CLAUDE_MODEL = "claude-sonnet-5";
const MAX_ABOUT_PAGES_TO_SCRAPE = 1;
const MAX_PRICING_PAGES_TO_SCRAPE = 2;

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

// Only fields with a real textual basis on a scraped page are extractable —
// see the "manual-only" list in the system prompt below for everything
// deliberately excluded from this schema (words_to_avoid, writing_sample,
// claims_to_avoid, target_regions, visual identity, logo/screenshots) because
// nothing on a page could ever ground them without guessing.
const extractionSchema = z.object({
  brand_name: z.string().nullable(),
  one_liner: z.string().nullable(),
  category: z.string().nullable(),
  problem_solved: z.string().nullable(),
  target_customer: z.string().nullable(),
  differentiator: z.string().nullable(),
  known_competitors: z.array(z.string()),
  tone_descriptors: z.array(z.string()),
  key_stats: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      source_url: z.string().nullable(),
    })
  ),
  testimonial: z.string().nullable(),
  testimonial_source: z.string().nullable(),
  pricing_summary: z.array(
    z.object({
      plan_name: z.string(),
      price: z.string(),
      billing_period: z.string().nullable(),
    })
  ),
  social_handles: z.record(z.string(), z.string()),
  github_repo_url: z.string().nullable(),
  founder_name: z.string().nullable(),
  founder_bio: z.string().nullable(),
});

type ExtractionResult = z.infer<typeof extractionSchema>;

// Every key in ExtractionResult, used both to build the merge/skip logic
// below and to stamp extraction_source — kept as one array so adding a new
// extractable field only ever means updating extractionSchema + this list.
const EXTRACTABLE_FIELDS = [
  "brand_name",
  "one_liner",
  "category",
  "problem_solved",
  "target_customer",
  "differentiator",
  "known_competitors",
  "tone_descriptors",
  "key_stats",
  "testimonial",
  "testimonial_source",
  "pricing_summary",
  "social_handles",
  "github_repo_url",
  "founder_name",
  "founder_bio",
] as const satisfies readonly (keyof ExtractionResult)[];

const SYSTEM_PROMPT = `You are extracting a structured "Brand Identity" profile for a software product from raw scraped website content (homepage, and if available, About and Pricing pages).

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "brand_name": string | null,
  "one_liner": string | null,           // what the product does, 15 words or fewer
  "category": string | null,            // vertical, e.g. "developer tools", "health", "finance"
  "problem_solved": string | null,
  "target_customer": string | null,
  "differentiator": string | null,      // what makes it different from alternatives, per the site's own claims
  "known_competitors": string[],        // named competitors, only if the site itself names them
  "tone_descriptors": string[],         // 2-5 adjectives describing the actual writing voice on the page (e.g. "direct", "playful", "technical") — a style impression grounded in the real copy, not a fabricated fact
  "key_stats": [{ "label": string, "value": string, "source_url": string | null }],
  "testimonial": string | null,         // a real quote, only if literally present and attributed to a named person or company
  "testimonial_source": string | null,  // who said it, e.g. "Jane Doe, CEO of Acme"
  "pricing_summary": [{ "plan_name": string, "price": string, "billing_period": string | null }],
  "social_handles": { [platform: string]: string },  // e.g. { "twitter": "@handle", "linkedin": "https://..." } — only links actually present on the page
  "github_repo_url": string | null,
  "founder_name": string | null,        // only from an About/Team page or explicit homepage mention
  "founder_bio": string | null
}

Critical rule: this data feeds downstream content generation and GEO (AI-search) content checks. A fabricated statistic, invented testimonial, or guessed competitor is worse than a missing one — it would make the product's own marketing content cite something untrue. If a field is not clearly and literally present in the scraped content, return null (or an empty array for array fields). Never infer, estimate, or make up a plausible-sounding value for any field.

Do not attempt: words to avoid, a writing sample, claims to avoid, target regions, brand colors, fonts, or logo/screenshot images — none of these can be reliably read off page text, so they are not part of this extraction and are handled separately.`;

// Same regex-link-scan idiom as trigger/pricing-audit.ts's findPricingLinks —
// generalized here so About and Pricing discovery share one implementation.
function findLinksByKeywords(markdown: string, baseUrl: string, keywords: string[], limit: number): string[] {
  const linkPattern = /\[([^\]]*)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/gi;
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of markdown.matchAll(linkPattern)) {
    const linkText = match[1].toLowerCase();
    const rawUrl = match[2];
    const isRelevant = keywords.some((kw) => linkText.includes(kw) || rawUrl.toLowerCase().includes(kw));
    if (!isRelevant) continue;

    try {
      const resolved = new URL(rawUrl, baseUrl).toString();
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      urls.push(resolved);
    } catch {
      // Malformed link — skip rather than fail the whole scrape.
    }
  }

  return urls.slice(0, limit);
}

export const brandInfoExtraction = schemaTask({
  id: "brand-info-extraction",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;

    logger.info("brand-info-extraction: run started", { app_id, workspace_id });

    try {
      const { data: existingRow, error: existingRowError } = await supabaseAdmin
        .from("brand_information")
        .select("website_url, extraction_source")
        .eq("app_id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (existingRowError || !existingRow?.website_url) {
        throw new Error(
          `No brand_information row with a website_url found for app ${app_id} — the triggering route must create it first.`
        );
      }

      const websiteUrl = existingRow.website_url;
      const existingSource = (existingRow.extraction_source ?? {}) as BrandExtractionSource;

      const firecrawl = createFirecrawlClient();
      const anthropic = createAnthropicClient();

      let homepageMarkdown = "";
      const secondaryPages: { url: string; markdown: string }[] = [];

      try {
        logger.info("brand-info-extraction: scraping homepage", { websiteUrl });
        const homepage = await firecrawl.scrapeUrl(websiteUrl, {
          formats: ["markdown"],
          timeout: SCRAPE_TIMEOUT_MS,
        });

        if ("markdown" in homepage && homepage.markdown) {
          homepageMarkdown = homepage.markdown;
          logger.info("brand-info-extraction: homepage scraped", { length: homepageMarkdown.length });

          const aboutLinks = findLinksByKeywords(
            homepageMarkdown,
            websiteUrl,
            ["about", "team", "company"],
            MAX_ABOUT_PAGES_TO_SCRAPE
          );
          const pricingLinks = findLinksByKeywords(
            homepageMarkdown,
            websiteUrl,
            ["pricing", "plans", "price"],
            MAX_PRICING_PAGES_TO_SCRAPE
          );

          for (const url of [...aboutLinks, ...pricingLinks]) {
            try {
              const scraped = await firecrawl.scrapeUrl(url, {
                formats: ["markdown"],
                timeout: SCRAPE_TIMEOUT_MS,
              });
              if ("markdown" in scraped && scraped.markdown && scraped.markdown.trim().length > 40) {
                secondaryPages.push({ url, markdown: scraped.markdown });
                logger.info("brand-info-extraction: scraped secondary page", { url });
              }
            } catch (err) {
              logger.warn("brand-info-extraction: failed to scrape secondary page, continuing", {
                url,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      } catch (err) {
        logger.warn("brand-info-extraction: homepage scrape failed, continuing with nothing to extract from", {
          websiteUrl,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (!homepageMarkdown && secondaryPages.length === 0) {
        throw new Error(`Could not read any content from ${websiteUrl}.`);
      }

      const combinedContext = `
=== HOMEPAGE (${websiteUrl}) ===
${homepageMarkdown || "(homepage could not be read)"}

${secondaryPages.map((p) => `=== ${p.url} ===\n${p.markdown}`).join("\n\n")}
`.trim();

      logger.info("brand-info-extraction: calling Claude", {
        model: CLAUDE_MODEL,
        context_length: combinedContext.length,
        secondary_page_count: secondaryPages.length,
      });

      const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
        anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Extract the brand identity from the following content:\n\n${combinedContext}`,
            },
          ],
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

      let extracted: ExtractionResult;
      try {
        extracted = extractionSchema.parse(JSON.parse(responseText));
      } catch (err) {
        logger.error("brand-info-extraction: failed to parse Claude's response", {
          raw_response: responseText.slice(0, 2000),
          error: err instanceof Error ? err.message : String(err),
        });
        throw new ExternalServiceError(ErrorMessages.external.CLAUDE_FAILED, "claude");
      }

      // Never overwrite a field the customer has manually edited — only
      // fields still marked "auto" (or never set) in extraction_source get
      // replaced by this run's result. This is the whole guarantee behind
      // the Settings UI's "Re-analyze" confirm dialog.
      const update: Record<string, unknown> = {};
      const nextSource: BrandExtractionSource = { ...existingSource };

      for (const field of EXTRACTABLE_FIELDS) {
        if (existingSource[field] === "manual") continue;

        const value = extracted[field];
        const isEmpty = value == null || (Array.isArray(value) ? value.length === 0 : false);
        if (isEmpty) continue;

        update[field] = value;
        nextSource[field] = "auto";
      }

      update.extraction_source = nextSource;
      update.extraction_status = "complete";
      update.extraction_error = null;
      update.last_analyzed_at = new Date().toISOString();

      const { error: updateError } = await supabaseAdmin
        .from("brand_information")
        .update(update)
        .eq("app_id", app_id)
        .eq("workspace_id", workspace_id);

      if (updateError) {
        throw new Error(`Failed to save extracted brand information: ${updateError.message}`);
      }

      logger.info("brand-info-extraction: saved successfully", {
        app_id,
        fields_updated: Object.keys(update).length,
      });

      return { app_id, status: "complete" as const };
    } catch (err) {
      // Side/enrichment job, not one of the three pipeline-blocking jobs —
      // never touches apps.status. Its own extraction_status/extraction_error
      // columns play that role for this table instead (see SCHEMA.md).
      await handleJobError(err, {
        appId: app_id,
        workspaceId: workspace_id,
        jobName: "brand-info-extraction",
        updateAppStatus: false,
      });

      const message = err instanceof Error ? err.message : ErrorMessages.generic.UNKNOWN;
      await supabaseAdmin
        .from("brand_information")
        .update({ extraction_status: "error", extraction_error: message })
        .eq("app_id", app_id)
        .eq("workspace_id", workspace_id);

      throw err;
    }
  },
});
