import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { searchWeb } from "@/lib/firecrawl-search";
import { searchSerpApi } from "@/lib/serpapi-search";
import { extractKeyPhrase, runResearchStream } from "@/lib/research-job";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { callExternalService } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";
import type { AppDna, AppStoreUrls, ProductType } from "@/types";

const CLAUDE_MODEL = "claude-sonnet-5";
const MAX_COMPETITORS = 5;
// Safety valve on Step 2 cost — Step 1 can now surface far more than 5
// candidates (4 discovery sources vs. the old single web search), and every
// candidate costs a search + scrape + Claude call in verification. This caps
// how many discovered (non-DNA-listed) candidates get verified per run.
const MAX_CANDIDATES_TO_VERIFY = 12;

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

const gapSchema = z.object({
  competitor_name: z.string(),
  gap: z.string(),
  source: z.string(), // e.g. "G2 Reviews", "Capterra", "Changelog"
  positioning: z.string(),
});

const SYSTEM_PROMPT = `You are a competitive positioning analyst finding real weaknesses in a software product's named competitors.

You'll be given the product's DNA (name, tagline, problem, features, competitors) and raw search results — review sites, changelogs, complaint threads — about those competitors.

Respond with ONLY a JSON array matching this exact shape — no prose, no markdown code fences:
[{
  "competitor_name": string,  // which competitor this gap is about
  "gap": string,               // the specific weakness or missing feature, grounded in what the source actually says
  "source": string,            // where you found it, e.g. "G2 Reviews", "Capterra", "Reddit"
  "positioning": string        // one sentence: how to use this gap in this product's marketing copy, grounded in its actual features from the DNA — don't claim a feature the product doesn't have
}]

Only include gaps that are actually stated or clearly implied in the search results — do not invent weaknesses. Return at most 6 gaps. If nothing in the search results is usable, return an empty array.`;

const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  developer_tool: "developer tool",
  mobile_app: "mobile app",
  web_app: "web app",
  saas: "SaaS tool",
  browser_extension: "browser extension",
  other: "tool",
};

// The product_type dropdown is set once at onboarding and is often wrong
// for landing pages whose real product is a mobile app (e.g. a page
// showcasing a Play Store app, manually categorized as "web_app"). DNA
// extraction now detects actual Play Store / App Store links on the page
// (see trigger/dna-extraction.ts) — that's a stronger, self-correcting
// signal than the dropdown, so app-store-aware sources trust either one.
function hasAppStorePresence(dna: AppDna, productType: ProductType): boolean {
  return productType === "mobile_app" || !!dna.app_store_urls?.play_store || !!dna.app_store_urls?.app_store;
}

// ---------------------------------------------------------------------------
// STEP 1 — candidate discovery, based on function, not name.
//
// The bug this replaces: the old discovery query was literally
// `${dna.name} alternatives` — a name-based search that surfaces anything
// sharing word fragments with the product's own name (e.g. "AISkillsGuard"
// pulling in "SkillGuard.ai", "Guard Skills") regardless of whether they
// actually do the same thing. Every query below is built only from the
// product's problem/category/audience — dna.name is never used as search
// input.
//
// A second bug this replaces: a single generic web search has no presence
// for small regional/niche app-store-only apps (e.g. a calendar app for a
// specific language/region) — their only footprint is their store listing,
// which general web search rarely indexes well. Discovery now pulls from
// four sources across multiple queries instead of one web search with one
// query, before anything reaches Step 2 verification.
// ---------------------------------------------------------------------------

const candidateNamesSchema = z.array(z.string().min(1)).max(MAX_COMPETITORS);

const CANDIDATE_EXTRACTION_PROMPT = `You identify real, named products or companies mentioned in web search results about a product category.

You'll be given a target product's problem/category/audience (for context only — NOT to match against) and raw search results about that problem space.

Respond with ONLY a JSON array of up to ${MAX_COMPETITORS} distinct product or company names that are ACTUALLY mentioned in the search results — do not invent a name that isn't present in the source text, and do not include the target product itself. If the search results don't clearly name any real products, return an empty array.

Respond with ONLY the JSON array — no prose, no markdown code fences.`;

