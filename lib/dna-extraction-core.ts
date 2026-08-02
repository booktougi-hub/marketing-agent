import "server-only";
import { logger } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { callExternalService, ExternalServiceError } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { createFirecrawlClient } from "@/lib/firecrawl-client";
import { discoverAndScrapeSecondaryPages, DNA_PAGE_DISCOVERY_SPECS } from "@/lib/site-crawl";
import { MODELS } from "@/lib/ai/models";
import type { AppDna, AppDnaBusinessModel, BrandPricingPlan } from "@/types";

const CLAUDE_MODEL: string = MODELS.STANDARD;

// Shared by trigger/dna-extraction.ts (full onboarding/reanalyse pipeline)
// and trigger/dna-reextraction.ts (narrow, manual-edit-respecting
// re-extraction triggered from the Product Information page) so both jobs
// crawl the same pages, use the same schema, and follow the same
// no-fabrication rules — see each job's own file for what happens to the
// result afterward (apps.status transitions vs. a field-level merge).
export const dnaExtractionSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  what_it_does: z.string().nullable(),
  problem: z.string(),
  key_features: z.array(z.string()),
  product_category: z.array(z.string()),
  product_type: z.string().nullable(),
  target_audience: z.string(),
  target_customers: z.string().nullable(),
  competitors: z.array(z.string()),
  tone: z.enum(["casual", "professional", "technical"]),
  primary_cta: z.string().nullable(),
  tech_signals: z.object({
    model_or_stack_used: z.string().nullable(),
    supported_formats_or_languages: z.array(z.string()),
    integrations: z.array(z.string()),
    architecture_description: z.string().nullable(),
  }),
  business_model_narrative: z.string().nullable(),
  additional_urls: z.array(z.string()),
  app_store_urls: z.object({
    play_store: z.string().nullable(),
    app_store: z.string().nullable(),
  }),
});

type RawDna = z.infer<typeof dnaExtractionSchema>;

// Reasoning framework swapped for .claude/skills/customer-research/SKILL.md
// + .claude/skills/product-marketing/SKILL.md combined — same
// "compress the skill's framework into a numbered list baked into a static
// prompt" pattern the Audits-family jobs use (trigger/pricing-audit.ts:79
// etc.), applied here to the DNA extraction prompt specifically because
// every downstream job (strategy, content, ICP, outreach) inherits whatever
// this call infers about problem/audience/category/competitors — sharper
// reasoning here compounds everywhere else. Fields stay exactly as
// dnaExtractionSchema defines them; this only grounds how the model reads
// the source material to fill them in.
const DNA_EXTRACTION_FRAMEWORK = `=== CORE FRAMEWORK (apply this reasoning, do not just restate it) ===

1. JOBS TO BE DONE — for "problem"/"target_audience"/"target_customers", identify the functional job the product is actually hired to do (the concrete task or outcome), not a role label vague enough to describe any user of any product in the category.
2. PRODUCT CATEGORY AS "WHAT SHELF YOU SIT ON" — "product_category" tags should read like how a buyer would search or how a directory would list this product, not an internal engineering description. The most specific framing the site actually supports beats one safe generic label.
3. COMPETITIVE LANDSCAPE TIERS — when populating "competitors", only include names the site itself states as real alternatives; never invent a category-mate just because it's well-known. A competitor solving the exact same problem for the same audience is a stronger signal than a merely adjacent name — if the site distinguishes them, preserve that distinction in how you phrase the field, not just a flat name list.
4. VERBATIM CUSTOMER LANGUAGE — an exact stated pain point, workflow, or outcome phrase is worth more than a paraphrased summary, because it reflects how the product's own audience actually thinks and speaks, and downstream content generation depends on that specificity surviving extraction intact.
5. PROXY-SOURCE REASONING FOR EARLY-STAGE PRODUCTS — a fresh homepage scrape has no review corpus to lean on. When the page doesn't state a specific enough audience, reason outward from the product's stated differentiator: what does this feature or mechanism actually change for someone, and who would feel that difference most — write that as the most specific "target_customers" the source material genuinely supports, never a guess dressed up as certainty.
6. WHAT MAKES SOMEONE SWITCH OR NOT FIT — where the site states or implies why a buyer would choose this over their current approach, or explicitly who it's not for, that belongs in "problem"/"business_model_narrative" reasoning — it's a sharper signal than a generic value-proposition restatement.`;

