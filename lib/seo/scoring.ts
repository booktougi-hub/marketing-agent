import {
  ALL_SEO_CHECKS,
  OFFPAGE_CHECKS,
  RETRIEVABILITY_CHECKS,
  SEO_CHECK_BY_ID,
  TIER_MULTIPLIERS,
  type SeoCheckDefinition,
} from "@/lib/seo/checkRegistry";
import type { EvidenceTier, SeoDimScores, SeoGeoCheckResultMap, SeoGeoRemediation } from "@/types";

// Scoring math transcribed from SCORING.md's "SEO scoring math" section,
// with one necessary adaptation: scoring.md's weightedMean assumes every
// check in a dimension always has a result. Two checks (seo.title.unique,
// seo.links.internal_in) and sometimes two more (seo.rank.serp_position,
// seo.offpage.mention_trend, seo.penalty.thin_content) are `measurable:
// false` when this tool genuinely can't compute them yet (see
// lib/seo/evaluate.ts) — those are excluded and the remaining checks'
// weights are renormalized to sum to 1.0, rather than silently scoring a
// missing check as a pass or a fail.
function weightedMean(results: SeoGeoCheckResultMap, checks: SeoCheckDefinition[]): number {
  const measurable = checks.filter((c) => results[c.id]?.measurable);
  if (measurable.length === 0) return 0;
  const totalWeight = measurable.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = measurable.reduce((sum, c) => {
    const r = results[c.id];
    const value = r.pass ? 1 : 0;
    return sum + c.weight * value;
  }, 0);
  return weightedSum / totalWeight;
}

export interface SEOScore {
  retrievability: number;
  off_page: number;
  composite: number;
}

export function computeSEOScore(results: SeoGeoCheckResultMap): SEOScore {
  const retrievabilityChecks = RETRIEVABILITY_CHECKS.filter((c) => c.polarity === "positive");
  const penaltyChecks = RETRIEVABILITY_CHECKS.filter((c) => c.polarity === "penalty");

  const ret = weightedMean(results, retrievabilityChecks);
  const offpage = weightedMean(results, OFFPAGE_CHECKS);

  const retPenalty = penaltyChecks.reduce((sum, c) => {
    const r = results[c.id];
    if (r?.measurable && r.pass === false) return sum + (c.penaltyPoints ?? 0);
    return sum;
  }, 0);

  const retAdjusted = Math.max(0, ret * 100 + retPenalty);
  const offpageScore = Math.round(offpage * 100);

  return {
    retrievability: Math.round(retAdjusted),
    off_page: offpageScore,
    composite: Math.round(retAdjusted * 0.7 + offpageScore * 0.3),
  };
}

export function toDimScores(score: SEOScore): SeoDimScores {
  return { retrievability: score.retrievability, off_page: score.off_page };
}

// expected_gain per SCORING.md: weight * (1 - currentScore) * tierMultiplier.
// For a failed boolean check, currentScore is 0 (no partial credit), so this
// simplifies to weight * tierMultiplier — except seo.rank.serp_position,
// which does carry a partial "rankScore" even when it fails to place highly.
function expectedGain(check: SeoCheckDefinition, currentSubScore: number): number {
  return check.weight * (1 - currentSubScore) * TIER_MULTIPLIERS[check.tier as EvidenceTier];
}

interface FindingTemplate {
  title: string;
  dimension: "retrievability" | "off_page";
  explanation: (value: unknown) => string;
  remediation: (value: unknown) => SeoGeoRemediation;
}