type CandidateSource =
  | "dna"
  | "web_search" // Source 1 — general web search (Firecrawl)
  | "app_store_search" // Source 2 — Play/App Store keyword search (SerpAPI)
  | "similar_apps" // Source 3 — "similar apps" mined from a store listing page
  | "category_browse"; // Source 4 — store category browse (currently always skipped, see discoverViaCategoryBrowse)

interface Candidate {
  name: string;
  source: CandidateSource;
  url?: string;
}

interface DiscoveryQuery {
  query: string;
  kind: "category" | "region" | "problem";
}

// ---------------------------------------------------------------------------
// Query construction — 2-4 distinct queries per app instead of one narrow
// phrase, each targeting a different angle: what the app DOES (category),
// WHO/WHERE it's for (region/context), and what a user would search when
// hunting for a solution (problem). dna.name is never used as input.
// ---------------------------------------------------------------------------

function buildDiscoveryQueries(
  dna: AppDna,
  productType: ProductType,
  additionalContext: string | null
): DiscoveryQuery[] {
  const categoryLabel = PRODUCT_TYPE_LABEL[productType] ?? "tool";
  const functionPhrase = extractKeyPhrase(dna.tagline, 5) || extractKeyPhrase(dna.problem, 5);
  const audiencePhrase = extractKeyPhrase(dna.target_audience, 6);
  const problemPhrase = extractKeyPhrase(dna.problem, 6);
  // additional_context is free text the user typed at onboarding — the most
  // likely place a region/language/cultural signal ("for the Manipuri
  // community", "Quebec French speakers") shows up. Falls back to the
  // audience phrase when it's empty.
  const contextPhrase = extractKeyPhrase(additionalContext, 6);
  const regionPhrase = contextPhrase || audiencePhrase;

  const queries: DiscoveryQuery[] = [];
  const seenQueries = new Set<string>();
  const push = (query: string, kind: DiscoveryQuery["kind"]) => {
    const key = query.trim().toLowerCase();
    if (!key || seenQueries.has(key)) return;
    seenQueries.add(key);
    queries.push({ query: query.trim(), kind });
  };

  if (functionPhrase) {
    push(`${functionPhrase} ${categoryLabel}`, "category");
  }
  if (regionPhrase) {
    push(`${categoryLabel} for ${regionPhrase}`, "region");
  }
  if (problemPhrase) {
    push(`${problemPhrase} app`, "problem");
  }

  return queries;
}

