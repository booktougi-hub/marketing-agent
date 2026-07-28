import {
  ALL_GEO_CHECKS,
  CONTENT_QUALITY_CHECKS,
  FRESHNESS_CHECKS,
  GEO_CHECK_BY_ID,
  STRUCTURE_CHECKS,
  TIER_MULTIPLIERS,
  type GeoCheckDefinition,
} from "@/lib/geo/checkRegistry";
import type { EvidenceTier, GeoDimScores, SeoGeoCheckResultMap, SeoGeoRemediation } from "@/types";

// GEO scoring math — same weightedMean-with-renormalization shape as
// lib/seo/scoring.ts's computeSEOScore (see that file's header comment for
// why: not every check is always measurable, e.g. freshness checks when no
// date signal exists on the page, or thin_vs_competitors with no competitor
// pages yet — those are excluded and the remaining checks' weights
// renormalized, rather than silently scored as a pass or fail).
function weightedMean(results: SeoGeoCheckResultMap, checks: GeoCheckDefinition[]): number {
  const measurable = checks.filter((c) => results[c.id]?.measurable);
  if (measurable.length === 0) return 0;
  const totalWeight = measurable.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = measurable.reduce((sum, c) => {
    const r = results[c.id];
    return sum + c.weight * (r.pass ? 1 : 0);
  }, 0);
  return weightedSum / totalWeight;
}

export interface GEOScore {
  content_quality: number;
  structure: number;
  freshness: number;
  composite: number;
}

export function computeGEOScore(results: SeoGeoCheckResultMap): GEOScore {
  const contentPositiveChecks = CONTENT_QUALITY_CHECKS.filter((c) => c.polarity === "positive");
  const contentPenaltyChecks = CONTENT_QUALITY_CHECKS.filter((c) => c.polarity === "penalty");

  const content = weightedMean(results, contentPositiveChecks);
  const structure = weightedMean(results, STRUCTURE_CHECKS);
  const freshness = weightedMean(results, FRESHNESS_CHECKS);

  const contentPenalty = contentPenaltyChecks.reduce((sum, c) => {
    const r = results[c.id];
    if (r?.measurable && r.pass === false) return sum + (c.penaltyPoints ?? 0);
    return sum;
  }, 0);

  const contentAdjusted = Math.max(0, content * 100 + contentPenalty);
  const structureScore = Math.round(structure * 100);
  const freshnessScore = Math.round(freshness * 100);

  return {
    content_quality: Math.round(contentAdjusted),
    structure: structureScore,
    freshness: freshnessScore,
    composite: Math.round(contentAdjusted * 0.60 + structureScore * 0.25 + freshnessScore * 0.15),
  };
}

export function toDimScores(score: GEOScore): GeoDimScores {
  return { content_quality: score.content_quality, structure: score.structure, freshness: score.freshness };
}

function expectedGain(check: GeoCheckDefinition, currentSubScore: number): number {
  return check.weight * (1 - currentSubScore) * TIER_MULTIPLIERS[check.tier as EvidenceTier];
}

interface FindingTemplate {
  title: string;
  dimension: "content_quality" | "structure" | "freshness";
  explanation: (value: unknown) => string;
  remediation: (value: unknown) => SeoGeoRemediation;
}

