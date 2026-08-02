import "server-only";
import { logger } from "@trigger.dev/sdk";
import { searchWeb } from "@/lib/firecrawl-search";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";

// Live, on-demand forum/community search for the chat coordinator's
// search_forums_live tool (lib/chat/tools.ts) — distinct from
// get_forum_opportunities, which reads what the scheduled
// forum-opportunity-finder job already found and cached in
// research_findings. This hits the platform live, right now, for
// whatever the founder just asked about.
//
// Every function below returns a normalized ForumSearchResult instead of
// throwing — a failure on one platform (a timeout, a missing token, a
// scrape that comes back empty) must degrade to a plain "here's what
// happened" result the model can relay honestly, never an exception that
// kills the whole tool call or reads as a generic crash.
//
// Quora and LinkedIn are deliberately NOT covered by this tool. Both were
// evaluated and ruled out: Quora has no public search API and aggressively
// blocks scraping (repeated CAPTCHA/soft-block behavior, not a technical
// gap that a different approach would solve); LinkedIn has no viable
// public API for this kind of search at all — its API surface is
// partner-gated for content search. Don't add either back without a real
// change in what those platforms expose.
//
// X (Twitter) is also left out, but for a different reason: X's search API
// sits behind a paid tier (unlike the five platforms this tool covers,
// which are free/public at read-search granularity). Adding X needs a
// deliberate cost decision, not a default inclusion — confirm current API
// pricing before wiring it in.

export type ForumSearchPlatform = "reddit" | "hacker_news" | "product_hunt" | "stack_overflow" | "indie_hackers";

export interface ForumSearchHit {
  title: string;
  url: string;
  excerpt: string;
  engagement: number | null; // upvotes/points/answers, platform-dependent
  posted_at: string | null; // ISO date when the platform exposes one, else null
}

export interface ForumSearchResult {
  platform: ForumSearchPlatform;
  available: boolean; // false = this platform's search didn't run (not configured, or failed) — see `error`
  error: string | null;
  hits: ForumSearchHit[];
}

function ok(platform: ForumSearchPlatform, hits: ForumSearchHit[]): ForumSearchResult {
  return { platform, available: true, error: null, hits };
}

function unavailable(platform: ForumSearchPlatform, error: string): ForumSearchResult {
  return { platform, available: false, error, hits: [] };
}

const FETCH_TIMEOUT_MS = 15_000;

