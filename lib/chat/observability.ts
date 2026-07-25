import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";

export interface DailyChatTokenStats {
  day: string; // YYYY-MM-DD
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  // cache_read / (input + cache_read) — the cache hit rate. Should be high
  // once a conversation has more than one turn; null when there's no data
  // for that day yet.
  cacheHitRate: number | null;
}

// Per-workspace daily rollup of chat token usage. A sudden jump in
// totalCacheCreationTokens usually means something in identityBlock or
// SCOPED_SYSTEM_PROMPT changed and broke the cached prefix — see
// lib/chat/assemble-context.ts / lib/chat/system-prompt.ts.
//
// No admin-gating exists anywhere in this codebase yet (checked before
// building this) — this is a plain server-only helper for whichever
// route/page ends up calling it once that's decided, not wired into any UI.
// The equivalent raw SQL is documented in SCHEMA.md's Query Patterns
// section for ad-hoc checks without going through the app at all.
export async function getDailyChatTokenStats(workspaceId: string, days = 30): Promise<DailyChatTokenStats[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabaseAdmin
    .from("chat_messages")
    .select("created_at, input_tokens, cache_read_input_tokens, cache_creation_input_tokens")
    .eq("workspace_id", workspaceId)
    .gte("created_at", since);

  const byDay = new Map<string, { input: number; cacheRead: number; cacheCreation: number }>();
  for (const row of data ?? []) {
    const day = String(row.created_at).slice(0, 10);
    const bucket = byDay.get(day) ?? { input: 0, cacheRead: 0, cacheCreation: 0 };
    bucket.input += row.input_tokens ?? 0;
    bucket.cacheRead += row.cache_read_input_tokens ?? 0;
    bucket.cacheCreation += row.cache_creation_input_tokens ?? 0;
    byDay.set(day, bucket);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, bucket]) => ({
      day,
      totalInputTokens: bucket.input,
      totalCacheReadTokens: bucket.cacheRead,
      totalCacheCreationTokens: bucket.cacheCreation,
      cacheHitRate: bucket.input + bucket.cacheRead > 0 ? bucket.cacheRead / (bucket.input + bucket.cacheRead) : null,
    }));
}