// SOURCE 1 — general web search (Firecrawl), across every discovery query.
// Results from all queries are combined into a single Claude extraction
// call (unchanged cost from before — still one Claude call regardless of
// how many queries feed it).
async function discoverViaWebSearch(
  queries: DiscoveryQuery[],
  dna: AppDna,
  appId: string
): Promise<string[]> {
  if (queries.length === 0) return [];

  const resultsPerQuery = await Promise.all(
    queries.map(async (q) => {
      const { docs, error } = await searchWeb(q.query, 5);
      if (error) {
        logger.warn(
          `competitor-gap-analysis: Source 1 (web_search) failed for query "${q.query}": ${error}`,
          { appId, query: q.query }
        );
        return [];
      }
      logger.info(
        `competitor-gap-analysis: Source 1 (web_search) query "${q.query}" [${q.kind}] returned ${docs.length} result(s)`,
        { appId, query: q.query, kind: q.kind, count: docs.length }
      );
      return docs;
    })
  );
  const results = resultsPerQuery.flat();

  if (results.length === 0) {
    logger.info(`competitor-gap-analysis: Source 1 (web_search) found no results for app ${appId}`, {
      appId,
    });
    return [];
  }

  const searchContext = results
    .map((r, i) => `[Result ${i + 1}]\nURL: ${r.url}\nTitle: ${r.title}\n${r.content.slice(0, 1000)}`)
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
            { name: dna.name, problem: dna.problem, target_audience: dna.target_audience },
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
    return candidateNamesSchema
      .parse(JSON.parse(responseText))
      .filter((name) => name.trim().toLowerCase() !== (dna.name ?? "").trim().toLowerCase());
  } catch (err) {
    logger.warn(`competitor-gap-analysis: Source 1 (web_search) extraction response was unparseable`, {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// SOURCE 2 — direct Play Store / App Store keyword search via SerpAPI
// (site:play.google.com / site:apps.apple.com). Only run when the app has
// app-store presence (product_type is "mobile_app", OR DNA extraction found
// an actual Play Store/App Store link on the page — see
// hasAppStorePresence) — the whole point is catching apps whose only real
// footprint is their store listing, which is an app-store-specific problem.
// Names are parsed directly from the store listing page title (no Claude
// call needed — the title format is predictable and the URL already
// confirms it's a real listing, not a name Claude might mishear from
// prose).
function parseStoreListingName(title: string): string {
  return title
    .replace(/\s*[-–—]\s*Apps?\s+on\s+Google\s+Play.*$/i, "")
    .replace(/\s*on\s+the\s+App\s+Store.*$/i, "")
    .replace(/\s*[-–—]\s*App\s+Store.*$/i, "")
    .trim();
}

async function discoverViaAppStoreSearch(
  queries: DiscoveryQuery[],
  dna: AppDna,
  productType: ProductType,
  appId: string
): Promise<Candidate[]> {
  if (!hasAppStorePresence(dna, productType) || queries.length === 0) return [];

  const storeSites = [
    { site: "play.google.com", urlMustInclude: "/store/apps/" },
    { site: "apps.apple.com", urlMustInclude: "apps.apple.com/" },
  ];

  const resultsPerQuery = await Promise.all(
    queries.flatMap((q) =>
      storeSites.map(async ({ site, urlMustInclude }) => {
        const searchQuery = `${q.query} site:${site}`;
        const { results, error } = await searchSerpApi(searchQuery, 5);
        if (error) {
          logger.warn(
            `competitor-gap-analysis: Source 2 (app_store_search) failed for query "${searchQuery}": ${error}`,
            { appId, query: searchQuery }
          );
          return [];
        }
        const listings = results.filter((r) => r.url.includes(urlMustInclude));
        logger.info(
          `competitor-gap-analysis: Source 2 (app_store_search) query "${searchQuery}" [${q.kind}] returned ${listings.length} listing(s)`,
          { appId, query: searchQuery, kind: q.kind, count: listings.length }
        );
        return listings;
      })
    )
  );

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const r of resultsPerQuery.flat()) {
    const name = parseStoreListingName(r.title);
    if (!name || name.length > 80) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ name, source: "app_store_search", url: r.url });
  }

  return candidates;
}

// SOURCE 3 — "similar apps" mining. Store listing pages (both Play Store
// and the App Store) render a "similar apps" / "you might also like"
// section — apps that share the same functional niche but may never show
// up in keyword search because their own metadata is thin. The app's OWN
// store listing (from DNA-detected app_store_urls) is the highest-priority
// seed here — it's a guaranteed-real listing with no search step needed,
// and Play/App Store's own recommendation algorithm is a strong direct
// competitor signal. Remaining slots (if any) are filled from Source 2
// discoveries. Capped at 3 total seeds so this doesn't fan out into a
// lookup per candidate.
const similarAppsSchema = z.array(z.object({ name: z.string().min(1), url: z.string().optional() })).max(10);

const SIMILAR_APPS_EXTRACTION_PROMPT = `You extract app names from a Google Play or Apple App Store listing page's markdown content.

Look specifically for a "Similar apps", "You might also like", "More like this", or comparable recommendation section. Do NOT include the app the page itself is for, and do NOT include "More by this developer" results (those are the same developer's other apps, not competitors).

Respond with ONLY a JSON array: [{ "name": string, "url": string | omit if not present }]. If no such section exists in the content, return an empty array.

Respond with ONLY the JSON array — no prose, no markdown code fences.`;

