// SEO check registry — check IDs, weights, tiers, and polarity, transcribed
// directly from SCORING.md's "SEO check registry" tables. Data only; the
// actual per-check evaluation logic lives in lib/seo/evaluate.ts and the
// scoring math in lib/seo/scoring.ts.
//
// Two checks scoring.md specifies (seo.title.unique, seo.links.internal_in)
// require comparing this page against OTHER pages of the same app, or
// knowing who links TO this page — neither is computable yet since this
// tool only audits a single page (the app's own homepage) per run, with no
// full-site crawl or backlink graph. Both are marked `measurable: false` by
// their evaluator and excluded from the weighted mean (see
// lib/seo/scoring.ts) rather than assigned a fabricated pass/fail.
// seo.offpage.mention_trend is similarly not measurable until a second
// scoring run exists to compare against.

import type { SeoDimension } from "@/types";

export type CheckPolarity = "positive" | "penalty";

export interface SeoCheckDefinition {
  id: string;
  description: string;
  dimension: SeoDimension;
  weight: number; // within its dimension, weights sum to 1.0
  tier: 1 | 2 | 3;
  polarity: CheckPolarity;
  penaltyPoints?: number; // only set when polarity === "penalty"
}

export const RETRIEVABILITY_CHECKS: SeoCheckDefinition[] = [
  { id: "seo.index.crawlable", description: "Page not blocked by robots.txt or meta noindex", dimension: "retrievability", weight: 0.20, tier: 1, polarity: "positive" },
  { id: "seo.index.ai_accessible", description: "GPTBot, ClaudeBot, PerplexityBot not disallowed", dimension: "retrievability", weight: 0.15, tier: 1, polarity: "positive" },
  { id: "seo.sitemap.present", description: "sitemap.xml exists at root", dimension: "retrievability", weight: 0.08, tier: 1, polarity: "positive" },
  { id: "seo.sitemap.included", description: "This page URL is in the sitemap", dimension: "retrievability", weight: 0.10, tier: 1, polarity: "positive" },
  { id: "seo.rank.serp_position", description: "SerpAPI position for target query", dimension: "retrievability", weight: 0.20, tier: 1, polarity: "positive" },
  { id: "seo.title.present", description: "<title> tag exists and is non-empty", dimension: "retrievability", weight: 0.05, tier: 1, polarity: "positive" },
  { id: "seo.title.unique", description: "Title differs from other pages in this app", dimension: "retrievability", weight: 0.03, tier: 1, polarity: "positive" },
  { id: "seo.meta.description", description: "Meta description present", dimension: "retrievability", weight: 0.03, tier: 1, polarity: "positive" },
  { id: "seo.heading.h1_single", description: "Exactly one H1 on the page", dimension: "retrievability", weight: 0.04, tier: 1, polarity: "positive" },
  { id: "seo.heading.hierarchy", description: "H2s follow H1, H3s follow H2 (no skips)", dimension: "retrievability", weight: 0.03, tier: 2, polarity: "positive" },
  { id: "seo.schema.present", description: "Any schema.org markup present", dimension: "retrievability", weight: 0.03, tier: 2, polarity: "positive" },
  { id: "seo.schema.faq", description: "FAQ schema present (especially valuable for AI citation)", dimension: "retrievability", weight: 0.03, tier: 2, polarity: "positive" },
  { id: "seo.links.internal_in", description: "At least 2 other pages link to this one", dimension: "retrievability", weight: 0.02, tier: 2, polarity: "positive" },
  { id: "seo.links.internal_out", description: "This page links to at least 2 others", dimension: "retrievability", weight: 0.02, tier: 2, polarity: "positive" },
  { id: "seo.http.ok", description: "Page returns 200, no redirect chain > 1 hop", dimension: "retrievability", weight: 0.02, tier: 1, polarity: "positive" },
  { id: "seo.canonical.sane", description: "Canonical tag present and points to self or correct URL", dimension: "retrievability", weight: 0.02, tier: 1, polarity: "positive" },
  { id: "seo.penalty.keyword_stuffing", description: "Keyword density outlier (>4% for primary term)", dimension: "retrievability", weight: 0, tier: 1, polarity: "penalty", penaltyPoints: -15 },
  { id: "seo.penalty.thin_content", description: "Word count < 50% of median competitor page for same query", dimension: "retrievability", weight: 0, tier: 2, polarity: "penalty", penaltyPoints: -10 },
];

export const OFFPAGE_CHECKS: SeoCheckDefinition[] = [
  { id: "seo.offpage.mention_count", description: "Distinct third-party domains mentioning the brand", dimension: "off_page", weight: 0.40, tier: 1, polarity: "positive" },
  { id: "seo.offpage.mention_trend", description: "90-day mention trend (growing / flat / declining)", dimension: "off_page", weight: 0.20, tier: 1, polarity: "positive" },
  { id: "seo.offpage.branded_search", description: "Branded search volume trend via Google Trends", dimension: "off_page", weight: 0.20, tier: 1, polarity: "positive" },
  { id: "seo.offpage.community_presence", description: "Presence in Reddit/HN/Dev.to threads (reuse Forum Finder output)", dimension: "off_page", weight: 0.15, tier: 1, polarity: "positive" },
  { id: "seo.offpage.directory_presence", description: "Listed in ≥3 relevant product directories", dimension: "off_page", weight: 0.05, tier: 2, polarity: "positive" },
];

export const ALL_SEO_CHECKS: SeoCheckDefinition[] = [...RETRIEVABILITY_CHECKS, ...OFFPAGE_CHECKS];

export const SEO_CHECK_BY_ID: Map<string, SeoCheckDefinition> = new Map(
  ALL_SEO_CHECKS.map((c) => [c.id, c])
);

export const TIER_MULTIPLIERS: Record<1 | 2 | 3, number> = { 1: 1.0, 2: 0.75, 3: 0.4 };

export type ScoreBand = "needs_work" | "workable" | "strong";

export const SCORE_BAND_LABEL: Record<ScoreBand, string> = {
  needs_work: "Needs work",
  workable: "Workable",
  strong: "Strong",
};

export function getScoreBand(score: number): ScoreBand {
  if (score >= 75) return "strong";
  if (score >= 50) return "workable";
  return "needs_work";
}
