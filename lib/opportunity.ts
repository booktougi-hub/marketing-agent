// The `research_findings.findings` column is untyped jsonb, so this file is
// the closest thing to a schema for the 'forum_opportunities' stream —
// trigger/forum-opportunity-finder.ts is the real, built pipeline that
// writes it (see that file for the LLM output shape this parses). Every
// field is still parsed defensively rather than trusted, same as any other
// LLM-produced jsonb blob in this codebase.

export type OpportunityPlatform = "reddit" | "hackernews" | "quora" | "linkedin" | "x";

export type OpportunityRelevance = "high" | "medium" | "low";

// Fixed identity order — distinct from the content-platform set (this is a
// different categorical variable, X vs Twitter, no Instagram/Facebook/Dev.to)
// but reuses the same validated chart slots for a consistent design system.
export const OPPORTUNITY_PLATFORM_ORDER: OpportunityPlatform[] = [
  "reddit",
  "hackernews",
  "quora",
  "linkedin",
  "x",
];

export const OPPORTUNITY_PLATFORM_LABEL: Record<OpportunityPlatform, string> = {
  reddit: "Reddit",
  hackernews: "Hacker News",
  quora: "Quora",
  linkedin: "LinkedIn",
  x: "X",
};

export const OPPORTUNITY_PLATFORM_COLOR_VAR: Record<OpportunityPlatform, string> = {
  reddit: "var(--chart-1)",
  hackernews: "var(--chart-2)",
  quora: "var(--chart-3)",
  linkedin: "var(--chart-4)",
  x: "var(--chart-5)",
};

export const RELEVANCE_ORDER: OpportunityRelevance[] = ["high", "medium", "low"];

export const RELEVANCE_LABEL: Record<OpportunityRelevance, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

// High/medium are genuine states (act now / maybe), so they borrow the
// fixed status ramp rather than a categorical chart color. Low isn't a
// warning state, just lower priority, so it stays neutral ink.
export const RELEVANCE_COLOR_VAR: Record<OpportunityRelevance, string> = {
  high: "var(--status-good)",
  medium: "var(--status-warning)",
  low: "var(--color-muted-foreground)",
};

export interface ParsedOpportunity {
  platform: OpportunityPlatform | null;
  sourceName: string | null;
  title: string | null;
  url: string | null;
  content: string | null;
  postedAt: string | null;
  engagementCount: number | null;
  relevance: OpportunityRelevance | null;
  draftedReply: string | null;
}

function isOpportunityPlatform(value: unknown): value is OpportunityPlatform {
  return typeof value === "string" && (OPPORTUNITY_PLATFORM_ORDER as string[]).includes(value);
}

function isRelevance(value: unknown): value is OpportunityRelevance {
  return typeof value === "string" && (RELEVANCE_ORDER as string[]).includes(value);
}

export function parseForumOpportunity(raw: unknown): ParsedOpportunity {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  return {
    platform: isOpportunityPlatform(obj.platform) ? obj.platform : null,
    sourceName: typeof obj.source_name === "string" ? obj.source_name : null,
    title: typeof obj.title === "string" ? obj.title : null,
    url: typeof obj.url === "string" ? obj.url : null,
    content: typeof obj.content === "string" ? obj.content : null,
    postedAt: typeof obj.posted_at === "string" ? obj.posted_at : null,
    engagementCount: typeof obj.engagement_count === "number" ? obj.engagement_count : null,
    relevance: isRelevance(obj.relevance) ? obj.relevance : null,
    draftedReply: typeof obj.drafted_reply === "string" ? obj.drafted_reply : null,
  };
}
