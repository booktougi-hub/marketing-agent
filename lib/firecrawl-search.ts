import "server-only";
import { createFirecrawlClient } from "@/lib/firecrawl-client";

// Shared by the research jobs (topic-research, problem-discovery,
// forum-opportunity-finder, competitor-gap-analysis) as their real data
// source. There's no Google Trends / Reddit / Twitter API wired into this
// project — Firecrawl (already used for DNA extraction) has a generic web
// search endpoint that supports `site:` operators, which covers the same
// ground without provisioning three more API keys.

// firecrawl.search() defaults its own `timeout` param to 60000ms
// server-side when the caller doesn't pass one, so this was never at risk
// of hanging indefinitely the way scrapeUrl() was — but 60s (65s including
// axios's +5s grace) per query is slow for a background job that's
// supposed to come back "sooner." 20s is still generous for a search+scrape
// call and fails over to the next source faster when a query is stalling.
const SEARCH_TIMEOUT_MS = 20_000;

export interface SearchResultDoc {
  url: string;
  title: string;
  content: string;
}

export interface SearchWebResult {
  docs: SearchResultDoc[];
  // Non-null only when the search call itself failed (Firecrawl returned
  // success: false, or the request threw) — distinct from a genuine
  // zero-result search, which has docs: [] and error: null. Callers used to
  // treat both cases identically, which made a broken API call
  // indistinguishable from "nothing out there."
  error: string | null;
}

export async function searchWeb(query: string, limit = 4): Promise<SearchWebResult> {
  const firecrawl = createFirecrawlClient();

  try {
    const response = await firecrawl.search(query, {
      limit,
      scrapeOptions: { formats: ["markdown"] },
      timeout: SEARCH_TIMEOUT_MS,
    });

    if (!response.success) {
      return {
        docs: [],
        error: response.error ?? "Firecrawl search returned success: false",
      };
    }

    const docs = (response.data ?? [])
      .filter(
        (doc): doc is typeof doc & { url: string; markdown: string } =>
          !!doc.url && !!doc.markdown && doc.markdown.trim().length > 40
      )
      .map((doc) => ({
        url: doc.url,
        title: doc.metadata?.title ?? doc.metadata?.ogTitle ?? doc.url,
        content: doc.markdown,
      }));

    return { docs, error: null };
  } catch (err) {
    return { docs: [], error: err instanceof Error ? err.message : String(err) };
  }
}
