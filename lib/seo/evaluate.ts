import "server-only";
import { logger } from "@trigger.dev/sdk";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";
import { searchSerpApi, searchGoogleTrends } from "@/lib/serpapi-search";
import type { SeoGeoCheckResultMap } from "@/types";

// Real evaluators for every SEO check in lib/seo/checkRegistry.ts, against
// SCORING.md's own definitions. Two checks are inherently not computable
// with a single-page audit (no full-site crawl or backlink graph exists in
// this tool) and are marked `measurable: false` rather than given a
// fabricated result — see checkRegistry.ts's header comment.

const FETCH_TIMEOUT_MS = 15_000;

async function fetchTextWithTimeout(url: string): Promise<{ text: string | null; status: number | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    const text = res.ok ? await res.text() : null;
    return { text, status: res.status };
  } catch {
    return { text: null, status: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

function pass(value: unknown, ok: boolean, confidence = 0.95): { pass: boolean; value: unknown; confidence: number; measurable: true } {
  return { pass: ok, value, confidence, measurable: true };
}

function notMeasurable(reason: string): { pass: null; value: unknown; confidence: number; measurable: false } {
  return { pass: null, value: reason, confidence: 0, measurable: false };
}

// --- robots.txt -------------------------------------------------------

interface RobotsRules {
  disallowsAll: (userAgent: string) => boolean;
}

function parseRobotsTxt(text: string): RobotsRules {
  const lines = text.split("\n").map((l) => l.trim());
  // Map of user-agent (lowercased) -> disallow paths for that group.
  const groups = new Map<string, string[]>();
  let currentAgents: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      // A new User-agent line after any non-user-agent directive starts a
      // new group; consecutive User-agent lines belong to the same group.
      if (currentAgents.length > 0 && !groups.has(currentAgents[0])) {
        // still building the same group
      }
      currentAgents = [...currentAgents, value.toLowerCase()];
      for (const agent of currentAgents) {
        if (!groups.has(agent)) groups.set(agent, []);
      }
    } else if (key === "disallow") {
      for (const agent of currentAgents) {
        groups.get(agent)?.push(value);
      }
    } else if (key && key !== "allow" && key !== "sitemap" && key !== "crawl-delay") {
      // Any other directive resets the "consecutive User-agent" grouping.
      currentAgents = [];
    }
  }

  return {
    disallowsAll(userAgent: string) {
      const agentKey = userAgent.toLowerCase();
      const specific = groups.get(agentKey);
      const wildcard = groups.get("*");
      const rules = specific ?? wildcard ?? [];
      return rules.some((rule) => rule === "/");
    },
  };
}

// --- sitemap.xml --------------------------------------------------------

function parseSitemapLocs(xml: string): string[] {
  const matches = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)];
  return matches.map((m) => m[1]);
}

// --- HTML/markdown parsing ----------------------------------------------

