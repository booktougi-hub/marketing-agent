import "server-only";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { searchWeb, type SearchResultDoc } from "@/lib/firecrawl-search";
import { callExternalService, ExternalServiceError } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import type { AppDna } from "@/types";

// Shared orchestration for the four research jobs (topic-research,
// problem-discovery, forum-opportunity-finder, competitor-gap-analysis) —
// same shape every time: load DNA, search the web, hand results + DNA to
// Claude, validate the JSON it returns, insert one research_findings row
// per item. Each job only supplies what's actually different: its queries,
// its system prompt, and its item schema.

const CLAUDE_MODEL = "claude-sonnet-5";

export function getMondayOfCurrentWeek(): string {
  const now = new Date();
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday)
  );
  return monday.toISOString().slice(0, 10);
}

export function getFirstOfCurrentMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

// Shared by problem-discovery and competitor-gap-analysis's competitor
// discovery — DNA fields like target_audience/problem are full descriptive
// sentences, not search terms. Dropping one in verbatim (or worse,
// exact-quoting it) produces a query that structurally can't match
// anything real. This strips stopwords/punctuation and caps the length so
// the result is an actual keyword phrase a person might type.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "for", "nor", "so", "yet", "of", "in", "on", "at", "to",
  "from", "by", "with", "without", "who", "whose", "that", "which", "this", "these", "those",
  "their", "them", "they", "need", "needs", "needing", "looking", "seeking", "want", "wants",
  "wanting", "before", "after", "while", "during", "is", "are", "was", "were", "be", "being",
  "been", "can", "could", "should", "would", "will", "shall", "may", "might", "must", "have",
  "has", "had", "do", "does", "did", "it", "its", "as", "if", "then", "than", "also", "such",
  "via", "using", "use", "used", "into", "both", "make", "makes", "hassle",
]);

export function extractKeyPhrase(text: string | undefined | null, maxWords = 6): string {
  if (!text) return "";
  const words = text
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
  return words.slice(0, maxWords).join(" ");
}

export interface ResearchSearchQuery {
  query: string;
  limit?: number;
  // Attached to each result from this query so the prompt (and Claude) can
  // see which source it came from — e.g. "reddit", "google_trends".
  label?: string;
}

interface ResearchLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
}

// Passed to buildQueries/buildFallbackQueries so a job can log its own
// specific reason for returning no queries (e.g. "no competitors listed")
// instead of the generic catch-all below being the only trace of why.
export interface BuildQueriesHelpers {
  logger: ResearchLogger;
  appId: string;
}

