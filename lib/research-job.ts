import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { searchWeb, type SearchResultDoc } from "@/lib/firecrawl-search";
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

export async function runResearchStream<T>({
  logger,
  appId,
  workspaceId,
  stream,
  buildQueries,
  systemPrompt,
  itemsSchema,
  cadence = "weekly",
}: {
  logger: ResearchLogger;
  appId: string;
  workspaceId: string;
  stream: "topic_research" | "problem_discovery" | "forum_opportunities" | "competitor_gap";
  buildQueries: (dna: AppDna) => ResearchSearchQuery[];
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
  const queries = buildQueries(dna);

  if (queries.length === 0) {
    logger.info(`${stream}: no queries to run for this app's DNA`, { appId });
    return { appId, savedCount: 0 };
  }

  const resultsPerQuery = await Promise.all(
    queries.map(async (q) => {
      const docs = await searchWeb(q.query, q.limit ?? 4);
      return docs.map((doc) => ({ ...doc, label: q.label }));
    })
  );
  const results: (SearchResultDoc & { label?: string })[] = resultsPerQuery.flat();

  if (results.length === 0) {
    logger.info(`${stream}: no search results found`, { appId });
    return { appId, savedCount: 0 };
  }

  const searchContext = results
    .map(
      (r, i) =>
        `[Result ${i + 1}${r.label ? ` — source: ${r.label}` : ""}]\nURL: ${r.url}\nTitle: ${r.title}\n${r.content.slice(0, 1500)}`
    )
    .join("\n\n---\n\n");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `=== PRODUCT DNA ===\n${JSON.stringify(dna, null, 2)}\n\n=== SEARCH RESULTS ===\n${searchContext}`,
      },
    ],
  });

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
    throw new Error(
      `Claude returned an unparseable ${stream} response: ${err instanceof Error ? err.message : String(err)}`
    );
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
