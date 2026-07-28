// GEO check registry — check IDs, weights, tiers, and evaluators,
// transcribed directly from SCORING.md's "GEO check registry" tables. Data
// only; the actual per-check evaluation logic lives in lib/geo/evaluate.ts
// and the scoring math in lib/geo/scoring.ts. Mirrors
// lib/seo/checkRegistry.ts's structure exactly — see that file's header for
// why TIER_MULTIPLIERS/getScoreBand/ScoreBand are reused from there rather
// than duplicated (SCORING.md specifies the same tier multipliers and score
// bands for both tracks).
import type { GeoDimension } from "@/types";

export type GeoEvaluator = "llm" | "rule";
export type CheckPolarity = "positive" | "penalty";

export interface GeoCheckDefinition {
  id: string;
  description: string;
  dimension: GeoDimension;
  weight: number; // within its dimension, weights sum to 1.0
  tier: 1 | 2 | 3;
  evaluator: GeoEvaluator;
  polarity: CheckPolarity;
  penaltyPoints?: number; // only set when polarity === "penalty"
}

export const CONTENT_QUALITY_CHECKS: GeoCheckDefinition[] = [
  { id: "geo.content.answer_first", description: "Direct answer in first 1-2 sentences", dimension: "content_quality", weight: 0.25, tier: 2, evaluator: "llm", polarity: "positive" },
  { id: "geo.content.entity_clear", description: "\"X is a [category] that [does Y]\" stated early", dimension: "content_quality", weight: 0.20, tier: 2, evaluator: "llm", polarity: "positive" },
  { id: "geo.content.statistics", description: "≥1 specific verifiable statistic per major claim", dimension: "content_quality", weight: 0.20, tier: 3, evaluator: "llm", polarity: "positive" },
  { id: "geo.content.citations", description: "≥1 external credible source cited", dimension: "content_quality", weight: 0.20, tier: 3, evaluator: "llm", polarity: "positive" },
  { id: "geo.content.quotation", description: "≥1 quote-style attribution", dimension: "content_quality", weight: 0.15, tier: 3, evaluator: "llm", polarity: "positive" },
  { id: "geo.penalty.keyword_stuffing", description: "Keyword stuffing (measured 10% worse than doing nothing in GEO study)", dimension: "content_quality", weight: 0, tier: 1, evaluator: "rule", polarity: "penalty", penaltyPoints: -15 },
];

export const STRUCTURE_CHECKS: GeoCheckDefinition[] = [
  { id: "geo.structure.standalone_chunks", description: "Each H2 section readable standalone (no \"as mentioned above\")", dimension: "structure", weight: 0.30, tier: 2, evaluator: "llm", polarity: "positive" },
  { id: "geo.structure.faq_present", description: "Explicit FAQ section with Q&A format", dimension: "structure", weight: 0.25, tier: 2, evaluator: "rule", polarity: "positive" },
  { id: "geo.structure.fluency", description: "Passes a readability/fluency check (not machine-voice)", dimension: "structure", weight: 0.25, tier: 2, evaluator: "llm", polarity: "positive" },
  { id: "geo.structure.thin_vs_competitors", description: "Word count ≥50% of top-cited competitor pages for same query", dimension: "structure", weight: 0.20, tier: 2, evaluator: "rule", polarity: "positive" },
];

export const FRESHNESS_CHECKS: GeoCheckDefinition[] = [
  { id: "geo.freshness.published_within_1yr", description: "Published or updated within 12 months", dimension: "freshness", weight: 0.60, tier: 1, evaluator: "rule", polarity: "positive" },
  { id: "geo.freshness.published_within_2yr", description: "Published or updated within 24 months (partial credit)", dimension: "freshness", weight: 0.40, tier: 1, evaluator: "rule", polarity: "positive" },
];

export const ALL_GEO_CHECKS: GeoCheckDefinition[] = [
  ...CONTENT_QUALITY_CHECKS,
  ...STRUCTURE_CHECKS,
  ...FRESHNESS_CHECKS,
];

export const GEO_CHECK_BY_ID: Map<string, GeoCheckDefinition> = new Map(
  ALL_GEO_CHECKS.map((c) => [c.id, c])
);

// Same 1.0/0.75/0.4 multipliers and 0-49/50-74/75-100 bands SCORING.md
// specifies for the SEO track — re-exported here so callers only ever need
// to import from lib/geo/checkRegistry.ts, not reach into lib/seo/ for a
// GEO computation.
export { TIER_MULTIPLIERS, getScoreBand, SCORE_BAND_LABEL, type ScoreBand } from "@/lib/seo/checkRegistry";
