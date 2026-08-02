import "server-only";
import { logger } from "@trigger.dev/sdk";
import { z } from "zod";
import { callExternalService, ExternalServiceError } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";
import { discoverAndScrapeSecondaryPages, type PageDiscoverySpec } from "@/lib/site-crawl";
import { MODELS } from "@/lib/ai/models";
import type { AppDna } from "@/types";

const CLAUDE_MODEL: string = MODELS.STANDARD;

// Adapted from .claude/skills/competitor-profiling's page-type table
// (Homepage/Pricing/Features/About) — the two phases that skill doesn't
// cover here are SEO/backlink data (Phase 2, DataForSEO — no equivalent
// integration exists in this project) and review mining (Phase 1 Step 3,
// optional even in the skill). Reuses the same discovery+scrape helper
// trigger/dna-extraction.ts and trigger/brand-info-extraction.ts already
// use for the founder's own site.
const COMPETITOR_PAGE_DISCOVERY_SPECS: PageDiscoverySpec[] = [
  { label: "pricing", keywords: ["pricing", "plans", "price"], pathGuesses: ["/pricing", "/plans"], limit: 1 },
  { label: "features", keywords: ["feature", "features", "product"], pathGuesses: ["/features", "/product"], limit: 1 },
  { label: "about", keywords: ["about", "team", "company"], pathGuesses: ["/about", "/about-us", "/company"], limit: 1 },
];

