import "server-only";

// Used only by competitor-gap-analysis's app-store discovery (Source 2).
// Firecrawl's search endpoint (lib/firecrawl-search.ts) is a general web
// search and doesn't reliably surface Google Play / App Store listing
// pages for niche apps — this hits SerpAPI's Google Search endpoint
// directly with a site: filter instead.

export interface StoreSearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface StoreSearchResponse {
  results: StoreSearchResult[];
  error: string | null;
}

interface SerpApiOrganicResult {
  link?: string;
  title?: string;
  snippet?: string;
}

interface SerpApiResponse {
  error?: string;
  organic_results?: SerpApiOrganicResult[];
}

export async function searchSerpApi(query: string, limit = 5): Promise<StoreSearchResponse> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return { results: [], error: "SERPAPI_KEY is not configured" };
  }

  try {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(limit));
    url.searchParams.set("api_key", apiKey);

    // Node's global fetch has no default timeout — an unresponsive request
    // would otherwise hang indefinitely (same class of bug as
    // firecrawl-js's scrapeUrl(), see lib/firecrawl-client.ts).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(url.toString(), { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return {
        results: [],
        error: `SerpAPI request failed: ${response.status} ${response.statusText}`,
      };
    }

    const data = (await response.json()) as SerpApiResponse;
    if (data.error) {
      return { results: [], error: data.error };
    }

    const results = (data.organic_results ?? [])
      .filter((r): r is SerpApiOrganicResult & { link: string } => !!r.link)
      .slice(0, limit)
      .map((r) => ({
        url: r.link,
        title: r.title ?? r.link,
        snippet: r.snippet ?? "",
      }));

    return { results, error: null };
  } catch (err) {
    return { results: [], error: err instanceof Error ? err.message : String(err) };
  }
}
