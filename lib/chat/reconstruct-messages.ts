import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { describeToolProposal, isMutatingTool } from "@/lib/chat/tools";
import type { ChatActionStatus, ChatMessage } from "@/types";

export interface PersistedMessageRow {
  id: string;
  role: "user" | "assistant";
  content: Anthropic.MessageParam["content"];
  created_at: string;
}

export interface PendingActionRow {
  id: string;
  tool_use_id: string;
  tool_name: string;
  tool_params: Record<string, unknown>;
  status: "pending" | "confirmed" | "executed" | "cancelled" | "expired";
}

const PENDING_STATUS_TO_ACTION_STATUS: Record<PendingActionRow["status"], ChatActionStatus> = {
  pending: "open",
  confirmed: "fixed",
  executed: "fixed",
  cancelled: "not_applicable",
  expired: "not_applicable",
};

function extractText(content: Anthropic.MessageParam["content"]): string {
  if (typeof content === "string") return content.trim();
  return content
    .filter((block): block is Anthropic.TextBlockParam => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function toolUseBlocksOf(content: Anthropic.MessageParam["content"]): Anthropic.ToolUseBlockParam[] {
  if (typeof content === "string") return [];
  return content.filter((block): block is Anthropic.ToolUseBlockParam => block.type === "tool_use");
}

// Rebuilds the panel-facing ChatMessage[] from raw chat_messages rows the
// same way app/api/chat/route.ts builds a single `replyMessage` per live
// turn — a stored row only becomes a visible bubble here if the live POST
// flow would have surfaced it that way. Everything else (tool_result
// plumbing rows, and the intermediate turn where a read-only tool gets
// called) is bookkeeping the founder never saw live and shouldn't reappear
// on reload.
export function reconstructChatMessages(
  rows: PersistedMessageRow[],
  pendingByToolUseId: Map<string, PendingActionRow>
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const row of rows) {
    if (row.role === "user") {
      const text = extractText(row.content);
      if (!text) continue; // pure tool_result row — internal, never shown live
      messages.push({ id: row.id, role: "user", kind: "text", content: text, createdAt: row.created_at });
      continue;
    }

    const toolUseBlocks = toolUseBlocksOf(row.content);
    const mutatingBlock = toolUseBlocks.find((block) => isMutatingTool(block.name));
    const pending = mutatingBlock ? pendingByToolUseId.get(mutatingBlock.id) : undefined;

    if (mutatingBlock && pending) {
      const copy = describeToolProposal(pending.tool_name, pending.tool_params);
      const text = extractText(row.content);
      messages.push({
        id: row.id,
        role: "assistant",
        kind: "confirm_action",
        content: text || `Here's what I'd like to do: ${copy.label}.`,
        confirmAction: {
          actionId: pending.id,
          label: copy.label,
          severity: copy.severity,
          description: copy.description,
          effect: copy.effect,
          status: PENDING_STATUS_TO_ACTION_STATUS[pending.status],
        },
        createdAt: row.created_at,
      });
      continue;
    }

    // A read-only tool call, or a mutating proposal that never got a
    // pending_chat_actions row (e.g. declined for insufficient credits
    // before one was created) — the live flow never showed this turn on
    // its own, only the text that followed it in a later row.
    if (toolUseBlocks.length > 0) continue;

    const text = extractText(row.content);
    if (!text) continue;
    messages.push({ id: row.id, role: "assistant", kind: "text", content: text, createdAt: row.created_at });
  }

  return messages;
}
