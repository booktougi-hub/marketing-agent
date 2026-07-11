import "server-only";
import FirecrawlApp from "@mendable/firecrawl-js";

// Shared by the research jobs (topic-research, problem-discovery,
// forum-opportunity-finder, competitor-gap-analysis) as their real data
// source. There's no Google Trends / Reddit / Twitter API wired into this
// project — Firecrawl (already used for DNA extraction) has a generic web
// search endpoint that supports `site:` operators, which covers the same
// ground without provisioning three more API keys.

export interface SearchResultDoc {
  url: string;
  title: string;
  content: string;
}

export async function searchWeb(query: string, limit = 4): Promise<SearchResultDoc[]> {
  const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });

  const response = await firecrawl.search(query, {
    limit,
    scrapeOptions: { formats: ["markdown"] },
  });

  if (!response.success || !response.data) {
    return [];
  }

  return response.data
    .filter(
      (doc): doc is typeof doc & { url: string; markdown: string } =>
        !!doc.url && !!doc.markdown && doc.markdown.trim().length > 40
    )
    .map((doc) => ({
      url: doc.url,
      title: doc.metadata?.title ?? doc.metadata?.ogTitle ?? doc.url,
      content: doc.markdown,
    }));
}