// Exported for reuse by lib/geo/evaluate.ts (FAQ-section detection, heading
// structure, word counts, keyword density, and date-signal extraction are
// all needed by GEO's rule-based checks too — same parsing, different
// checks built on top of it).
export function extractJsonLdBlocks(rawHtml: string): string[] {
  const matches = [...rawHtml.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  return matches.map((m) => m[1]);
}

function extractCanonical(rawHtml: string): string | null {
  const match = rawHtml.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

interface HeadingInfo {
  level: number;
  text: string;
}

export function extractMarkdownHeadings(markdown: string): HeadingInfo[] {
  const matches = [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)];
  return matches.map((m) => ({ level: m[1].length, text: m[2].trim() }));
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function extractOutboundLinks(markdown: string, ownHostname: string): string[] {
  const matches = [...markdown.matchAll(/\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)];
  const hosts = new Set<string>();
  for (const m of matches) {
    try {
      const host = new URL(m[1]).hostname.replace(/^www\./, "");
      if (host !== ownHostname.replace(/^www\./, "")) hosts.add(host);
    } catch {
      // ignore malformed URLs
    }
  }
  return [...hosts];
}

export function keywordDensity(markdown: string, keyword: string): number {
  if (!keyword.trim()) return 0;
  const totalWords = countWords(markdown);
  if (totalWords === 0) return 0;
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = markdown.match(new RegExp(`\\b${escaped}\\b`, "gi"));
  return ((matches?.length ?? 0) / totalWords) * 100;
}

// --- Scrape the target page once, reused across many checks -------------

export interface ScrapedPage {
  markdown: string;
  rawHtml: string;
  title: string | null;
  metaDescription: string | null;
  statusCode: number | null;
}

export async function scrapePage(pageUrl: string): Promise<ScrapedPage | null> {
  const firecrawl = createFirecrawlClient();
  try {
    const scraped = await firecrawl.scrapeUrl(pageUrl, {
      formats: ["markdown", "rawHtml"],
      timeout: SCRAPE_TIMEOUT_MS,
    });
    if (!("markdown" in scraped) || !scraped.markdown) {
      logger.warn(`scrapePage: scrape of ${pageUrl} returned no usable markdown`, {
        pageUrl,
        response: JSON.stringify(scraped).slice(0, 500),
      });
      return null;
    }
    const metadata = scraped.metadata as Record<string, unknown> | undefined;
    return {
      markdown: scraped.markdown,
      rawHtml: "rawHtml" in scraped && typeof scraped.rawHtml === "string" ? scraped.rawHtml : "",
      title: (metadata?.title as string) ?? (metadata?.ogTitle as string) ?? null,
      metaDescription: (metadata?.description as string) ?? null,
      statusCode: typeof metadata?.statusCode === "number" ? (metadata.statusCode as number) : null,
    };
  } catch (err) {
    logger.warn(`scrapePage: failed to scrape ${pageUrl}`, {
      pageUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface SeoEvaluationInput {
  pageUrl: string;
  scraped: ScrapedPage;
  brandName: string;
  primaryKeyword: string;
  targetQuery: string | null;
  competitorMarkdowns: string[]; // for thin-content comparison
  priorMentionCount: number | null; // from the last scoring run, if recent enough
  communityPresenceCount: number; // count of forum_opportunities findings for this app
}

export async function evaluateRetrievabilityChecks(
  input: SeoEvaluationInput
): Promise<SeoGeoCheckResultMap> {
  const { pageUrl, scraped } = input;
  const origin = new URL(pageUrl).origin;
  const hostname = new URL(pageUrl).hostname;
  const results: SeoGeoCheckResultMap = {};

  // robots.txt — shared fetch for both index.crawlable and index.ai_accessible
  const robotsResult = await fetchTextWithTimeout(`${origin}/robots.txt`);
  const metaNoindex = /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(scraped.rawHtml);
  if (robotsResult.text) {
    const robots = parseRobotsTxt(robotsResult.text);
    const blockedForEveryone = robots.disallowsAll("*");
    results["seo.index.crawlable"] = pass(
      { blockedForEveryone, metaNoindex },
      !blockedForEveryone && !metaNoindex
    );
    const aiBotsBlocked = ["gptbot", "claudebot", "perplexitybot"].some((bot) => robots.disallowsAll(bot));
    results["seo.index.ai_accessible"] = pass({ aiBotsBlocked }, !aiBotsBlocked);
  } else {
    // No robots.txt at all means nothing is disallowed by it.
    results["seo.index.crawlable"] = pass({ robotsTxtFound: false, metaNoindex }, !metaNoindex);
    results["seo.index.ai_accessible"] = pass({ robotsTxtFound: false }, true);
  }

  // sitemap.xml
  const sitemapResult = await fetchTextWithTimeout(`${origin}/sitemap.xml`);
  if (sitemapResult.text) {
    results["seo.sitemap.present"] = pass({ found: true }, true);
    const locs = parseSitemapLocs(sitemapResult.text);
    const included = locs.some((loc) => loc.replace(/\/$/, "") === pageUrl.replace(/\/$/, ""));
    results["seo.sitemap.included"] = pass({ locs: locs.slice(0, 5), included }, included);
  } else {
    results["seo.sitemap.present"] = pass({ found: false }, false);
    results["seo.sitemap.included"] = pass({ included: false }, false);
  }

  // SERP rank
  if (input.targetQuery) {
    const { results: serpResults, error } = await searchSerpApi(input.targetQuery, 20);
    if (!error) {
      const position = serpResults.findIndex((r) => {
        try {
          return new URL(r.url).hostname.replace(/^www\./, "") === hostname.replace(/^www\./, "");
        } catch {
          return false;
        }
      });
      const found = position !== -1;
      const rankScore = found ? Math.max(0, 1 - (position + 1) / 20) : 0;
      results["seo.rank.serp_position"] = {
        pass: found,
        value: { query: input.targetQuery, position: found ? position + 1 : null, rankScore },
        confidence: 0.9,
        measurable: true,
      };
    } else {
      results["seo.rank.serp_position"] = notMeasurable(`SerpAPI error: ${error}`);
    }
  } else {
    results["seo.rank.serp_position"] = notMeasurable("No target query could be derived from this app's DNA");
  }

  // Title
  results["seo.title.present"] = pass({ title: scraped.title }, !!scraped.title?.trim());
  // Not measurable — see file header comment.
  results["seo.title.unique"] = notMeasurable("Single-page audit — no other pages to compare against yet");

  // Meta description
  results["seo.meta.description"] = pass(
    { metaDescription: scraped.metaDescription },
    !!scraped.metaDescription?.trim()
  );

  // Headings
  const headings = extractMarkdownHeadings(scraped.markdown);
  const h1Count = headings.filter((h) => h.level === 1).length;
  results["seo.heading.h1_single"] = pass({ h1Count }, h1Count === 1);

  let hierarchyOk = true;
  let lastLevel = 0;
  for (const h of headings) {
    if (lastLevel > 0 && h.level > lastLevel + 1) {
      hierarchyOk = false;
      break;
    }
    lastLevel = h.level;
  }
  results["seo.heading.hierarchy"] = pass({ headings: headings.map((h) => h.level) }, hierarchyOk);

  // Schema.org
  const jsonLdBlocks = extractJsonLdBlocks(scraped.rawHtml);
  results["seo.schema.present"] = pass({ blockCount: jsonLdBlocks.length }, jsonLdBlocks.length > 0);
  const hasFaqSchema = jsonLdBlocks.some((b) => /faqpage/i.test(b));
  results["seo.schema.faq"] = pass({ hasFaqSchema }, hasFaqSchema);

  // Links
  results["seo.links.internal_in"] = notMeasurable("Requires a full-site crawl this tool doesn't perform yet");
  const outboundLinks = extractOutboundLinks(scraped.markdown, hostname);
  results["seo.links.internal_out"] = pass({ count: outboundLinks.length }, outboundLinks.length >= 2);

  // HTTP status
  results["seo.http.ok"] = pass({ statusCode: scraped.statusCode }, scraped.statusCode === null || scraped.statusCode === 200);

  // Canonical
  const canonical = extractCanonical(scraped.rawHtml);
  const canonicalSane =
    !!canonical &&
    (canonical.replace(/\/$/, "") === pageUrl.replace(/\/$/, "") ||
      (() => {
        try {
          return new URL(canonical, pageUrl).hostname.replace(/^www\./, "") === hostname.replace(/^www\./, "");
        } catch {
          return false;
        }
      })());
  results["seo.canonical.sane"] = pass({ canonical }, canonicalSane);

  // Penalties
  const density = keywordDensity(scraped.markdown, input.primaryKeyword);
  results["seo.penalty.keyword_stuffing"] = {
    pass: density <= 4,
    value: { density: Math.round(density * 100) / 100 },
    confidence: 0.85,
    measurable: true,
  };

  if (input.competitorMarkdowns.length > 0) {
    const pageWordCount = countWords(scraped.markdown);
    const competitorWordCounts = input.competitorMarkdowns.map(countWords).sort((a, b) => a - b);
    const median = competitorWordCounts[Math.floor(competitorWordCounts.length / 2)];
    const thin = median > 0 && pageWordCount < median * 0.5;
    results["seo.penalty.thin_content"] = {
      pass: !thin,
      value: { pageWordCount, competitorMedian: median },
      confidence: 0.8,
      measurable: true,
    };
  } else {
    results["seo.penalty.thin_content"] = notMeasurable("No competitor pages available for comparison yet");
  }

  return results;
}

export async function evaluateOffPageChecks(input: SeoEvaluationInput): Promise<SeoGeoCheckResultMap> {
  const results: SeoGeoCheckResultMap = {};
  const hostname = new URL(input.pageUrl).hostname.replace(/^www\./, "");

  const { results: mentionResults, error: mentionError } = await searchSerpApi(`"${input.brandName}"`, 10);
  if (!mentionError) {
    const distinctDomains = new Set(
      mentionResults
        .map((r) => {
          try {
            return new URL(r.url).hostname.replace(/^www\./, "");
          } catch {
            return null;
          }
        })
        .filter((h): h is string => !!h && h !== hostname)
    );
    const mentionCount = distinctDomains.size;
    results["seo.offpage.mention_count"] = pass({ mentionCount, domains: [...distinctDomains] }, mentionCount >= 3);

    if (input.priorMentionCount !== null) {
      const growing = mentionCount > input.priorMentionCount;
      const declining = mentionCount < input.priorMentionCount;
      results["seo.offpage.mention_trend"] = pass(
        { current: mentionCount, prior: input.priorMentionCount, trend: growing ? "growing" : declining ? "declining" : "flat" },
        !declining
      );
    } else {
      results["seo.offpage.mention_trend"] = notMeasurable("No prior scoring run yet to compare against");
    }
  } else {
    results["seo.offpage.mention_count"] = notMeasurable(`SerpAPI error: ${mentionError}`);
    results["seo.offpage.mention_trend"] = notMeasurable("Mention count unavailable this run");
  }

  const trendsResult = await searchGoogleTrends(input.brandName);
  if (trendsResult.trend) {
    results["seo.offpage.branded_search"] = pass({ trend: trendsResult.trend }, trendsResult.trend !== "declining");
  } else {
    results["seo.offpage.branded_search"] = notMeasurable(trendsResult.error ?? "Not enough Google Trends history yet");
  }

  results["seo.offpage.community_presence"] = pass(
    { count: input.communityPresenceCount },
    input.communityPresenceCount > 0
  );

  const { results: dirResults, error: dirError } = await searchSerpApi(
    `site:producthunt.com OR site:g2.com OR site:capterra.com OR site:alternativeto.net "${input.brandName}"`,
    10
  );
  if (!dirError) {
    const directoryDomains = new Set(
      dirResults
        .map((r) => {
          try {
            return new URL(r.url).hostname.replace(/^www\./, "");
          } catch {
            return null;
          }
        })
        .filter((h): h is string => !!h)
    );
    results["seo.offpage.directory_presence"] = pass(
      { count: directoryDomains.size, domains: [...directoryDomains] },
      directoryDomains.size >= 3
    );
  } else {
    results["seo.offpage.directory_presence"] = notMeasurable(`SerpAPI error: ${dirError}`);
  }

  return results;
}