// `hasBrandPricing` changes the business-model instruction: when Brand
// Identity has already extracted structured pricing (brand_information.
// pricing_summary), this prompt must never re-derive its own numbers — see
// Part 3 note inline below.
function buildDnaSystemPrompt(hasBrandPricing: boolean): string {
  return `You are extracting a structured "DNA" profile for a software product from raw source material. This profile is the single source of truth behind the app's "Product Information" page and is fed into every downstream job — strategy generation, content generation, competitor research, outreach — so completeness and precision here compound everywhere else.

You may receive content from multiple sources: the app's homepage, secondary pages (features/how-it-works, pricing, docs, about — wherever the crawl found them), additional context provided by the developer, and supporting documents. Use all sources together. Read the whole page, not just the hero section — pricing pages, FAQ sections, and footers often hold the only mention of a real number, a named integration, or CTA copy.

Many sites are landing/marketing pages whose actual product is a mobile app — look for "Get it on Google Play" / "Download on the App Store" badges or links to play.google.com or apps.apple.com anywhere in the content, even if the page otherwise reads like a normal website. This matters regardless of what the developer may have labeled the product as.

${DNA_EXTRACTION_FRAMEWORK}

CRITICAL — never flatten specifics into generic language. If the site says "40+ threat patterns across 19 attack categories," your output must say "40+ threat patterns across 19 attack categories," never "checks for many types of threats." If it names a standard, catalog, certification, integration, or model provider (e.g. "CISA KEV catalog", "MCP server format", "Powered by Claude AI"), copy that proper noun verbatim — never paraphrase it into a generic description. Never invent or round a number. If a figure, named thing, or fact is not stated on the page, leave the corresponding field null (or omit it from an array) — do not estimate it or generalize it away. A vague-but-safe answer is a worse answer than an honest null.

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "name": string,                    // the product's own name, not the parent company's unless they're the same
  "tagline": string,                 // one-liner, 15 words or fewer — what the product does
  "what_it_does": string | null,     // a detailed paragraph on how a user actually uses the product end to end — MUST preserve every specific number, named mechanism, and concrete detail found on the page verbatim; never paraphrase a stated figure or proper noun into vaguer language
  "problem": string,                 // the specific pain point or gap the product exists to close
  "key_features": string[],          // concrete capabilities in the site's own terms, each preserving exact figures and named things verbatim (numbers, named integrations, named standards/catalogs, specific input/output mechanisms) — this is the field most likely to get flattened into vague language, so do not summarize away a stated specific
  "product_category": string[],      // 2-4 short category/vertical tags a buyer would search for or a directory would list it under, e.g. ["AI security scanner", "developer security tool", "AI plugin vulnerability checker"] — derive from the product's actual positioning and features, the most specific framing the site supports, not one safe generic label
  "product_type": string | null,     // single classification of what kind of product this is: "SaaS", "mobile app", "browser extension", "API", "developer tool", etc. — inferred from how the site itself describes/packages the product
  "target_audience": string,         // who it's for, as a general summary (role, technical level, use case)
  "target_customers": string | null, // the MOST SPECIFIC framing the site supports — name the actual tools, ecosystems, or job functions mentioned, e.g. "Developers who build with MCP servers and LangChain tools" not "developers"; null only if the site gives no specifics beyond target_audience
  "competitors": string[],           // named competitors, only if the site itself names them
  "tone": "casual" | "professional" | "technical",
  "primary_cta": string | null,      // the exact text of the main call-to-action button/link on the site, e.g. "Try it free", "Start free trial" — null only if genuinely no CTA is present
  "tech_signals": {                  // concrete technical facts a technical buyer or integrator would care about — a NEW category, only populate what the site actually states, leave null/empty rather than inferring
    "model_or_stack_used": string | null,              // e.g. "Powered by Claude AI (Anthropic)" — only if explicitly stated or shown as a badge/credit
    "supported_formats_or_languages": string[],        // e.g. ["JSON", "YAML", "Python", "TypeScript"] — only formats/languages the site explicitly says it supports
    "integrations": string[],                          // named third-party integrations, e.g. ["GitHub", "npm", "Slack"]
    "architecture_description": string | null          // any stated architecture/pipeline detail, e.g. "Static analysis + LLM-assisted reasoning hybrid pipeline" — verbatim, only if stated
  },
  "business_model_narrative": string | null, // ${
    hasBrandPricing
      ? "a SHORT descriptive narrative (one sentence) summarizing the already-known pricing data provided below under KNOWN PRICING — e.g. \"free tier available, no paid plans live yet\". Do NOT invent or restate specific numbers beyond what's given there; you are summarizing known facts, not re-deriving them."
      : "a short descriptive narrative of how the product is monetized/packaged, inferred directly from the crawled pages (e.g. \"free tier available, no paid plans live yet\", \"single one-time purchase, no subscription\") — null if the pages give no basis for even a narrative-level statement. Never invent specific prices or plan names; if you can't state a concrete number, describe the model qualitatively instead (e.g. \"has a paid tier\" rather than guessing a price)."
  }
  "additional_urls": string[],
  "app_store_urls": { "play_store": string | null, "app_store": string | null }  // the actual URLs found in the content, or null if that store isn't linked — never invent a URL that isn't present in the source material
}

Critical rule: this data feeds downstream content generation and outreach. A fabricated feature, invented number, guessed competitor, or made-up tech signal is worse than a missing one — it would make the product's own marketing content claim something untrue. For every array field, an empty array is a correct answer when the source material doesn't support any entries; for every nullable field, null is correct when the source material gives no real basis for an answer.`;
}