async function discoverViaSimilarApps(
  ownStoreUrls: AppStoreUrls | undefined,
  seedCandidates: Candidate[],
  appId: string
): Promise<Candidate[]> {
  const ownSeeds: { name: string; url: string }[] = [];
  if (ownStoreUrls?.play_store) ownSeeds.push({ name: "own Play Store listing", url: ownStoreUrls.play_store });
  if (ownStoreUrls?.app_store) ownSeeds.push({ name: "own App Store listing", url: ownStoreUrls.app_store });

  const discoveredSeeds = seedCandidates
    .filter((c) => !!c.url)
    .slice(0, Math.max(0, 3 - ownSeeds.length))
    .map((c) => ({ name: c.name, url: c.url! }));

  const seeds = [...ownSeeds, ...discoveredSeeds].slice(0, 3);
  if (seeds.length === 0) return [];

  const firecrawl = createFirecrawlClient();
  const anthropic = createAnthropicClient();

  const resultsPerSeed = await Promise.all(
    seeds.map(async (seed) => {
      let markdown = "";
      try {
        const scraped = await firecrawl.scrapeUrl(seed.url, { formats: ["markdown"], timeout: SCRAPE_TIMEOUT_MS });
        if ("markdown" in scraped && scraped.markdown) markdown = scraped.markdown;
      } catch (err) {
        logger.warn(
          `competitor-gap-analysis: Source 3 (similar_apps) scrape failed for "${seed.name}" (${seed.url})`,
          { appId, candidate: seed.name, error: err instanceof Error ? err.message : String(err) }
        );
        return [];
      }

      if (markdown.trim().length < 40) return [];

      const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
        anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 512,
          system: SIMILAR_APPS_EXTRACTION_PROMPT,
          messages: [{ role: "user", content: `=== LISTING PAGE: ${seed.name} ===\n${markdown.slice(0, 6000)}` }],
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
        const parsed = similarAppsSchema.parse(JSON.parse(responseText));
        logger.info(
          `competitor-gap-analysis: Source 3 (similar_apps) found ${parsed.length} similar app(s) on "${seed.name}"'s listing page`,
          { appId, seed: seed.name, count: parsed.length }
        );
        return parsed;
      } catch (err) {
        logger.warn(`competitor-gap-analysis: Source 3 (similar_apps) extraction unparseable for "${seed.name}"`, {
          appId,
          seed: seed.name,
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    })
  );

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const item of resultsPerSeed.flat()) {
    const key = item.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ name: item.name.trim(), source: "similar_apps", url: item.url });
  }

  return candidates;
}

// SOURCE 4 — store category browse. Google Play / the App Store expose
// fixed category slugs (e.g. Play's "LIFESTYLE", "PRODUCTIVITY"), but
// AppDna has no field that maps to that taxonomy today — product_type is
// only 6 coarse buckets ("mobile app"), and free-text problem/tagline
// can't be reliably turned into a real category slug without guessing at a
// URL that may not exist. Per spec: skip rather than guess. Returns [] and
// logs why, every run, so this is visible instead of silently absent —
// wiring this up for real needs a `store_category` field captured during
// DNA extraction.
function discoverViaCategoryBrowse(productType: ProductType, appId: string): Candidate[] {
  logger.info(
    `competitor-gap-analysis: Source 4 (category_browse) skipped for app ${appId} — no reliable store category slug can be derived from product_type ("${productType}") or DNA; would require a dedicated store_category field`,
    { appId, productType }
  );
  return [];
}