// Mirrors the skill's profile template sections (At a Glance / Positioning
// & Messaging / Product & Features / Pricing / Strengths & Weaknesses /
// Competitive Implications), minus the SEO & Content Strategy and Customers
// & Social Proof sections (those need DataForSEO/review-site data this
// project doesn't have access to). scraped_summary/pricing_notes/
// positioning_notes are the same three fields
// trigger/competitor-research.ts's onboarding discovery already populates —
// re-derived here too, now grounded in more pages, so a "Research
// Competitors" run refines rather than duplicates them.
export const competitorProfileSchema = z.object({
  scraped_summary: z.string(),
  pricing_notes: z.string(),
  positioning_notes: z.string(),
  tagline: z.string().nullable(),
  founded_year: z.string().nullable(),
  headquarters: z.string().nullable(),
  team_size_estimate: z.string().nullable(),
  target_audience: z.string().nullable(),
  positioning_angle: z.string().nullable(),
  key_messaging_themes: z.array(z.string()),
  core_features: z.array(z.string()),
  notable_differentiators: z.array(z.string()),
  integrations: z.array(z.string()),
  pricing_tiers: z.array(
    z.object({
      tier_name: z.string(),
      price: z.string(),
      key_inclusions: z.string(),
    })
  ),
  billing_notes: z.string().nullable(),
  free_trial: z.string().nullable(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  competitive_implications: z.object({
    where_they_win: z.string().nullable(),
    where_we_win: z.string().nullable(),
    opportunities: z.string().nullable(),
    threats: z.string().nullable(),
  }),
});

export type CompetitorProfileResult = z.infer<typeof competitorProfileSchema>;

const SYSTEM_PROMPT = `You are a competitive intelligence analyst producing a structured competitor profile from a competitor's own scraped website content (homepage, and if available, pricing/features/about pages), for a specific target product you're also given the DNA of.

Follow these principles (same ones used everywhere else in this codebase's extraction jobs):
- Facts over opinions: every claim must be traceable to the scraped content. Never invent a detail, number, price, founding year, or team size that isn't actually stated.
- If a field genuinely isn't findable in the scraped content, return null (or an empty array for array fields) — a fabricated-sounding but plausible value is worse than an honest gap.
- Honest assessment: don't exaggerate the competitor's weaknesses or downplay their strengths just because they're a competitor.
- "Strengths"/"weaknesses" and "competitive_implications" are the only fields allowed to be evaluative rather than purely descriptive — and even those must be grounded in what the scraped content actually shows, not assumed.

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "scraped_summary": string,          // 2-3 sentences: what they actually do, grounded in the scraped content
  "pricing_notes": string,            // short pricing summary; if genuinely not published, say so explicitly rather than guessing a range
  "positioning_notes": string,        // how they position themselves and who they appear to target, in their own language
  "tagline": string | null,           // their homepage headline/tagline, verbatim or near-verbatim
  "founded_year": string | null,      // only if explicitly stated (e.g. an About page "Founded in 2019")
  "headquarters": string | null,      // only if explicitly stated
  "team_size_estimate": string | null,// only if explicitly stated or strongly implied (e.g. "50+ employees") — never guess from vibes
  "target_audience": string | null,   // who their copy is speaking to — role, technical level, use case
  "positioning_angle": string | null, // their stated or clearly-implied angle, e.g. "simplicity-first", "enterprise-grade", "all-in-one"
  "key_messaging_themes": string[],   // 2-4 recurring themes in their own copy, each grounded in a specific page
  "core_features": string[],          // concrete capabilities in their own terms, preserving specific numbers/named things verbatim — never vague filler
  "notable_differentiators": string[],// what they themselves emphasize as unique
  "integrations": string[],           // named third-party integrations they list
  "pricing_tiers": [{ "tier_name": string, "price": string, "key_inclusions": string }],  // empty array if no pricing page/tiers found
  "billing_notes": string | null,     // monthly/annual, per-seat/usage-based quirks, discounts — only if stated
  "free_trial": string | null,        // e.g. "14-day free trial", "No free trial mentioned" — state plainly rather than omitting
  "strengths": string[],              // 2-4 strengths, each with an implicit basis in what was scraped
  "weaknesses": string[],             // 2-4 weaknesses/gaps evident from what was (or wasn't) found on their site — never invent a weakness with no evidence
  "competitive_implications": {
    "where_they_win": string | null,    // where this competitor has a real advantage over the target product, based on comparing both DNA sets
    "where_we_win": string | null,      // where the target product has a real advantage over this competitor
    "opportunities": string | null,     // gaps in the competitor's offering or positioning the target product could exploit
    "threats": string | null            // areas where this competitor is strong and the target product should be wary of
  }
}

The "=== OUR PRODUCT (for comparison only) ===" block in the user message is the target product's own DNA — use it only to ground the competitive_implications section, never describe it as the competitor.`;

export interface CompetitorProfileInput {
  competitorName: string;
  competitorUrl: string;
  ourDna: AppDna;
  jobName: string;
}

// Returns null (not a thrown error) when the competitor's site couldn't be
// read at all — same "not currently live, drop it" treatment
// lib/competitor-discovery.ts already uses, so one dead competitor site
// doesn't fail the whole batch in trigger/competitor-profile-research.ts.
export async function researchCompetitorProfile(
  input: CompetitorProfileInput
): Promise<CompetitorProfileResult | null> {
  const { competitorName, competitorUrl, ourDna, jobName } = input;

  const firecrawl = createFirecrawlClient();
  const anthropic = createAnthropicClient();

  let homepageMarkdown = "";
  try {
    const homepage = await firecrawl.scrapeUrl(competitorUrl, { formats: ["markdown"], timeout: SCRAPE_TIMEOUT_MS });
    if ("markdown" in homepage && homepage.markdown) homepageMarkdown = homepage.markdown;
  } catch (err) {
    logger.warn(`${jobName}: homepage scrape failed for competitor`, {
      competitorName,
      competitorUrl,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (homepageMarkdown.trim().length < 40) {
    logger.warn(`${jobName}: no usable homepage content for competitor, skipping`, {
      competitorName,
      competitorUrl,
    });
    return null;
  }

  const secondaryPages = await discoverAndScrapeSecondaryPages(
    firecrawl,
    homepageMarkdown,
    competitorUrl,
    COMPETITOR_PAGE_DISCOVERY_SPECS,
    jobName
  );

  const combinedContext = `
=== OUR PRODUCT (for comparison only) ===
${JSON.stringify(
  {
    name: ourDna.name,
    tagline: ourDna.tagline,
    problem: ourDna.problem,
    what_it_does: ourDna.what_it_does ?? null,
    key_features: ourDna.key_features ?? [],
    target_customers: ourDna.target_customers ?? ourDna.target_audience,
    business_model: ourDna.business_model ?? null,
  },
  null,
  2
)}

=== COMPETITOR: ${competitorName} (${competitorUrl}) ===
${homepageMarkdown}

${secondaryPages.map((p) => `=== ${p.url} ===\n${p.markdown}`).join("\n\n")}
`.trim();

  logger.info(`${jobName}: calling Claude for competitor profile`, {
    competitorName,
    model: CLAUDE_MODEL,
    context_length: combinedContext.length,
    secondary_page_count: secondaryPages.length,
  });

  const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
    anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 3072,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Produce the competitor profile from the following content:\n\n${combinedContext}`,
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

  try {
    return competitorProfileSchema.parse(JSON.parse(responseText));
  } catch (err) {
    logger.error(`${jobName}: failed to parse Claude's competitor profile response`, {
      competitorName,
      raw_response: responseText.slice(0, 2000),
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ExternalServiceError(ErrorMessages.external.CLAUDE_FAILED, "claude");
  }
}
