// Illustrative-only GEO score + findings — shown on the GEO panel
// (components/apps/app-geo-view.tsx) only as a fallback when no real
// trigger/seo-geo-audit.ts run has completed for this app yet, always next
// to a DemoDataBanner so it's never mistaken for a real result. Same
// pattern as lib/demoData/seoDemoData.ts. Never written to
// seo_geo_scores/seo_geo_findings — purely an in-code constant.
import type { GeoDimScores, SeoGeoCheckResultMap, SeoGeoFinding } from "@/types";

export const DEMO_GEO_SCORE = 47;

export const DEMO_GEO_DIM_SCORES: GeoDimScores = {
  content_quality: 52,
  structure: 44,
  freshness: 38,
};

export const DEMO_GEO_RUN_AT = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

export const DEMO_GEO_CHECK_RESULTS: SeoGeoCheckResultMap = {
  "geo.content.answer_first": { pass: false, value: {}, confidence: 0.85, measurable: true },
  "geo.content.entity_clear": { pass: true, value: {}, confidence: 0.9, measurable: true },
  "geo.content.statistics": { pass: false, value: { examples: [] }, confidence: 0.8, measurable: true },
  "geo.content.citations": { pass: false, value: { examples: [] }, confidence: 0.8, measurable: true },
  "geo.content.quotation": { pass: false, value: {}, confidence: 0.75, measurable: true },
  "geo.structure.standalone_chunks": { pass: true, value: {}, confidence: 0.8, measurable: true },
  "geo.structure.faq_present": { pass: false, value: {}, confidence: 0.95, measurable: true },
  "geo.structure.fluency": { pass: true, value: {}, confidence: 0.85, measurable: true },
  "geo.structure.thin_vs_competitors": { pass: true, value: {}, confidence: 0.8, measurable: true },
  "geo.freshness.published_within_1yr": { pass: false, value: {}, confidence: 0.95, measurable: true },
};

export const DEMO_GEO_FINDINGS: Pick<
  SeoGeoFinding,
  "id" | "check_id" | "dimension" | "evidence_tier" | "expected_gain" | "title" | "explanation" | "confidence_label" | "remediation" | "status"
>[] = [
  {
    id: "demo-geo-finding-1",
    check_id: "geo.content.statistics",
    dimension: "content_quality",
    evidence_tier: 3,
    expected_gain: 0.16,
    title: "No specific statistics back up your claims",
    explanation: "The page makes several claims about accuracy and speed without a specific, verifiable number attached to any of them — AI engines weight statistic-backed claims noticeably higher when choosing what to cite.",
    confidence_label: "low — one study found a 25-40% improvement; a later, more rigorous benchmark found these tactics often don't help and sometimes hurt. Cheap to do, so worth trying; don't expect large gains.",
    remediation: { type: "diff", section: "Introduction", before: "AISkillsGuard catches vulnerabilities fast.", after: "AISkillsGuard flags an average of 14 real vulnerabilities per 10,000 lines of code, in under 90 seconds." },
    status: "open",
  },
  {
    id: "demo-geo-finding-2",
    check_id: "geo.freshness.published_within_1yr",
    dimension: "freshness",
    evidence_tier: 1,
    expected_gain: 0.36,
    title: "Content hasn't been refreshed in over a year",
    explanation: "65% of AI bot hits target content published within the past year — this page's last-updated signal is older than that, which likely suppresses citation regardless of how good the content itself is.",
    confidence_label: "high — this finding replicates across multiple independent large-scale studies.",
    remediation: { type: "technical", instruction: "Refresh this page's content and update its published/modified date." },
    status: "open",
  },
];