async function fetchJsonWithTimeout(url: string, init?: RequestInit): Promise<{ json: unknown; status: number } | { error: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    return { json: await res.json(), status: res.status };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- Reddit ----------------------------------------------------------------
// No dedicated Reddit API client exists in this project (confirmed: no
// REDDIT_CLIENT_ID/SECRET anywhere, no lib/reddit-client.ts) — the only
// existing "Reddit integration" is trigger/forum-opportunity-finder.ts and
// lib/research-job.ts using Firecrawl's generic web search
// (lib/firecrawl-search.ts) with a `site:reddit.com` filter, since Reddit's
// own API requires OAuth app credentials this project was never
// provisioned with (see lib/firecrawl-search.ts's own header comment).
// Reusing that exact mechanism here, not standing up a second, real Reddit
// API integration alongside it.
async function searchRedditLive(query: string): Promise<ForumSearchResult> {
  const { docs, error } = await searchWeb(`site:reddit.com ${query}`, 5);
  if (error) return unavailable("reddit", error);
  return ok(
    "reddit",
    docs.map((d) => ({ title: d.title, url: d.url, excerpt: d.content.slice(0, 300), engagement: null, posted_at: null }))
  );
}

// --- Hacker News (Algolia HN Search API) ------------------------------------
// Free, public, no auth. https://hn.algolia.com/api

interface AlgoliaHnHit {
  title: string | null;
  url: string | null;
  objectID: string;
  points: number | null;
  num_comments: number | null;
  created_at: string | null;
  story_text: string | null;
  comment_text: string | null;
}

async function searchHackerNewsLive(query: string): Promise<ForumSearchResult> {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`;
  const result = await fetchJsonWithTimeout(url);
  if ("error" in result) return unavailable("hacker_news", result.error);

  const hits = (result.json as { hits?: AlgoliaHnHit[] })?.hits ?? [];
  return ok(
    "hacker_news",
    hits.map((h) => ({
      title: h.title ?? "(untitled)",
      // Self-posts (Ask HN / Show HN) have no external `url` — the HN
      // discussion thread itself is the canonical link in that case.
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      excerpt: (h.story_text ?? h.comment_text ?? "").slice(0, 300),
      engagement: h.points,
      posted_at: h.created_at,
    }))
  );
}

// --- Stack Overflow (Stack Exchange API) ------------------------------------
// Free, no auth required for search-level read access.
// api.stackexchange.com/docs/advanced-search

interface StackExchangeItem {
  title: string;
  link: string;
  score: number;
  answer_count: number;
  is_answered: boolean;
  creation_date: number; // unix seconds
}

async function searchStackOverflowLive(query: string): Promise<ForumSearchResult> {
  const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=5`;
  const result = await fetchJsonWithTimeout(url);
  if ("error" in result) return unavailable("stack_overflow", result.error);

  const items = (result.json as { items?: StackExchangeItem[]; error_message?: string })?.items;
  const errorMessage = (result.json as { error_message?: string })?.error_message;
  if (errorMessage) return unavailable("stack_overflow", errorMessage);

  return ok(
    "stack_overflow",
    (items ?? []).map((it) => ({
      title: it.title,
      url: it.link,
      excerpt: `${it.is_answered ? "Answered" : "Unanswered"} · ${it.answer_count} answer${it.answer_count === 1 ? "" : "s"}`,
      engagement: it.score,
      posted_at: new Date(it.creation_date * 1000).toISOString(),
    }))
  );
}

// --- Product Hunt (official GraphQL API) ------------------------------------
// Requires a dev app token (PRODUCT_HUNT_API_TOKEN) — see .env.example.
//
// NOTE: this environment has no live network access to Product Hunt's API
// docs (https://api.producthunt.com/v2/docs) to verify the current schema
// against. The query below uses `posts(first, order)` — the field
// confirmed to exist as of the last-known v2 schema at training time — and
// filters client-side by title/tagline substring match, since a true
// server-side free-text search argument on `posts` could not be verified.
// If Product Hunt's schema has changed, this fails inside the try/catch
// below (graceful "couldn't search" result, not a crash) — check the docs
// link above and adjust the query if this consistently returns errors.
const PRODUCT_HUNT_QUERY = `
  query SearchPosts($first: Int!) {
    posts(first: $first, order: RANKING) {
      edges {
        node {
          id
          name
          tagline
          url
          votesCount
          createdAt
        }
      }
    }
  }
`;

interface ProductHuntPostNode {
  id: string;
  name: string;
  tagline: string;
  url: string;
  votesCount: number;
  createdAt: string;
}

async function searchProductHuntLive(query: string): Promise<ForumSearchResult> {
  const token = process.env.PRODUCT_HUNT_API_TOKEN;
  if (!token) {
    return unavailable("product_hunt", "Product Hunt search isn't configured — PRODUCT_HUNT_API_TOKEN is not set.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: PRODUCT_HUNT_QUERY, variables: { first: 20 } }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return unavailable("product_hunt", `HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      errors?: { message: string }[];
      data?: { posts?: { edges?: { node: ProductHuntPostNode }[] } };
    };
    if (json.errors && json.errors.length > 0) {
      return unavailable("product_hunt", json.errors[0]?.message ?? "Product Hunt API returned an error");
    }

    const edges = json.data?.posts?.edges ?? [];
    const lowerQuery = query.toLowerCase();
    const matches = edges
      .map((e) => e.node)
      .filter((n) => n.name.toLowerCase().includes(lowerQuery) || n.tagline.toLowerCase().includes(lowerQuery))
      .slice(0, 5);

    return ok(
      "product_hunt",
      matches.map((n) => ({
        title: `${n.name} — ${n.tagline}`,
        url: n.url,
        excerpt: n.tagline,
        engagement: n.votesCount,
        posted_at: n.createdAt,
      }))
    );
  } catch (err) {
    return unavailable("product_hunt", err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- Indie Hackers (Firecrawl scrape) ---------------------------------------
// No official API exists for Indie Hackers, so this is scraping-based and
// inherently more fragile than the other four platforms — two-tier
// fallback, both wrapped so a failure here never breaks the rest of a
// multi-platform tool call:
//  1. Scrape Indie Hackers' own search results page directly (most
//     relevant results when it works, but the exact URL/page structure
//     below is a best-effort guess — unverified without live network
//     access to indiehackers.com in this environment).
//  2. If that returns nothing usable, fall back to the same Firecrawl
//     site-filtered web search used for Reddit above.
//  3. If both fail, return a graceful "couldn't search Indie Hackers right
//     now" result rather than an error.
async function scrapeIndieHackersSearch(query: string): Promise<ForumSearchHit[] | null> {
  const firecrawl = createFirecrawlClient();
  const searchUrl = `https://www.indiehackers.com/search?q=${encodeURIComponent(query)}`;
  try {
    const result = await firecrawl.scrapeUrl(searchUrl, {
      formats: ["markdown"],
      timeout: SCRAPE_TIMEOUT_MS,
    });
    if (!("markdown" in result) || !result.markdown) return null;

    // Best-effort markdown link extraction — Indie Hackers post URLs are
    // under /post/... . Anything else on the page (nav, other IH links)
    // is filtered out rather than risked as a false positive.
    const matches = [...result.markdown.matchAll(/\[([^\]]+)\]\((https:\/\/www\.indiehackers\.com\/post\/[^\s)]+)\)/g)];
    if (matches.length === 0) return null;

    const seen = new Set<string>();
    const hits: ForumSearchHit[] = [];
    for (const m of matches) {
      const [, title, url] = m;
      if (seen.has(url) || !title.trim()) continue;
      seen.add(url);
      hits.push({ title: title.trim(), url, excerpt: "", engagement: null, posted_at: null });
      if (hits.length >= 5) break;
    }
    return hits.length > 0 ? hits : null;
  } catch (err) {
    logger.warn("scrapeIndieHackersSearch: direct scrape failed, will fall back to site-filtered search", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function searchIndieHackersLive(query: string): Promise<ForumSearchResult> {
  const direct = await scrapeIndieHackersSearch(query);
  if (direct) return ok("indie_hackers", direct);

  const { docs, error } = await searchWeb(`site:indiehackers.com ${query}`, 5);
  if (!error && docs.length > 0) {
    return ok(
      "indie_hackers",
      docs.map((d) => ({ title: d.title, url: d.url, excerpt: d.content.slice(0, 300), engagement: null, posted_at: null }))
    );
  }

  return unavailable("indie_hackers", "Couldn't search Indie Hackers right now.");
}

// --- Dispatcher --------------------------------------------------------------

export async function searchForumsLive(platform: ForumSearchPlatform, query: string): Promise<ForumSearchResult> {
  switch (platform) {
    case "reddit":
      return searchRedditLive(query);
    case "hacker_news":
      return searchHackerNewsLive(query);
    case "product_hunt":
      return searchProductHuntLive(query);
    case "stack_overflow":
      return searchStackOverflowLive(query);
    case "indie_hackers":
      return searchIndieHackersLive(query);
  }
}
