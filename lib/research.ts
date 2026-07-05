// Like lib/opportunity.ts, these shapes describe what `research_findings.findings`
// (untyped jsonb) is expected to hold for each stream once its research
// pipeline exists (see PHASES.md V2.5/V4 scope) — every field is parsed
// defensively since these streams don't run yet.

export type TopicSource = "google_trends" | "reddit" | "twitter";
export type TopicTrend = "up" | "down" | "flat";

export const TOPIC_SOURCE_ORDER: TopicSource[] = ["google_trends", "reddit", "twitter"];

export const TOPIC_SOURCE_LABEL: Record<TopicSource, string> = {
  google_trends: "Google Trends",
  reddit: "Reddit",
  twitter: "Twitter",
};

export const TOPIC_SOURCE_COLOR_VAR: Record<TopicSource, string> = {
  google_trends: "var(--chart-1)",
  reddit: "var(--chart-2)",
  twitter: "var(--chart-3)",
};

export interface ParsedTopic {
  topic: string | null;
  searchVolume: number | null;
  trend: TopicTrend | null;
  source: TopicSource | null;
  angle: string | null;
}

export interface ParsedProblem {
  statement: string | null;
  sourcePlatform: string | null;
  sourceUrl: string | null;
  appFit: string | null;
}

export interface ParsedCompetitorGap {
  competitorName: string | null;
  gap: string | null;
  source: string | null;
  positioning: string | null;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function isTopicSource(value: unknown): value is TopicSource {
  return typeof value === "string" && (TOPIC_SOURCE_ORDER as string[]).includes(value);
}

function isTopicTrend(value: unknown): value is TopicTrend {
  return value === "up" || value === "down" || value === "flat";
}

export function parseTopic(raw: unknown): ParsedTopic {
  const obj = asRecord(raw);
  return {
    topic: asString(obj.topic),
    searchVolume: asNumber(obj.search_volume),
    trend: isTopicTrend(obj.trend) ? obj.trend : null,
    source: isTopicSource(obj.source) ? obj.source : null,
    angle: asString(obj.angle),
  };
}

export function parseProblem(raw: unknown): ParsedProblem {
  const obj = asRecord(raw);
  return {
    statement: asString(obj.statement),
    sourcePlatform: asString(obj.source_platform),
    sourceUrl: asString(obj.source_url),
    appFit: asString(obj.app_fit),
  };
}

export function parseCompetitorGap(raw: unknown): ParsedCompetitorGap {
  const obj = asRecord(raw);
  return {
    competitorName: asString(obj.competitor_name),
    gap: asString(obj.gap),
    source: asString(obj.source),
    positioning: asString(obj.positioning),
  };
}

interface WeekBoundRow {
  week_of: string | null;
  created_at: string;
}

// `week_of` models "the week this research covers" (SCHEMA.md), so prefer it;
// fall back to the calendar week (Mon-Sun, UTC) of the most recent row when
// it isn't populated.
export function getLatestWeekRows<T extends WeekBoundRow>(rows: T[]): T[] {
  if (rows.length === 0) return [];

  const withWeekOf = rows.filter((r) => r.week_of !== null);
  if (withWeekOf.length > 0) {
    const latestWeekOf = withWeekOf.reduce(
      (max, r) => (r.week_of! > max ? r.week_of! : max),
      withWeekOf[0].week_of!
    );
    return rows.filter((r) => r.week_of === latestWeekOf);
  }

  const latest = rows.reduce((max, r) => (r.created_at > max.created_at ? r : max), rows[0]);
  const latestDate = new Date(latest.created_at);
  const dayOfWeek = (latestDate.getUTCDay() + 6) % 7; // 0 = Monday
  const weekStart = Date.UTC(
    latestDate.getUTCFullYear(),
    latestDate.getUTCMonth(),
    latestDate.getUTCDate() - dayOfWeek
  );
  const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;

  return rows.filter((r) => {
    const time = new Date(r.created_at).getTime();
    return time >= weekStart && time < weekEnd;
  });
}

interface MonthBoundRow {
  created_at: string;
}

export function getLatestMonthRows<T extends MonthBoundRow>(rows: T[]): T[] {
  if (rows.length === 0) return [];

  const latest = rows.reduce((max, r) => (r.created_at > max.created_at ? r : max), rows[0]);
  const latestDate = new Date(latest.created_at);
  const targetMonth = `${latestDate.getUTCFullYear()}-${latestDate.getUTCMonth()}`;

  return rows.filter((r) => {
    const d = new Date(r.created_at);
    return `${d.getUTCFullYear()}-${d.getUTCMonth()}` === targetMonth;
  });
}
