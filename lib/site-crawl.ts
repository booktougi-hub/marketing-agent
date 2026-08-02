import "server-only";
import { logger } from "@trigger.dev/sdk";
import type FirecrawlApp from "@mendable/firecrawl-js";
import { SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";

export interface CrawledPage {
  url: string;
  markdown: string;
}

// Finds links on a page whose visible text or URL matches any of the given
// keywords — e.g. "pricing"/"plans"/"price" for a pricing page. Originally
// lived only in trigger/brand-info-extraction.ts; pulled out here so every
// job that needs to discover a handful of secondary pages from a homepage
// scrape (instead of crawling the whole site) shares one implementation.
export function findLinksByKeywords(
  markdown: string,
  baseUrl: string,
  keywords: string[],
  limit: number
): string[] {
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

export interface PageDiscoverySpec {
  // Only used for log lines, e.g. "pricing".
  label: string;
  keywords: string[];
  // Common path guesses tried only when link discovery finds nothing for
  // this category — e.g. the nav is rendered client-side, so the scraped
  // markdown has no <a href="/pricing"> the regex above could find even
  // though /pricing genuinely exists. Skipped when link discovery already
  // found something, so we don't scrape a near-duplicate page.
  pathGuesses?: string[];
  limit: number;
}

// Discovers and scrapes a small, targeted set of secondary pages beyond the
// homepage. Every failure — a guessed path that doesn't exist, a scrape
// timeout, a malformed URL — is swallowed rather than thrown, since a
// missing secondary page should never fail the whole extraction; the
// homepage (and whatever other pages did resolve) may still be enough.
export async function discoverAndScrapeSecondaryPages(
  firecrawl: FirecrawlApp,
  homepageMarkdown: string,
  baseUrl: string,
  specs: PageDiscoverySpec[],
  jobName: string
): Promise<CrawledPage[]> {
  const seen = new Set<string>();
  const candidateUrls: string[] = [];

  for (const spec of specs) {
    const discovered = findLinksByKeywords(homepageMarkdown, baseUrl, spec.keywords, spec.limit);
    for (const url of discovered) {
      if (seen.has(url)) continue;
      seen.add(url);
      candidateUrls.push(url);
    }

    if (discovered.length === 0 && spec.pathGuesses) {
      for (const path of spec.pathGuesses.slice(0, spec.limit)) {
        try {
          const resolved = new URL(path, baseUrl).toString();
          if (seen.has(resolved)) continue;
          seen.add(resolved);
          candidateUrls.push(resolved);
        } catch {
          // Malformed base URL — skip.
        }
      }
    }
  }

  // Scraped concurrently, not one-at-a-time — with up to 4 candidate URLs
  // (features, pricing, docs, about) each carrying its own SCRAPE_TIMEOUT_MS
  // (45s) budget, a sequential loop had a ~3 minute worst case on top of the
  // homepage scrape and the Claude call, which is most of why extraction/
  // re-extraction could feel like it hangs. None of these requests depend
  // on each other, so there's no reason to serialize them.
  const results = await Promise.allSettled(
    candidateUrls.map((url) => firecrawl.scrapeUrl(url, { formats: ["markdown"], timeout: SCRAPE_TIMEOUT_MS }))
  );

  const pages: CrawledPage[] = [];
  results.forEach((result, i) => {
    const url = candidateUrls[i];
    if (result.status === "fulfilled") {
      const scraped = result.value;
      if ("markdown" in scraped && scraped.markdown && scraped.markdown.trim().length > 40) {
        pages.push({ url, markdown: scraped.markdown });
        logger.info(`${jobName}: scraped secondary page`, { url });
      }
    } else {
      // Covers both "page doesn't exist" (a guessed path with no real page
      // behind it) and real scrape failures — both are non-fatal here.
      logger.warn(`${jobName}: failed to scrape secondary page, continuing`, {
        url,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return pages;
}

// The four secondary-page categories DNA extraction looks for beyond the
// homepage. Kept as one shared constant so trigger/dna-extraction.ts (the
// full pipeline extraction) and trigger/dna-reextraction.ts (the narrow
// re-extraction job) always crawl the same set of pages.
export const DNA_PAGE_DISCOVERY_SPECS: PageDiscoverySpec[] = [
  {
    label: "features",
    keywords: ["feature", "features", "how it works", "how-it-works", "product"],
    pathGuesses: ["/features", "/how-it-works", "/product"],
    limit: 1,
  },
  {
    label: "pricing",
    keywords: ["pricing", "plans", "price"],
    pathGuesses: ["/pricing", "/plans"],
    limit: 1,
  },
  {
    label: "docs",
    keywords: ["docs", "documentation", "developer"],
    pathGuesses: ["/docs", "/documentation"],
    limit: 1,
  },
  {
    label: "about",
    keywords: ["about", "team", "company"],
    pathGuesses: ["/about", "/about-us", "/company"],
    limit: 1,
  },
];