const FINDING_TEMPLATES: Record<string, FindingTemplate> = {
  "seo.index.crawlable": {
    title: "Page is blocked from search crawlers",
    dimension: "retrievability",
    explanation: () => "robots.txt or a meta noindex tag is blocking this page from being crawled at all — search engines and AI engines can't index what they can't crawl.",
    remediation: () => ({ type: "technical", instruction: "Remove the Disallow rule covering this page in robots.txt, and remove any <meta name=\"robots\" content=\"noindex\"> tag from the page." }),
  },
  "seo.index.ai_accessible": {
    title: "AI crawlers are blocked from this page",
    dimension: "retrievability",
    explanation: () => "robots.txt disallows GPTBot, ClaudeBot, or PerplexityBot specifically — this page can never be cited by ChatGPT, Claude, or Perplexity even if it ranks well in Google.",
    remediation: () => ({ type: "technical", instruction: "Remove the Disallow rules for GPTBot, ClaudeBot, and PerplexityBot in robots.txt so AI engines can crawl this page.", snippet: "User-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /" }),
  },
  "seo.sitemap.present": {
    title: "No sitemap.xml found",
    dimension: "retrievability",
    explanation: () => "There's no sitemap.xml at the site root — sitemaps help search engines discover and prioritize your pages faster.",
    remediation: () => ({ type: "technical", instruction: "Generate and publish a sitemap.xml at your site root listing your key pages." }),
  },
  "seo.sitemap.included": {
    title: "This page is missing from the sitemap",
    dimension: "retrievability",
    explanation: () => "A sitemap.xml exists, but this page's URL isn't listed in it — it may be discovered more slowly or not at all.",
    remediation: () => ({ type: "technical", instruction: "Add this page's URL to sitemap.xml." }),
  },
  "seo.rank.serp_position": {
    title: "Not ranking for your core query",
    dimension: "retrievability",
    explanation: (value) => {
      const v = value as { query: string; position: number | null };
      return v.position
        ? `Currently ranking at position ${v.position} for "${v.query}" — SERP position #1 earns roughly 33% AI citation probability vs 13% at position #10, so climbing here compounds into AI citation too.`
        : `Not appearing in the top 20 results for "${v.query}" at all.`;
    },
    remediation: () => ({ type: "technical", instruction: "Improve on-page targeting (title, headings, content depth) for this query, and build more real off-page mentions — see the off-page findings below." }),
  },
  "seo.title.present": {
    title: "Missing a page title",
    dimension: "retrievability",
    explanation: () => "This page has no <title> tag — one of the most basic ranking signals is entirely absent.",
    remediation: () => ({ type: "technical", instruction: "Add a specific, descriptive <title> tag to this page." }),
  },
  "seo.meta.description": {
    title: "Missing a meta description",
    dimension: "retrievability",
    explanation: () => "No meta description is set — search engines often use this for the snippet shown in results, and its absence means a generic or truncated one gets shown instead.",
    remediation: () => ({ type: "technical", instruction: "Add a concise meta description (roughly 150-160 characters) summarizing this page." }),
  },
  "seo.heading.h1_single": {
    title: "Missing or duplicate H1",
    dimension: "retrievability",
    explanation: (value) => `Found ${(value as { h1Count: number }).h1Count} H1 heading(s) on this page — exactly one is the standard for a clear page topic signal.`,
    remediation: () => ({ type: "technical", instruction: "Use exactly one H1 heading that states the page's main topic; demote any others to H2." }),
  },
  "seo.heading.hierarchy": {
    title: "Heading levels skip a level",
    dimension: "retrievability",
    explanation: () => "Heading levels jump (e.g. H1 straight to H3) instead of following in order — this makes the page's structure harder for crawlers to parse.",
    remediation: () => ({ type: "technical", instruction: "Reorder headings so H2s always follow the H1 and H3s always follow an H2, with no skipped levels." }),
  },
  "seo.schema.present": {
    title: "No structured data (schema.org) on this page",
    dimension: "retrievability",
    explanation: () => "No schema.org markup was found — structured data helps both search engines and AI engines understand what this page actually is.",
    remediation: () => ({ type: "technical", instruction: "Add relevant schema.org JSON-LD markup (e.g. SoftwareApplication or Organization) to this page.", snippet: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"..."}</script>' }),
  },
  "seo.schema.faq": {
    title: "No FAQ schema",
    dimension: "retrievability",
    explanation: () => "This page has no FAQ schema markup — FAQ-structured content is especially valuable for AI engines pulling direct answers to cite.",
    remediation: () => ({ type: "technical", instruction: "Add an FAQ section with FAQPage schema markup covering the questions visitors actually ask about this product." }),
  },
  "seo.links.internal_out": {
    title: "Too few outbound internal links",
    dimension: "retrievability",
    explanation: (value) => `This page links to only ${(value as { count: number }).count} other page(s) on the same site — linking to at least 2 helps crawlers discover more of the site from here.`,
    remediation: () => ({ type: "technical", instruction: "Add links from this page to at least 2 other relevant pages on the same site." }),
  },
  "seo.http.ok": {
    title: "Page isn't returning a clean 200 response",
    dimension: "retrievability",
    explanation: (value) => `This page returned status ${(value as { statusCode: number | null }).statusCode ?? "unknown"} instead of a clean 200 — redirect chains and error statuses waste crawl budget and can hurt ranking.`,
    remediation: () => ({ type: "technical", instruction: "Confirm this URL resolves directly with a 200 status, with no redirect chain." }),
  },
  "seo.canonical.sane": {
    title: "Canonical tag missing or pointing elsewhere",
    dimension: "retrievability",
    explanation: (value) => {
      const canonical = (value as { canonical: string | null }).canonical;
      return canonical
        ? `The canonical tag points to "${canonical}", which doesn't match this page — this can cause search engines to index the wrong URL as the source of truth.`
        : "No canonical tag was found on this page.";
    },
    remediation: () => ({ type: "technical", instruction: "Add a <link rel=\"canonical\"> tag pointing to this page's own correct URL." }),
  },
  "seo.penalty.keyword_stuffing": {
    title: "Keyword density looks stuffed",
    dimension: "retrievability",
    explanation: (value) => `Your primary keyword appears at roughly ${(value as { density: number }).density}% density — above ~4% reads as keyword stuffing to search engines and is actively penalized, not just wasted effort.`,
    remediation: () => ({ type: "technical", instruction: "Reduce repetition of the primary keyword and rely on natural variations and related terms instead." }),
  },
  "seo.penalty.thin_content": {
    title: "Content is thin compared to competitors",
    dimension: "retrievability",
    explanation: (value) => {
      const v = value as { pageWordCount: number; competitorMedian: number };
      return `This page has ${v.pageWordCount} words, less than half the ${v.competitorMedian}-word median among the competitors ranking for the same space — thin pages tend to rank and get cited less.`;
    },
    remediation: () => ({ type: "technical", instruction: "Expand this page's content with substantive detail — specific features, use cases, and evidence — rather than padding." }),
  },
  "seo.offpage.mention_count": {
    title: "Very few sites mention this brand",
    dimension: "off_page",
    explanation: (value) => `Only ${(value as { mentionCount: number }).mentionCount} distinct third-party domain(s) currently mention this brand — off-page presence is 30% of the SEO score and compounds into AI citation likelihood.`,
    remediation: (value) => ({ type: "route_to_forum", reason: `Only ${(value as { mentionCount: number }).mentionCount} domains mention this brand today — genuine replies in relevant threads (see the Opportunities tab) are the most durable way to build more.` }),
  },
  "seo.offpage.mention_trend": {
    title: "Brand mentions are declining",
    dimension: "off_page",
    explanation: (value) => {
      const v = value as { current: number; prior: number };
      return `Distinct mentioning domains dropped from ${v.prior} to ${v.current} since the last check.`;
    },
    remediation: () => ({ type: "route_to_forum", reason: "Mentions are trending down — prioritize the queued forum opportunities this week." }),
  },
  "seo.offpage.branded_search": {
    title: "Branded search interest is declining",
    dimension: "off_page",
    explanation: () => "Google Trends shows declining search interest in this brand name over the recent period.",
    remediation: () => ({ type: "route_to_forum", reason: "Declining branded search often follows declining off-page visibility — community presence is the most direct lever." }),
  },
  "seo.offpage.community_presence": {
    title: "No community thread presence found yet",
    dimension: "off_page",
    explanation: () => "No Reddit, Hacker News, or Dev.to threads have been found where this product was a genuine fit to reply in.",
    remediation: () => ({ type: "route_to_forum", reason: "Run an Opportunity Scan to find real threads worth replying in." }),
  },
  "seo.offpage.directory_presence": {
    title: "Not listed in enough product directories",
    dimension: "off_page",
    explanation: (value) => `Found in ${(value as { count: number }).count} of the checked product directories — being listed in 3 or more is a cheap, durable off-page signal.`,
    remediation: () => ({ type: "technical", instruction: "Submit this product to relevant directories (Product Hunt, G2, Capterra, AlternativeTo, etc.)." }),
  },
};

export interface SEOFinding {
  check_id: string;
  dimension: "retrievability" | "off_page";
  evidence_tier: EvidenceTier;
  expected_gain: number;
  title: string;
  explanation: string;
  confidence_label: string;
  remediation: SeoGeoRemediation;
}

function confidenceLabelForTier(tier: EvidenceTier): string {
  if (tier === 1) return "high — this finding replicates across multiple independent large-scale studies.";
  if (tier === 2) return "moderate — supported by one credible study; not yet independently replicated at scale.";
  return "low — evidence disputed. Cheap to do, so worth trying; don't expect large gains.";
}

// Top 2 findings by expected_gain, per SCORING.md ("Surface top 2 findings
// only. Full list behind 'show all'."). Only failed, measurable checks are
// candidates — a passing check has nothing to fix.
export function generateSEOFindings(results: SeoGeoCheckResultMap): SEOFinding[] {
  const candidates: SEOFinding[] = [];

  for (const check of ALL_SEO_CHECKS) {
    if (check.polarity !== "positive" && check.id !== "seo.penalty.keyword_stuffing" && check.id !== "seo.penalty.thin_content") continue;
    const result = results[check.id];
    if (!result?.measurable || result.pass !== false) continue;

    const template = FINDING_TEMPLATES[check.id];
    if (!template) continue;

    const subScore = check.id === "seo.rank.serp_position" ? ((result.value as { rankScore?: number })?.rankScore ?? 0) : 0;
    const gain = check.polarity === "penalty" ? Math.abs(check.penaltyPoints ?? 0) / 100 : expectedGain(check, subScore);

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

export { SEO_CHECK_BY_ID };
