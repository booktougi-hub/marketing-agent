import { logger } from "@trigger.dev/sdk";
import { z } from "zod";
import { searchSerpApi } from "@/lib/serpapi-search";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";
import { buildDiscoveryQueries } from "@/lib/discovery-query-builder";
import { callExternalService } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import type { AppDna, ProductType } from "@/types";

// Discover-scrape-summarize competitor logic — extracted from
// trigger/competitor-research.ts (which owns writing rows to the
// competitor_research table and chaining into diagnosis) so
// trigger/diagnosis-refresh-check.ts can reuse the exact same discovery
// logic to get a fresh comparison snapshot without any of
// competitor-research's onboarding-pipeline side effects (inserting rows,
// triggering diagnosis, flipping apps.status). One function, two callers —
// per CLAUDE.md, never duplicate a job's logic across files.

const CLAUDE_MODEL = "claude-sonnet-5";
const MAX_FINALISTS = 3;

export interface DiscoveredCompetitor {
  name: string;
  url: string;
  scraped_summary: string;
  pricing_notes: string;
  positioning_notes: string;
}

interface Candidate {
  name: string;
  url: string;
  // "dna" candidates are already known-real (the user or an earlier
  // verified competitor-gap-analysis run listed them) — prioritized over
  // freshly SerpAPI-discovered ones, which haven't been checked at all yet.
  source: "dna" | "search";
}

// STEP A.1 — resolve a URL for each DNA-listed competitor (if any), so
// "starting point" competitors are real candidates, not just names.
async function resolveDnaCompetitorUrls(dnaListed: string[], appId: string): Promise<Candidate[]> {
  const names = dnaListed.slice(0, 2); // cap — this is a starting point, not the whole search
  const resolved = await Promise.all(
    names.map(async (name): Promise<Candidate | null> => {
      const { results, error } = await searchSerpApi(`${name} official website`, 2);
      if (error || results.length === 0) {
        logger.warn(`competitor-discovery: could not resolve a URL for DNA-listed competitor "${name}": ${error ?? "no results"}`, {
          appId,
        });
        return null;
      }
      return { name, url: results[0].url, source: "dna" };
    })
  );
  return resolved.filter((c): c is Candidate => c !== null);
}

// STEP A.2 — SerpAPI search across the broadened category/region/problem
// queries (same query construction competitor-gap-analysis uses), then one
// Claude call to pick 2-3 real, distinctly-named competitors out of the raw
// search results.
const candidateSchema = z.array(z.object({ name: z.string().min(1), url: z.string().min(1) })).max(MAX_FINALISTS);

const CANDIDATE_EXTRACTION_PROMPT = `You identify real, named competitor products or companies from raw web search results about a product category.

You'll be given a target product's problem/category (for context only — NOT to match against) and raw search results about that problem space.

Respond with ONLY a JSON array of up to 3 distinct real products or companies that are ACTUALLY named in the search results, each with the URL of their own site (use the result's own URL, not a directory/listing page). Do not invent a name or URL that isn't present in the source text, and do not include the target product itself. If the search results don't clearly name any real competitors, return an empty array.

Respond with ONLY the JSON array — no prose, no markdown code fences.`;