export async function runResearchStream<T>({
  logger,
  appId,
  workspaceId,
  stream,
  buildQueries,
  buildFallbackQueries,
  systemPrompt,
  itemsSchema,
  cadence = "weekly",
}: {
  logger: ResearchLogger;
  appId: string;
  workspaceId: string;
  stream: "topic_research" | "problem_discovery" | "forum_opportunities" | "competitor_gap";
  buildQueries: (dna: AppDna, helpers: BuildQueriesHelpers) => ResearchSearchQuery[];
  // Tried once, only if buildQueries's own queries come back with zero raw
  // search results — broader/differently-derived terms as a second attempt
  // before giving up entirely.
  buildFallbackQueries?: (dna: AppDna, helpers: BuildQueriesHelpers) => ResearchSearchQuery[];
  systemPrompt: string;
  itemsSchema: z.ZodType<T[]>;
  // "week_of" doubles as the month-start date for streams that run on a
  // monthly cadence (competitor-gap-analysis) — the column name and
  // semantics ("the period this research covers") stay the same either way.
  cadence?: "weekly" | "monthly";
}): Promise<{ appId: string; savedCount: number }> {
  const { data: app, error: appError } = await supabaseAdmin
    .from("apps")
    .select("dna")
    .eq("id", appId)
    .eq("workspace_id", workspaceId)
    .single();

  if (appError) {
    throw new Error(`Failed to load app record: ${appError.message}`);
  }

  if (!app.dna) {
    logger.warn(`${stream}: app has no DNA yet, skipping`, { appId });
    return { appId, savedCount: 0 };
  }

  const dna = app.dna as AppDna;
  const helpers: BuildQueriesHelpers = { logger, appId };

  // Runs a batch of queries and logs each one's outcome individually — a
  // failed API call (searchWeb's error field set) is now logged distinctly
  // from a query that just genuinely found nothing, rather than both
  // collapsing into the same silent empty array.
  async function runQueries(queries: ResearchSearchQuery[]) {
    const resultsPerQuery = await Promise.all(
      queries.map(async (q) => {
        const { docs, error } = await searchWeb(q.query, q.limit ?? 4);
        const label = q.label ? ` (${q.label})` : "";
        if (error) {
          logger.warn(`${stream}: search failed for query "${q.query}"${label}: ${error}`, {
            appId,
            query: q.query,
            label: q.label,
          });
        } else {
          logger.info(`${stream}: query "${q.query}"${label} returned ${docs.length} result(s)`, {
            appId,
            query: q.query,
            label: q.label,
            count: docs.length,
          });
        }
        return docs.map((doc) => ({ ...doc, label: q.label }));
      })
    );
    return resultsPerQuery.flat() as (SearchResultDoc & { label?: string })[];
  }

  const queries = buildQueries(dna, helpers);

  if (queries.length === 0) {
    // Each job's own buildQueries should already have logged its specific
    // reason before returning empty — this is just a catch-all in case it
    // didn't.
    logger.info(`${stream}: no queries to run for this app's DNA`, { appId });
    return { appId, savedCount: 0 };
  }

  let results = await runQueries(queries);

  if (results.length === 0 && buildFallbackQueries) {
    logger.warn(
      `${stream}: primary queries returned 0 results — retrying once with broader fallback terms`,
      { appId }
    );
    const fallbackQueries = buildFallbackQueries(dna, helpers);
    if (fallbackQueries.length > 0) {
      results = await runQueries(fallbackQueries);
    }
  }

  if (results.length === 0) {
    logger.warn(`${stream}: no search results found for any query — nothing to send to Claude`, {
      appId,
    });
    return { appId, savedCount: 0 };
  }

  const searchContext = results
    .map(
      (r, i) =>
        `[Result ${i + 1}${r.label ? ` — source: ${r.label}` : ""}]\nURL: ${r.url}\nTitle: ${r.title}\n${r.content.slice(0, 1500)}`
    )
    .join("\n\n---\n\n");

  const anthropic = createAnthropicClient();
  const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
    anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `=== PRODUCT DNA ===\n${JSON.stringify(dna, null, 2)}\n\n=== SEARCH RESULTS ===\n${searchContext}`,
        },
      ],
    })
  );

  let responseText = "";
  for (const block of message.content) {
    if (block.type === "text") responseText += block.text;
  }
  responseText = responseText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  let items: T[];
  try {
    items = itemsSchema.parse(JSON.parse(responseText));
  } catch (err) {
    logger.warn(`${stream}: Claude returned an unparseable response`, {
      appId,
      raw_response: responseText.slice(0, 2000),
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ExternalServiceError(ErrorMessages.external.CLAUDE_FAILED, "claude");
  }

  if (items.length === 0) {
    logger.info(`${stream}: Claude found nothing relevant`, { appId });
    return { appId, savedCount: 0 };
  }

  const weekOf = cadence === "monthly" ? getFirstOfCurrentMonth() : getMondayOfCurrentWeek();
  const rows = items.map((item) => ({
    workspace_id: workspaceId,
    app_id: appId,
    stream,
    findings: item,
    status: "active",
    week_of: weekOf,
  }));

  const { error: insertError } = await supabaseAdmin.from("research_findings").insert(rows);
  if (insertError) {
    throw new Error(`Failed to save ${stream} findings: ${insertError.message}`);
  }

  logger.info(`${stream}: saved ${rows.length} findings`, { appId });
  return { appId, savedCount: rows.length };
}