async function findCandidates(
  dna: AppDna,
  productType: ProductType,
  additionalContext: string | null,
  appId: string
): Promise<Candidate[]> {
  const dnaListed = (dna.competitors ?? []).filter(Boolean);
  const queries = buildDiscoveryQueries(dna, productType, additionalContext);
  const appStoreRelevant = hasAppStorePresence(dna, productType);

  logger.info(
    `competitor-gap-analysis: app-store relevance for app ${appId} — product_type="${productType}", dna.app_store_urls=${JSON.stringify(dna.app_store_urls ?? null)} → Sources 2/3 ${appStoreRelevant ? "ENABLED" : "disabled"}`,
    { appId, productType, appStoreUrls: dna.app_store_urls ?? null, appStoreRelevant }
  );

  if (queries.length === 0) {
    logger.warn(
      `competitor-gap-analysis: Step 1 has no functional search to run for app ${appId} — DNA has no problem/tagline/target_audience text`,
      { appId }
    );
  } else {
    logger.info(
      `competitor-gap-analysis: Step 1 built ${queries.length} discovery quer${queries.length === 1 ? "y" : "ies"} for app ${appId}: ${queries.map((q) => `"${q.query}" [${q.kind}]`).join(", ")}`,
      { appId, queries }
    );
  }

  const source1Names = await discoverViaWebSearch(queries, dna, appId);
  const source1Candidates: Candidate[] = source1Names.map(
    (name): Candidate => ({ name, source: "web_search" })
  );

  const source2Candidates = await discoverViaAppStoreSearch(queries, dna, productType, appId);

  const source3Candidates = await discoverViaSimilarApps(dna.app_store_urls, source2Candidates, appId);

  const source4Candidates = discoverViaCategoryBrowse(productType, appId);

  const bySource: { source: CandidateSource; list: Candidate[] }[] = [
    { source: "dna", list: dnaListed.map((name) => ({ name, source: "dna" as const })) },
    { source: "web_search", list: source1Candidates },
    { source: "app_store_search", list: source2Candidates },
    { source: "similar_apps", list: source3Candidates },
    { source: "category_browse", list: source4Candidates },
  ];

  const selfName = (dna.name ?? "").trim().toLowerCase();
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  let truncatedCount = 0;

  for (const { source, list } of bySource) {
    for (const candidate of list) {
      const key = candidate.name.trim().toLowerCase();
      if (!key || key === selfName || seen.has(key)) continue;
      // DNA-listed candidates are always kept (there are only ever a
      // handful); discovered candidates are capped so Step 2 verification
      // cost stays bounded.
      if (source !== "dna" && candidates.filter((c) => c.source !== "dna").length >= MAX_CANDIDATES_TO_VERIFY) {
        truncatedCount++;
        continue;
      }
      seen.add(key);
      candidates.push(candidate);
    }
  }

  logger.info(
    `competitor-gap-analysis: Step 1 discovery complete for app ${appId} — dna: ${dnaListed.length}, web_search: ${source1Candidates.length}, app_store_search: ${source2Candidates.length}, similar_apps: ${source3Candidates.length}, category_browse: ${source4Candidates.length} → ${candidates.length} unique candidate(s) after dedup${truncatedCount > 0 ? ` (${truncatedCount} discovered candidate(s) dropped by the MAX_CANDIDATES_TO_VERIFY=${MAX_CANDIDATES_TO_VERIFY} cap)` : ""}`,
    {
      appId,
      counts: {
        dna: dnaListed.length,
        web_search: source1Candidates.length,
        app_store_search: source2Candidates.length,
        similar_apps: source3Candidates.length,
        category_browse: source4Candidates.length,
        unique_after_dedup: candidates.length,
        truncated: truncatedCount,
      },
      candidates: candidates.map((c) => ({ name: c.name, source: c.source })),
    }
  );

  return candidates;
}

// ---------------------------------------------------------------------------
// STEP 2 — verification via Claude, not string/name matching.
//
// Every candidate from Step 1 — including ones the DNA already listed — is
// scraped and independently judged on what it actually does. Nothing skips
// this step; a DNA-listed name is not treated as pre-verified.
// ---------------------------------------------------------------------------

const verdictSchema = z.object({
  verdict: z.enum(["yes", "no"]),
  reason: z.string(),
});