const FINDING_TEMPLATES: Record<string, FindingTemplate> = {
  "geo.content.answer_first": {
    title: "No direct answer up front",
    dimension: "content_quality",
    explanation: () => "The first 1-2 sentences don't directly answer what this page is about — AI engines pulling a quick answer to cite tend to favor content that states its point immediately rather than building up to it.",
    remediation: () => ({ type: "diff", section: "Opening", before: "(current opening)", after: "Lead with a single direct sentence that answers the core question this page is about, before any framing or context." }),
  },
  "geo.content.entity_clear": {
    title: "Unclear what this product actually is",
    dimension: "content_quality",
    explanation: () => "The page doesn't clearly state \"X is a [category] that [does Y]\" early on — AI engines rely on this kind of explicit entity statement to categorize and cite a source correctly.",
    remediation: () => ({ type: "diff", section: "Opening", before: "(current opening)", after: "Add a plain \"[Product] is a [category] that [core function]\" statement in the first paragraph." }),
  },
  "geo.content.statistics": {
    title: "No specific statistics back up your claims",
    dimension: "content_quality",
    explanation: (value) => {
      const v = value as { examples?: string[] };
      return v.examples && v.examples.length > 0
        ? `Found ${v.examples.length} statistic(s), but not consistently enough — major claims should each carry a specific, verifiable number. Statistics, quotations, and citations each showed a 25-40% visibility lift in the Princeton GEO study.`
        : "No specific, verifiable statistics back up the claims on this page — AI engines weight statistic-backed claims noticeably higher when choosing what to cite.";
    },
    remediation: () => ({ type: "diff", section: "Claims", before: "A vague claim with no number attached.", after: "The same claim with a specific, verifiable number, percentage, or named study attached." }),
  },
  "geo.content.citations": {
    title: "No external sources cited",
    dimension: "content_quality",
    explanation: () => "This page doesn't cite or link to any external credible source — self-referential links don't count, and citing real external sources is one of the stronger measured GEO signals.",
    remediation: () => ({ type: "diff", section: "Body", before: "An unsupported claim.", after: "The same claim with a named or linked external source backing it." }),
  },
  "geo.content.quotation": {
    title: "No quote-style attribution",
    dimension: "content_quality",
    explanation: () => "No quote-style attribution (a customer, a named person, a study) appears on this page — quotations are one of the three signals the Princeton GEO study measured a visibility lift for.",
    remediation: () => ({ type: "diff", section: "Body", before: "(no quote present)", after: "Add a short, attributed quote — a customer testimonial or a named source — relevant to the section." }),
  },
  "geo.penalty.keyword_stuffing": {
    title: "Keyword density looks stuffed",
    dimension: "content_quality",
    explanation: (value) => `Your primary keyword appears at roughly ${(value as { density: number }).density}% density — the GEO study measured keyword stuffing as actively worse than doing nothing, not just wasted effort.`,
    remediation: () => ({ type: "technical", instruction: "Reduce repetition of the primary keyword and rely on natural variations and related terms instead." }),
  },
  "geo.structure.standalone_chunks": {
    title: "Sections don't read standalone",
    dimension: "structure",
    explanation: (value) => {
      const v = value as { weakSections?: string[] };
      return v.weakSections && v.weakSections.length > 0
        ? `These section(s) rely on earlier context to make sense (e.g. "as mentioned above"): ${v.weakSections.join(", ")}. AI engines often extract a single section, not the whole page — a section that assumes prior context won't extract cleanly.`
        : "One or more sections rely on earlier context to make sense rather than reading standalone.";
    },
    remediation: () => ({ type: "diff", section: "Flagged section", before: "A section referencing \"as mentioned above\" or similar.", after: "The same section rewritten to state what it needs on its own, without depending on earlier text." }),
  },
  "geo.structure.faq_present": {
    title: "No FAQ section",
    dimension: "structure",
    explanation: () => "This page has no explicit FAQ section in Q&A format — FAQ-structured content is one of the more reliable formats for AI engines pulling a direct answer to cite.",
    remediation: () => ({ type: "diff", section: "New FAQ section", before: "(none)", after: "Add an FAQ section covering the 4-6 questions visitors actually ask about this product, each as a direct question followed by a direct answer." }),
  },
  "geo.structure.fluency": {
    title: "Reads like machine-generated copy",
    dimension: "structure",
    explanation: (value) => {
      const v = value as { issues?: string[] };
      return v.issues && v.issues.length > 0
        ? `Fluency issues found: ${v.issues.join("; ")}.`
        : "This page doesn't read naturally — stilted phrasing or repetitive structure reads as machine-voice rather than genuine writing.";
    },
    remediation: () => ({ type: "technical", instruction: "Rewrite the flagged sections in a more natural, human voice — vary sentence structure and cut repetitive phrasing." }),
  },
  "geo.structure.thin_vs_competitors": {
    title: "Content is thin compared to competitors",
    dimension: "structure",
    explanation: (value) => {
      const v = value as { pageWordCount: number; competitorMedian: number };
      return `This page has ${v.pageWordCount} words, less than half the ${v.competitorMedian}-word median among the competitors ranking for the same space — thin pages tend to get cited less.`;
    },
    remediation: () => ({ type: "technical", instruction: "Expand this page's content with substantive detail — specific features, use cases, and evidence — rather than padding." }),
  },
  "geo.freshness.published_within_1yr": {
    title: "Content hasn't been refreshed in over a year",
    dimension: "freshness",
    explanation: (value) => {
      const v = value as { ageDays?: number };
      return `65% of AI bot hits target content published within the past year — this page's last-updated signal is ${v.ageDays ? `${Math.round(v.ageDays / 30)} months old` : "older than that"}, which likely suppresses citation regardless of how good the content itself is.`;
    },
    remediation: () => ({ type: "technical", instruction: "Refresh this page's content and update its published/modified date." }),
  },
  "geo.freshness.published_within_2yr": {
    title: "Content is over two years old",
    dimension: "freshness",
    explanation: (value) => {
      const v = value as { ageDays?: number };
      return `This page's last-updated signal is ${v.ageDays ? `${Math.round(v.ageDays / 365)} years old` : "over two years old"} — even the partial-credit freshness window has passed, which compounds the citation penalty beyond the 1-year check above.`;
    },
    remediation: () => ({ type: "technical", instruction: "Refresh this page's content and update its published/modified date." }),
  },
};

