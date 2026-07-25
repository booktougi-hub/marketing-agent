import "server-only";

// Used by competitor-gap-analysis's app-store discovery (Source 2, with a
// site: filter) and by competitor-research's general competitor discovery.
// Firecrawl's search endpoint (lib/firecrawl-search.ts) is a general web
// search and doesn't reliably surface Google Play / App Store listing
// pages for niche apps — this hits SerpAPI's Google Search endpoint
// directly instead.

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

export interface TrendsResponse {
  // "rising" | "flat" | "declining" — computed from the slope of the last
  // few points of the interest-over-time series. Null when SerpAPI returned
  // too few data points to judge a trend, or the call failed.
  trend: "rising" | "flat" | "declining" | null;
  error: string | null;
}

// Used by lib/seo/evaluate.ts's seo.offpage.branded_search check — SerpAPI's
// Google Trends engine, same SERPAPI_KEY as searchSerpApi above (Google
// Trends has no separate official paid API of its own).
export async function searchGoogleTrends(query: string): Promise<TrendsResponse> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return { trend: null, error: "SERPAPI_KEY is not configured" };
  }

  try {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_trends");
    url.searchParams.set("q", query);
    url.searchParams.set("data_type", "TIMESERIES");
    url.searchParams.set("api_key", apiKey);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(url.toString(), { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return { trend: null, error: `SerpAPI Trends request failed: ${response.status} ${response.statusText}` };
    }

    const data = (await response.json()) as {
      error?: string;
      interest_over_time?: { timeline_data?: Array<{ values?: Array<{ extracted_value?: number }> }> };
    };
    if (data.error) {
      return { trend: null, error: data.error };
    }

    const points = (data.interest_over_time?.timeline_data ?? [])
      .map((p) => p.values?.[0]?.extracted_value)
      .filter((v): v is number => typeof v === "number");

    if (points.length < 4) {
      return { trend: null, error: null };
    }

    // Compare the average of the last quarter of points against the average
    // of the quarter before it — simple, robust to noisy week-to-week spikes.
    const quarterLen = Math.max(1, Math.floor(points.length / 4));
    const recent = points.slice(-quarterLen);
    const prior = points.slice(-quarterLen * 2, -quarterLen);
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const recentAvg = avg(recent);
    const priorAvg = avg(prior.length > 0 ? prior : recent);

    if (priorAvg === 0) return { trend: recentAvg > 0 ? "rising" : "flat", error: null };
    const change = (recentAvg - priorAvg) / priorAvg;
    if (change > 0.1) return { trend: "rising", error: null };
    if (change < -0.1) return { trend: "declining", error: null };
    return { trend: "flat", error: null };
  } catch (err) {
    return { trend: null, error: err instanceof Error ? err.message : String(err) };
  }
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