const VERIFICATION_SYSTEM_PROMPT = `You verify whether a candidate product is a genuine competitor to a target software product.

You will be given the target product's problem statement, target audience, and category, plus a candidate product's name and real content scraped from its own website.

Does this candidate solve the same core problem, for a similar target audience, in the same product category as the target app? Judge this ONLY from what the candidate's own scraped content actually says it does — never from how similar its name sounds to the target product's name.

Respond with ONLY a JSON object: { "verdict": "yes" | "no", "reason": string }
"reason" must be one sentence, grounded in the candidate's actual described functionality (or lack of evidence, if the scrape didn't yield enough to judge).`;

interface VerifiedCandidate {
  name: string;
  source: CandidateSource;
  verified: boolean;
  reason: string;
  url?: string;
}

async function verifyCandidate(
  candidate: Candidate,
  dna: AppDna,
  productType: ProductType,
  appId: string
): Promise<VerifiedCandidate> {
  const { docs, error } = await searchWeb(`${candidate.name} official website`, 2);
  if (error || docs.length === 0) {
    const reason = "Could not locate the candidate's own website to verify what it actually does.";
    logger.warn(
      `competitor-gap-analysis: Step 2 REJECTED "${candidate.name}" (${candidate.source}) for app ${appId}: ${reason}`,
      { appId, candidate: candidate.name, source: candidate.source, reason }
    );
    return { ...candidate, verified: false, reason };
  }

  const candidateUrl = docs[0].url;
  let scrapedDescription = docs[0].content.slice(0, 2000);

  try {
    const firecrawl = createFirecrawlClient();
    const scraped = await firecrawl.scrapeUrl(candidateUrl, { formats: ["markdown"], timeout: SCRAPE_TIMEOUT_MS });
    if ("markdown" in scraped && scraped.markdown && scraped.markdown.trim().length > 40) {
      scrapedDescription = scraped.markdown.slice(0, 2000);
    }
  } catch (err) {
    logger.warn(
      `competitor-gap-analysis: Step 2 scrape failed for "${candidate.name}" (${candidateUrl}), falling back to search snippet`,
      { appId, candidate: candidate.name, error: err instanceof Error ? err.message : String(err) }
    );
  }

  const anthropic = createAnthropicClient();
  const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
    anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 250,
      system: VERIFICATION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `=== TARGET APP ===\nName: ${dna.name}\nCategory: ${PRODUCT_TYPE_LABEL[productType]}\nProblem: ${dna.problem}\nTarget audience: ${dna.target_audience}\n\n=== CANDIDATE: ${candidate.name} ===\nURL: ${candidateUrl}\n${scrapedDescription}`,
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

  let parsedVerdict: z.infer<typeof verdictSchema>;
  try {
    parsedVerdict = verdictSchema.parse(JSON.parse(responseText));
  } catch (err) {
    const reason = `Verification response was unparseable (${err instanceof Error ? err.message : String(err)}) — discarding rather than assuming a match.`;
    logger.warn(
      `competitor-gap-analysis: Step 2 REJECTED "${candidate.name}" (${candidate.source}) for app ${appId}: ${reason}`,
      { appId, candidate: candidate.name, source: candidate.source, url: candidateUrl }
    );
    return { ...candidate, verified: false, reason, url: candidateUrl };
  }

  const verified = parsedVerdict.verdict === "yes";
  const logPrefix = verified ? "VERIFIED" : "REJECTED";
  logger[verified ? "info" : "warn"](
    `competitor-gap-analysis: Step 2 ${logPrefix} "${candidate.name}" (${candidate.source}) for app ${appId}: ${parsedVerdict.reason}`,
    { appId, candidate: candidate.name, source: candidate.source, url: candidateUrl, verdict: parsedVerdict.verdict }
  );

  return { ...candidate, verified, reason: parsedVerdict.reason, url: candidateUrl };
}