function confidenceLabelForTier(tier: EvidenceTier): string {
  if (tier === 1) return "high — this finding replicates across multiple independent large-scale studies.";
  if (tier === 2) return "moderate — supported by one credible study; not yet independently replicated at scale.";
  return "low — evidence disputed. Cheap to do, so worth trying; don't expect large gains.";
}

export interface GEOFinding {
  check_id: string;
  dimension: "content_quality" | "structure" | "freshness";
  evidence_tier: EvidenceTier;
  expected_gain: number;
  title: string;
  explanation: string;
  confidence_label: string;
  remediation: SeoGeoRemediation;
}

// Top 2 findings by expected_gain, per SCORING.md ("Surface top 2 findings
// only. Full list behind 'show all'."). Only failed, measurable checks are
// candidates — a passing check has nothing to fix. Same shape as
// lib/seo/scoring.ts's generateSEOFindings, kept as a parallel function
// (not a shared generic) since the two check registries and finding
// templates are independent per SCORING.md's "never merge the tracks" rule.
export function generateGEOFindings(results: SeoGeoCheckResultMap): GEOFinding[] {
  const candidates: GEOFinding[] = [];

  for (const check of ALL_GEO_CHECKS) {
    const result = results[check.id];
    if (!result?.measurable || result.pass !== false) continue;

    const template = FINDING_TEMPLATES[check.id];
    if (!template) continue;

    const gain = check.polarity === "penalty" ? Math.abs(check.penaltyPoints ?? 0) / 100 : expectedGain(check, 0);

    candidates.push({
      check_id: check.id,
      dimension: template.dimension,
      evidence_tier: check.tier,
      expected_gain: gain,
      title: template.title,
      explanation: template.explanation(result.value),
      confidence_label: confidenceLabelForTier(check.tier),
      remediation: template.remediation(result.value),
    });
  }

  return candidates.sort((a, b) => b.expected_gain - a.expected_gain).slice(0, 2);
}

export { GEO_CHECK_BY_ID };
