import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

export interface RawChatMessageRow {
  role: "user" | "assistant";
  content: Anthropic.MessageParam["content"];
  created_at: string;
}

export interface ToolResultRepairInsert {
  content: Anthropic.ToolResultBlockParam[];
  created_at: string;
}

export interface RepairPlan {
  // Full corrected message sequence, with a synthetic tool_result spliced
  // in wherever one was missing — safe to send to the Anthropic API as-is.
  repairedMessages: Anthropic.MessageParam[];
  // Rows to persist to chat_messages, in order, so the repair survives past
  // this one call instead of needing to be redone on every future turn.
  inserts: ToolResultRepairInsert[];
  // tool_use ids whose pending_chat_actions row (if still 'pending') should
  // be marked 'cancelled' — the founder moved on without confirming or
  // declining them.
  supersededToolUseIds: string[];
}

// Returns an ISO timestamp `deltaMicroseconds` after `iso`, at microsecond
// (not millisecond) precision. Needed because a repair row must sort
// strictly between two existing rows: batch inserts elsewhere in this
// codebase give consecutive rows created_at values exactly 1ms apart
// (`new Date(baseTime + index)` in app/api/chat/route.ts), so a plain
// "+1ms" nudge via `Date` can collide with — or land after — the very next
// row. Postgres `timestamptz` stores up to 6 fractional-second digits, so
// nudging by whole microseconds leaves ~999 of headroom below any 1ms gap.
// Falls back to a coarser millisecond nudge if the timestamp doesn't match
// the expected shape (should never happen for a value Postgres itself
// produced).
export function microsecondsAfter(iso: string, deltaMicroseconds: number): string {
  const match = iso.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!match) {
    return new Date(new Date(iso).getTime() + 1).toISOString();
  }
  const [, base, frac, tz = "Z"] = match;
  const fracMicros = frac ? Number(frac.slice(1).padEnd(6, "0").slice(0, 6)) : 0;
  const nudgedMicros = fracMicros + deltaMicroseconds;
  return `${base}.${String(nudgedMicros).padStart(6, "0")}${tz}`;
}

// Scans a conversation's full row history for any assistant tool_use block
// not immediately followed (in the very next row) by a matching tool_result,
// and plans a repair for each gap found — both an in-memory fix (for the
// call about to be made) and a persisted one (so the gap doesn't reopen on
// every future turn). Anthropic requires a tool_result for every tool_use
// in the very next message with no exceptions; once that invariant breaks
// anywhere in a conversation's history, EVERY future call in it 400s, since
// the full history is replayed on every turn.
//
// This isn't hypothetical — it's the confirmed cause of two distinct real
// failures in this app. (1) A mutating-tool proposal the founder never
// confirmed or declined before sending another message — this used to be
// patched only in-memory, for that one call, and never written back to
// chat_messages, so the very next message hit the identical 400 all over
// again. (2) The read-only tool branch used to assume its one follow-up
// call would always return plain text, when the model can legitimately
// chain a second tool call instead (see app/api/chat/route.ts's bounded
// read-only loop, which prevents new instances of this one going forward —
// but a conversation that hit it before that fix still carries the gap).
// Rather than patch each cause one-off (and risk missing a third), this
// repairs the invariant itself — any tool_use anywhere in history — so a
// conversation self-heals on its next message instead of staying
// permanently broken until someone manually repairs the data.
export function planToolUseRepairs(rows: RawChatMessageRow[]): RepairPlan {
  const repairedMessages: Anthropic.MessageParam[] = [];
  const inserts: ToolResultRepairInsert[] = [];
  const supersededToolUseIds: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    repairedMessages.push({ role: row.role, content: row.content });

    if (row.role !== "assistant" || !Array.isArray(row.content)) continue;
    const toolUseIds = row.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
      .map((block) => block.id);
    if (toolUseIds.length === 0) continue;

    const next = rows[i + 1];
    const resolvedIds = new Set(
      next && Array.isArray(next.content)
        ? next.content
            .filter((block): block is Anthropic.ToolResultBlockParam => block.type === "tool_result")
            .map((block) => block.tool_use_id)
        : []
    );

    const unresolvedIds = toolUseIds.filter((id) => !resolvedIds.has(id));
    if (unresolvedIds.length === 0) continue;

    supersededToolUseIds.push(...unresolvedIds);

    const repairContent: Anthropic.ToolResultBlockParam[] = unresolvedIds.map((id) => ({
      type: "tool_result" as const,
      tool_use_id: id,
      content: "Not resolved — this tool call was interrupted and was not completed.",
    }));

    repairedMessages.push({ role: "user", content: repairContent });
    inserts.push({ content: repairContent, created_at: microsecondsAfter(row.created_at, 1) });
  }

  return { repairedMessages, inserts, supersededToolUseIds };
}