export interface DnaExtractionInput {
  appId: string;
  workspaceId: string;
  sourceUrl: string;
  // Already-scraped homepage markdown — callers scrape the homepage
  // themselves (the full pipeline job also needs rawHtml/screenshot from
  // that same request for icon/screenshot resolution, which this shared
  // step has no reason to duplicate).
  homepageMarkdown: string;
  additionalContext: string | null;
  docTexts: string[];
  // Used only for log-line prefixes so job-watchdog/Sentry output stays
  // attributable to whichever job actually called this.
  jobName: string;
}

export interface DnaExtractionOutput {
  dna: AppDna;
  secondaryPageCount: number;
}

export async function runDnaExtraction(input: DnaExtractionInput): Promise<DnaExtractionOutput> {
  const { appId, workspaceId, sourceUrl, homepageMarkdown, additionalContext, docTexts, jobName } = input;

  const firecrawl = createFirecrawlClient();
  const anthropic = createAnthropicClient();

  logger.info(`${jobName}: discovering secondary pages`, { sourceUrl });
  const secondaryPages = homepageMarkdown
    ? await discoverAndScrapeSecondaryPages(firecrawl, homepageMarkdown, sourceUrl, DNA_PAGE_DISCOVERY_SPECS, jobName)
    : [];
  logger.info(`${jobName}: secondary page crawl finished`, {
    found: secondaryPages.length,
    urls: secondaryPages.map((p) => p.url),
  });

  // Part 3 — never have this job independently re-derive structured
  // pricing. If Brand Identity already extracted it, feed it in as known
  // fact for the model to summarize, not re-guess.
  const { data: brandRow } = await supabaseAdmin
    .from("brand_information")
    .select("pricing_summary")
    .eq("app_id", appId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const brandPricingSummary = (brandRow?.pricing_summary ?? null) as BrandPricingPlan[] | null;
  const hasBrandPricing = !!brandPricingSummary && brandPricingSummary.length > 0;

  if (!homepageMarkdown && !additionalContext && docTexts.length === 0) {
    throw new Error("No content available to extract DNA from (scrape, context, and docs all empty).");
  }

  const combinedContext = `
=== HOMEPAGE (${sourceUrl}) ===
${homepageMarkdown || "(homepage could not be read)"}

${secondaryPages.map((p) => `=== ${p.url} ===\n${p.markdown}`).join("\n\n")}

${additionalContext ? `=== ADDITIONAL CONTEXT PROVIDED BY DEVELOPER ===\n${additionalContext}` : ""}

${docTexts.length > 0 ? `=== SUPPORTING DOCUMENTS ===\n${docTexts.map((text, i) => `Document ${i + 1}:\n${text}`).join("\n\n")}` : ""}

${hasBrandPricing ? `=== KNOWN PRICING (from Brand Identity — already verified, summarize only, do not re-derive numbers) ===\n${JSON.stringify(brandPricingSummary)}` : ""}
`.trim();

  logger.info(`${jobName}: calling Claude`, {
    model: CLAUDE_MODEL,
    context_length: combinedContext.length,
    secondary_page_count: secondaryPages.length,
    has_brand_pricing: hasBrandPricing,
  });

  const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
    anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 3072,
      system: buildDnaSystemPrompt(hasBrandPricing),
      messages: [
        {
          role: "user",
          content: `Extract the app DNA from the following content:\n\n${combinedContext}`,
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

  let raw: RawDna;
  try {
    raw = dnaExtractionSchema.parse(JSON.parse(responseText));
  } catch (err) {
    logger.error(`${jobName}: failed to parse Claude's response`, {
      raw_response: responseText.slice(0, 2000),
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ExternalServiceError(ErrorMessages.external.CLAUDE_FAILED, "claude");
  }

  const businessModelSource: AppDnaBusinessModel["source"] = hasBrandPricing
    ? "brand_information"
    : "dna_extraction_fallback";

  const dna: AppDna = {
    name: raw.name,
    tagline: raw.tagline,
    problem: raw.problem,
    target_audience: raw.target_audience,
    competitors: raw.competitors,
    tone: raw.tone,
    additional_urls: raw.additional_urls,
    app_store_urls: raw.app_store_urls,
    overview: { name: raw.name, website: sourceUrl, one_liner: raw.tagline },
    what_it_does: raw.what_it_does,
    key_features: raw.key_features,
    product_category: raw.product_category,
    product_type: raw.product_type,
    target_customers: raw.target_customers,
    primary_cta: raw.primary_cta,
    tech_signals: raw.tech_signals,
    business_model: { narrative: raw.business_model_narrative, source: businessModelSource },
  };

  return { dna, secondaryPageCount: secondaryPages.length };
}