export const competitorGapAnalysis = schemaTask({
  id: "competitor-gap-analysis",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;
    logger.info("competitor-gap-analysis: run started", { app_id, workspace_id });

    try {
      const { data: appRow, error: appError } = await supabaseAdmin
        .from("apps")
        .select("dna, product_type, additional_context")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appError) {
        throw new Error(`Failed to load app record: ${appError.message}`);
      }

      if (!appRow.dna) {
        logger.warn(`competitor-gap-analysis: app ${app_id} has no DNA yet, skipping`, { app_id });
        return { appId: app_id, savedCount: 0 };
      }

      const dna = appRow.dna as AppDna;
      const productType = (appRow.product_type as ProductType) ?? "other";
      const additionalContext = appRow.additional_context ?? null;

      // STEP 1
      const candidates = await findCandidates(dna, productType, additionalContext, app_id);

      if (candidates.length === 0) {
        logger.warn(
          `competitor-gap-analysis skipped for app ${app_id}: Step 1 found no candidates (no DNA-listed competitors and functional search found none)`,
          { app_id }
        );
        return { appId: app_id, savedCount: 0 };
      }

      // STEP 2 — every candidate is verified independently, regardless of
      // where it came from.
      const verifications = await Promise.all(
        candidates.map((c) => verifyCandidate(c, dna, productType, app_id))
      );
      const verifiedNames = verifications.filter((v) => v.verified).map((v) => v.name);
      const rejected = verifications.filter((v) => !v.verified);

      const verifiedBySource = verifications
        .filter((v) => v.verified)
        .reduce<Record<string, number>>((acc, v) => {
          acc[v.source] = (acc[v.source] ?? 0) + 1;
          return acc;
        }, {});

      logger.info(
        `competitor-gap-analysis: Step 2 complete for app ${app_id} — ${verifiedNames.length}/${candidates.length} candidate(s) verified. By source: ${
          Object.entries(verifiedBySource)
            .map(([source, count]) => `${source}=${count}`)
            .join(", ") || "(none)"
        }`,
        {
          app_id,
          verified: verifiedNames,
          verifiedBySource,
          rejected: rejected.map((v) => ({ name: v.name, source: v.source, reason: v.reason })),
        }
      );

      if (verifiedNames.length === 0) {
        logger.warn(
          `competitor-gap-analysis skipped for app ${app_id}: no candidates passed Step 2 verification`,
          { app_id }
        );
        return { appId: app_id, savedCount: 0 };
      }

      // Persist only the verified set — a DNA-listed name that failed
      // verification this run is dropped rather than silently kept, since
      // "do not treat DNA-listed competitors as automatically verified"
      // applies to what's stored, not just what's searched.
      await supabaseAdmin
        .from("apps")
        .update({ dna: { ...dna, competitors: verifiedNames } })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      const result = await runResearchStream({
        logger,
        appId: app_id,
        workspaceId: workspace_id,
        stream: "competitor_gap",
        buildQueries: (dna, { logger, appId }) => {
          const competitors = (dna.competitors ?? []).filter(Boolean).slice(0, MAX_COMPETITORS);
          if (competitors.length === 0) {
            logger.warn(
              `competitor-gap-analysis skipped for app ${appId}: no verified competitors to search reviews for`,
              { appId }
            );
            return [];
          }
          return competitors.flatMap((competitor) => [
            { query: `"${competitor}" reviews complaints`, label: competitor, limit: 3 },
            { query: `site:g2.com OR site:capterra.com "${competitor}"`, label: competitor, limit: 2 },
            // Newer/niche competitors rarely have G2/Capterra review volume
            // yet — Reddit/HN discussion is more likely to exist for those.
            {
              query: `site:reddit.com OR site:news.ycombinator.com "${competitor}"`,
              label: competitor,
              limit: 2,
            },
          ]);
        },
        systemPrompt: SYSTEM_PROMPT,
        itemsSchema: z.array(gapSchema).max(6),
        cadence: "monthly",
      });

      return result;
    } catch (err) {
      await handleJobError(err, {
        appId: app_id,
        workspaceId: workspace_id,
        jobName: "competitor-gap-analysis",
        updateAppStatus: false,
      });
      throw err;
    }
  },
});