async function discoverViaSerpApi(
  dna: AppDna,
  productType: ProductType,
  additionalContext: string | null,
  appId: string
): Promise<Candidate[]> {
  const queries = buildDiscoveryQueries(dna, productType, additionalContext);
  if (queries.length === 0) {
    logger.warn(`competitor-discovery: no discovery queries could be built for app ${appId} — DNA has no problem/tagline/target_audience text`, {
      appId,
    });
    return [];
  }

  const resultsPerQuery = await Promise.all(
    queries.map(async (q) => {
      const { results, error } = await searchSerpApi(q.query, 5);
      if (error) {
        logger.warn(`competitor-discovery: SerpAPI search failed for query "${q.query}": ${error}`, { appId });
        return [];
      }
      logger.info(`competitor-discovery: query "${q.query}" [${q.kind}] returned ${results.length} result(s)`, {
        appId,
        query: q.query,
        kind: q.kind,
      });
      return results;
    })
  );
  const results = resultsPerQuery.flat();
  if (results.length === 0) return [];

  const searchContext = results
    .map((r, i) => `[Result ${i + 1}]\nURL: ${r.url}\nTitle: ${r.title}\n${r.snippet}`)
    .join("\n\n---\n\n");

  const anthropic = createAnthropicClient();
  const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
    anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      system: CANDIDATE_EXTRACTION_PROMPT,
      messages: [
        {
          role: "user",
          content: `=== TARGET PRODUCT (context only) ===\n${JSON.stringify(
            { name: dna.name, problem: dna.problem },
            null,
            2
          )}\n\n=== SEARCH RESULTS ===\n${searchContext}`,
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
    const parsed = candidateSchema.parse(JSON.parse(responseText));
    return parsed
      .filter((c) => c.name.trim().toLowerCase() !== (dna.name ?? "").trim().toLowerCase())
      .map((c) => ({ ...c, source: "search" as const }));
  } catch (err) {
    logger.warn(`competitor-discovery: candidate extraction response was unparseable for app ${appId}`, {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// STEP B — scrape homepage (+ pricing page if a link to one is findable) for
// each finalist. A scrape that returns nothing is treated as "not currently
// live" and the candidate is dropped, per the "real, currently-live
// competitors" bar.
interface ScrapedCandidate extends Candidate {
  homepageMarkdown: string;
  pricingMarkdown: string | null;
}

function findPricingLink(markdown: string, baseUrl: string): string | null {
  const match = markdown.match(/\[[^\]]*pricing[^\]]*\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/i);
  if (!match) return null;
  try {
    return new URL(match[1], baseUrl).toString();
  } catch {
    return null;
  }
}

async function scrapeCandidate(candidate: Candidate, appId: string): Promise<ScrapedCandidate | null> {
  const firecrawl = createFirecrawlClient();

  let homepageMarkdown = "";
  try {
    const scraped = await firecrawl.scrapeUrl(candidate.url, { formats: ["markdown"], timeout: SCRAPE_TIMEOUT_MS });
    if ("markdown" in scraped && scraped.markdown) homepageMarkdown = scraped.markdown;
  } catch (err) {
    logger.warn(`competitor-discovery: homepage scrape failed for "${candidate.name}" (${candidate.url})`, {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (homepageMarkdown.trim().length < 40) {
    logger.warn(`competitor-discovery: dropping "${candidate.name}" — homepage scrape returned nothing, not treating as currently-live`, {
      appId,
      url: candidate.url,
    });
    return null;
  }

  let pricingMarkdown: string | null = null;
  const pricingUrl = findPricingLink(homepageMarkdown, candidate.url);
  if (pricingUrl) {
    try {
      const scraped = await firecrawl.scrapeUrl(pricingUrl, { formats: ["markdown"], timeout: SCRAPE_TIMEOUT_MS });
      if ("markdown" in scraped && scraped.markdown) pricingMarkdown = scraped.markdown;
    } catch (err) {
      logger.warn(`competitor-discovery: pricing page scrape failed for "${candidate.name}" (${pricingUrl})`, {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ...candidate, homepageMarkdown, pricingMarkdown };
}

// STEP C — one Claude call summarizing all scraped finalists together
// (cheaper than one call per candidate, and gives Claude the target app's
// DNA alongside every competitor for consistent positioning language).
const summarySchema = z.array(
  z.object({
    name: z.string(),
    scraped_summary: z.string(),
    pricing_notes: z.string(),
    positioning_notes: z.string(),
  })
);

const SUMMARY_SYSTEM_PROMPT = `You summarize real competitor products from their own scraped website content, for a target product's growth diagnosis.

You'll be given the target product's DNA and scraped homepage (+ pricing page, if found) content for each competitor.

Respond with ONLY a JSON array matching this exact shape — no prose, no markdown code fences:
[{
  "name": string,                  // exact competitor name as given
  "scraped_summary": string,       // 2-3 sentences: what they actually do, grounded in the scraped content
  "pricing_notes": string,         // their apparent pricing tier/model — grounded in the pricing page if scraped, otherwise inferred cautiously from the homepage, or "not found in scraped content" if genuinely absent
  "positioning_notes": string      // how they position themselves and who they appear to target, grounded in their own language
}]

Every field must be grounded in what was actually scraped — do not invent details. If the scraped content is too thin to say something specific, say so plainly rather than guessing.`;

async function summarizeCandidates(
  dna: AppDna,
  scraped: ScrapedCandidate[],
  appId: string
): Promise<z.infer<typeof summarySchema>> {
  const anthropic = createAnthropicClient();

  const competitorBlocks = scraped
    .map(
      (c) =>
        `=== COMPETITOR: ${c.name} (${c.url}) ===\nHomepage:\n${c.homepageMarkdown.slice(0, 3000)}${
          c.pricingMarkdown ? `\n\nPricing page:\n${c.pricingMarkdown.slice(0, 2000)}` : "\n\n(No pricing page found)"
        }`
    )
    .join("\n\n---\n\n");

  const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
    anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1536,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `=== TARGET PRODUCT DNA ===\n${JSON.stringify(dna, null, 2)}\n\n${competitorBlocks}`,
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
    return summarySchema.parse(JSON.parse(responseText));
  } catch (err) {
    logger.error(`competitor-discovery: summary response was unparseable for app ${appId}`, {
      appId,
      raw_response: responseText.slice(0, 2000),
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// STEPS A-C combined — the candidate pool (DNA-listed + SerpAPI-discovered),
// scraped, then summarized. Returns [] if nothing usable was found at any
// stage (a genuinely novel product with zero real competitors, or every
// candidate's site failed to scrape) — a legitimate outcome, not a failure,
// same as the original inline logic in trigger/competitor-research.ts
// treated it.
export async function discoverAndSummarizeCompetitors(
  dna: AppDna,
  productType: ProductType,
  additionalContext: string | null,
  appId: string
): Promise<DiscoveredCompetitor[]> {
  const [dnaCandidates, searchCandidates] = await Promise.all([
    resolveDnaCompetitorUrls((dna.competitors ?? []).filter(Boolean), appId),
    discoverViaSerpApi(dna, productType, additionalContext, appId),
  ]);

  const seen = new Set<string>();
  const pool: Candidate[] = [];
  for (const candidate of [...dnaCandidates, ...searchCandidates]) {
    const key = candidate.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pool.push(candidate);
  }
  const finalists = pool.slice(0, MAX_FINALISTS);

  logger.info(
    `competitor-discovery: candidate pool for app ${appId} — dna: ${dnaCandidates.length}, search: ${searchCandidates.length} → ${finalists.length} finalist(s): ${finalists.map((c) => c.name).join(", ") || "(none)"}`,
    { appId, dnaCount: dnaCandidates.length, searchCount: searchCandidates.length, finalists: finalists.map((c) => c.name) }
  );

  if (finalists.length === 0) return [];

  const scrapedResults = await Promise.all(finalists.map((c) => scrapeCandidate(c, appId)));
  const scraped = scrapedResults.filter((c): c is ScrapedCandidate => c !== null);
  if (scraped.length === 0) return [];

  const summaries = await summarizeCandidates(dna, scraped, appId);
  const summaryByName = new Map(summaries.map((s) => [s.name.trim().toLowerCase(), s]));

  return scraped
    .map((c): DiscoveredCompetitor | null => {
      const summary = summaryByName.get(c.name.trim().toLowerCase());
      if (!summary) return null;
      return {
        name: c.name,
        url: c.url,
        scraped_summary: summary.scraped_summary,
        pricing_notes: summary.pricing_notes,
        positioning_notes: summary.positioning_notes,
      };
    })
    .filter((r): r is DiscoveredCompetitor => r !== null);
}
