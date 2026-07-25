// Illustrative-only SEO score + findings — shown on the SEO panel
// (components/apps/app-seo-view.tsx) only as a fallback when no real
// trigger/seo-geo-audit.ts run has completed for this app yet, always next
// to a DemoDataBanner so it's never mistaken for a real result. Never
// written to seo_geo_scores/seo_geo_findings — purely an in-code constant,
// so there's nothing to clean up in the database once real data exists.
import type { SeoDimScores, SeoGeoCheckResultMap, SeoGeoFinding } from "@/types";

export const DEMO_SEO_SCORE = 61;

export const DEMO_SEO_DIM_SCORES: SeoDimScores = {
  retrievability: 68,
  off_page: 42,
};

export const DEMO_SEO_RUN_AT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

export const DEMO_SEO_CHECK_RESULTS: SeoGeoCheckResultMap = {
  "seo.index.crawlable": { pass: true, value: {}, confidence: 0.95, measurable: true },
  "seo.index.ai_accessible": { pass: true, value: {}, confidence: 0.95, measurable: true },
  "seo.sitemap.present": { pass: true, value: { found: true }, confidence: 0.95, measurable: true },
  "seo.sitemap.included": { pass: false, value: { included: false }, confidence: 0.95, measurable: true },
  "seo.rank.serp_position": { pass: false, value: { query: "ai code review tool", position: 14, rankScore: 0.3 }, confidence: 0.9, measurable: true },
  "seo.title.present": { pass: true, value: { title: "AISkillsGuard — AI-powered code review" }, confidence: 0.95, measurable: true },
  "seo.title.unique": { pass: null, value: "not measurable", confidence: 0, measurable: false },
  "seo.meta.description": { pass: true, value: {}, confidence: 0.95, measurable: true },
  "seo.heading.h1_single": { pass: true, value: { h1Count: 1 }, confidence: 0.95, measurable: true },
  "seo.heading.hierarchy": { pass: true, value: {}, confidence: 0.95, measurable: true },
  "seo.schema.present": { pass: false, value: { blockCount: 0 }, confidence: 0.95, measurable: true },
  "seo.schema.faq": { pass: false, value: { hasFaqSchema: false }, confidence: 0.95, measurable: true },
  "seo.links.internal_in": { pass: null, value: "not measurable", confidence: 0, measurable: false },
  "seo.links.internal_out": { pass: true, value: { count: 4 }, confidence: 0.95, measurable: true },
  "seo.http.ok": { pass: true, value: { statusCode: 200 }, confidence: 0.95, measurable: true },
  "seo.canonical.sane": { pass: true, value: {}, confidence: 0.95, measurable: true },
  "seo.penalty.keyword_stuffing": { pass: true, value: { density: 1.8 }, confidence: 0.85, measurable: true },
  "seo.penalty.thin_content": { pass: true, value: { pageWordCount: 640, competitorMedian: 580 }, confidence: 0.8, measurable: true },
  "seo.offpage.mention_count": { pass: false, value: { mentionCount: 2 }, confidence: 0.95, measurable: true },
  "seo.offpage.mention_trend": { pass: null, value: "no prior run", confidence: 0, measurable: false },
  "seo.offpage.branded_search": { pass: true, value: { trend: "rising" }, confidence: 0.7, measurable: true },
  "seo.offpage.community_presence": { pass: true, value: { count: 3 }, confidence: 0.95, measurable: true },
  "seo.offpage.directory_presence": { pass: false, value: { count: 1 }, confidence: 0.95, measurable: true },
};

export const DEMO_SEO_FINDINGS: Pick<
  SeoGeoFinding,
  "id" | "check_id" | "dimension" | "evidence_tier" | "expected_gain" | "title" | "explanation" | "confidence_label" | "remediation" | "status"
>[] = [
  {
    id: "demo-seo-finding-1",
    check_id: "seo.offpage.mention_count",
    dimension: "off_page",
    evidence_tier: 1,
    expected_gain: 0.4,
    title: "Very few sites mention this brand",
    explanation: "Only 2 distinct third-party domains currently mention this brand — off-page presence is 30% of the SEO score and compounds into AI citation likelihood.",
    confidence_label: "high — this finding replicates across multiple independent large-scale studies.",
    remediation: { type: "route_to_forum", reason: "Only 2 domains mention this brand today — genuine replies in relevant threads (see the Opportunities tab) are the most durable way to build more." },
    status: "open",
  },
  {
    id: "demo-seo-finding-2",
    check_id: "seo.rank.serp_position",
    dimension: "retrievability",
    evidence_tier: 1,
    expected_gain: 0.28,
    title: "Not ranking for your core query",
    explanation: "Currently ranking at position 14 for \"ai code review tool\" — SERP position #1 earns roughly 33% AI citation probability vs 13% at position #10, so climbing here compounds into AI citation too.",
    confidence_label: "high — this finding replicates across multiple independent large-scale studies.",
    remediation: { type: "technical", instruction: "Improve on-page targeting (title, headings, content depth) for this query, and build more real off-page mentions — see the off-page findings below." },
    status: "open",
  },
];
