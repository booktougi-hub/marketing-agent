import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { supabaseAdmin } from "@/lib/supabase-server";
import { assembleIdentityBlock } from "@/lib/chat/assemble-context";
import { SCOPED_SYSTEM_PROMPT } from "@/lib/chat/system-prompt";
import {
  CLAUDE_TOOL_DEFINITIONS,
  MUTATING_TOOL_HANDLERS,
  READ_ONLY_HANDLERS,
  describeToolProposal,
  isMutatingTool,
  type ChatToolContext,
} from "@/lib/chat/tools";
import { getRemainingCredits } from "@/lib/agentCredits";
import {
  reconstructChatMessages,
  type PendingActionRow,
  type PersistedMessageRow,
} from "@/lib/chat/reconstruct-messages";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { callExternalService, ForbiddenError, NotFoundError, RateLimitError, UnauthorizedError, ValidationError } from "@/lib/errors/AppError";
import type { ChatMessage, PlanTier } from "@/types";

const CLAUDE_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;

const postSchema = z.object({
  message: z.string().trim().min(1, ErrorMessages.chat.EMPTY_MESSAGE),
  appId: z.string().uuid().nullable().optional(),
});

const getQuerySchema = z.object({
  appId: z.string().uuid(),
});

// Shared by GET (history hydration) and POST (send) — one conversation per
// (app_id, user_id), created on first touch by either route.
async function getOrCreateConversation(appId: string, workspaceId: string, userId: string): Promise<string> {
  let { data: conversation } = await supabaseAdmin
    .from("chat_conversations")
    .select("id")
    .eq("app_id", appId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!conversation) {
    const { data: created, error: createError } = await supabaseAdmin
      .from("chat_conversations")
      .insert({ app_id: appId, workspace_id: workspaceId, user_id: userId })
      .select("id")
      .single();
    if (createError || !created) {
      throw new ForbiddenError(ErrorMessages.generic.UNKNOWN, "CONVERSATION_CREATE_FAILED");
    }
    conversation = created;
  }
  return conversation.id as string;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_MESSAGES = 10;

// Simple sliding window: count this user's user-authored chat messages
// (across every app/conversation) in the last 60s, computed fresh on every
// request rather than a fixed bucket — no rate-limit utility exists
// elsewhere in the project to reuse (checked).
async function checkChatRateLimit(userId: string) {
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count } = await supabaseAdmin
    .from("chat_messages")
    .select("id, chat_conversations!inner(user_id)", { count: "exact", head: true })
    .eq("role", "user")
    .eq("chat_conversations.user_id", userId)
    .gte("created_at", cutoff);

  if ((count ?? 0) >= RATE_LIMIT_MAX_MESSAGES) {
    throw new RateLimitError(ErrorMessages.chat.TOO_MANY_MESSAGES, "RATE_LIMITED", { retryAfter: 60 });
  }
}

interface PersistRow {
  role: "user" | "assistant";
  content: Anthropic.MessageParam["content"];
  usage?: Anthropic.Usage;
}

function usageFields(usage?: Anthropic.Usage) {
  return {
    cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: usage?.cache_read_input_tokens ?? null,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
  };
}

// STUB — this whole route was a placeholder; replaced below with the real
// chat coordinator (tool registry + assembled per-app context + scoped
// system prompt), per the TODO that used to live here.
export const POST = withErrorHandling(async (request: NextRequest) => {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new UnauthorizedError(ErrorMessages.auth.UNAUTHORIZED);
  }

  const { data: membership } = await supabaseAdmin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  const workspaceId = membership?.workspace_id as string | undefined;

  if (!workspaceId) {
    throw new ForbiddenError(ErrorMessages.auth.NO_WORKSPACE, "NO_WORKSPACE");
  }

  const json = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(json);

  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? ErrorMessages.generic.INVALID_REQUEST_BODY);
  }

  const { message, appId } = parsed.data;

  // One conversation is bound to exactly one app_id — with none selected
  // there's nothing to scope the coordinator's context/tools to, so this is
  // a plain declined reply, not an error, and never calls Claude.
  if (!appId) {
    const reply: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      kind: "text",
      content: "Select an app first — I can only help with one app at a time.",
      createdAt: new Date().toISOString(),
    };
    return NextResponse.json({ message: reply }, { status: 200 });
  }

  await checkChatRateLimit(user.id);

  const { data: app } = await supabaseAdmin
    .from("apps")
    .select("id")
    .eq("id", appId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!app) {
    throw new NotFoundError(ErrorMessages.apps.NOT_FOUND);
  }

  const toolCtx: ChatToolContext = { appId, workspaceId };

  const conversationId = await getOrCreateConversation(appId, workspaceId, user.id);

  const { data: priorRows } = await supabaseAdmin
    .from("chat_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const priorMessages: Anthropic.MessageParam[] = (priorRows ?? []).map((row) => ({
    role: row.role as "user" | "assistant",
    content: row.content as Anthropic.MessageParam["content"],
  }));

  // If the conversation's last turn was a mutating-tool proposal that's
  // still awaiting the user's confirm/decline (app/api/chat/confirm/route.ts
  // only appends the real tool_result once that happens — see the
  // "proposal mode" branch below), the persisted history ends with an
  // assistant tool_use block and nothing after it. Synthesize an in-memory
  // placeholder tool_result just for this call so the request stays
  // structurally valid (every tool_use needs an eventual tool_result before
  // the conversation can continue) — never persisted, so the real
  // resolution still lands in chat_messages exactly once, from the confirm
  // route.
  const lastPrior = priorMessages[priorMessages.length - 1];
  if (lastPrior?.role === "assistant" && Array.isArray(lastPrior.content)) {
    const danglingToolUseIds = lastPrior.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
      .map((block) => block.id);
    if (danglingToolUseIds.length > 0) {
      priorMessages.push({
        role: "user",
        content: danglingToolUseIds.map((id) => ({
          type: "tool_result" as const,
          tool_use_id: id,
          content: "Not resolved in that turn — proceed with the new message below.",
        })),
      });
    }
  }

  const identityBlock = await assembleIdentityBlock(appId, workspaceId);

  const anthropic = createAnthropicClient();

  // Cache placement: the breakpoint goes on identityBlock, the LAST block of
  // the prefix that's identical across every turn in THIS app's
  // conversation (tools -> system -> messages render order means tools +
  // SCOPED_SYSTEM_PROMPT are cached alongside it too, with no cache_control
  // of their own needed — see shared/prompt-caching.md). A single breakpoint
  // is enough for v1; only add a second, sliding breakpoint over the
  // growing message history once usage data shows conversations routinely
  // running past ~6-8 turns (see Part 4 step 5 in the task spec).
  const system = [
    { type: "text" as const, text: SCOPED_SYSTEM_PROMPT },
    { type: "text" as const, text: identityBlock, cache_control: { type: "ephemeral" as const } },
  ];

  const rowsToPersist: PersistRow[] = [{ role: "user", content: [{ type: "text", text: message }] }];

  const firstResponse = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
    anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "disabled" },
      system,
      tools: CLAUDE_TOOL_DEFINITIONS,
      messages: [...priorMessages, { role: "user", content: message }],
    })
  );
  rowsToPersist[0].usage = firstResponse.usage;

  const toolUseBlocks = firstResponse.content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  let replyMessage: ChatMessage;

  if (toolUseBlocks.length === 0 || firstResponse.stop_reason !== "tool_use") {
    // Plain text answer (this also covers an off-topic redirect — the
    // coordinator produces both as ordinary text per SCOPED_SYSTEM_PROMPT,
    // no separate handling needed) and the rare refusal stop_reason.
    const text = firstResponse.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    replyMessage = {
      id: randomUUID(),
      role: "assistant",
      kind: "text",
      content: text || "Sorry, I couldn't come up with an answer for that.",
      createdAt: new Date().toISOString(),
    };
    rowsToPersist.push({ role: "assistant", content: firstResponse.content });
  } else {
    const mutatingBlock = toolUseBlocks.find((block) => isMutatingTool(block.name));

    if (mutatingBlock) {
      // Proposal mode — never execute. Any OTHER tool_use blocks in this
      // same turn get a synthetic "not run" result so the conversation
      // stays structurally valid (every tool_use needs an eventual
      // tool_result) even though we're not making a follow-up call now.
      const input = (mutatingBlock.input ?? {}) as Record<string, unknown>;
      const handlers = MUTATING_TOOL_HANDLERS[mutatingBlock.name];
      const creditCost = await handlers.computeCreditCost(input, toolCtx);

      let affordable = true;
      if (creditCost > 0) {
        const { data: creditApp } = await supabaseAdmin
          .from("apps")
          .select("agent_credits_used_this_week, agent_credits_reset_at")
          .eq("id", appId)
          .eq("workspace_id", workspaceId)
          .single();
        const { data: workspace } = await supabaseAdmin
          .from("workspaces")
          .select("plan_tier")
          .eq("id", workspaceId)
          .single();
        const planTier = (workspace?.plan_tier ?? "free") as PlanTier;
        const { remaining } = getRemainingCredits(
          {
            agent_credits_used_this_week: creditApp?.agent_credits_used_this_week ?? 0,
            agent_credits_reset_at: creditApp?.agent_credits_reset_at ?? null,
          },
          planTier
        );
        affordable = remaining >= creditCost;
      }

      const otherBlocks = toolUseBlocks.filter((block) => block.id !== mutatingBlock.id);
      const syntheticResults: Anthropic.ToolResultBlockParam[] = otherBlocks.map((block) => ({
        type: "tool_result",
        tool_use_id: block.id,
        content: "Not run — only one pending action can be proposed at a time.",
      }));

      rowsToPersist.push({ role: "assistant", content: firstResponse.content });

      if (!affordable) {
        syntheticResults.push({
          type: "tool_result",
          tool_use_id: mutatingBlock.id,
          content: "Not run — not enough agent credits remaining this week.",
          is_error: true,
        });
        if (syntheticResults.length > 0) {
          rowsToPersist.push({ role: "user", content: syntheticResults });
        }

        replyMessage = {
          id: randomUUID(),
          role: "assistant",
          kind: "text",
          content: "You don't have enough agent credits remaining this week to do that.",
          createdAt: new Date().toISOString(),
        };
        // Unlike the confirm_action case below (whose card text lives inside
        // the tool_use row itself, reconstructable via pending_chat_actions),
        // this decision text is composed here in code and never appears in
        // any Anthropic response — persist it as its own row or it silently
        // vanishes from history on the next reload.
        rowsToPersist.push({ role: "assistant", content: [{ type: "text", text: replyMessage.content }] });
      } else {
        if (syntheticResults.length > 0) {
          rowsToPersist.push({ role: "user", content: syntheticResults });
        }

        const { data: pending, error: pendingError } = await supabaseAdmin
          .from("pending_chat_actions")
          .insert({
            conversation_id: conversationId,
            app_id: appId,
            workspace_id: workspaceId,
            tool_use_id: mutatingBlock.id,
            tool_name: mutatingBlock.name,
            tool_params: input,
            credit_cost: creditCost,
            status: "pending",
          })
          .select("id")
          .single();

        if (pendingError || !pending) {
          throw new ForbiddenError(ErrorMessages.generic.UNKNOWN, "PENDING_ACTION_CREATE_FAILED");
        }

        const copy = describeToolProposal(mutatingBlock.name, input);
        const introText = firstResponse.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim();

        replyMessage = {
          id: randomUUID(),
          role: "assistant",
          kind: "confirm_action",
          content: introText || `Here's what I'd like to do: ${copy.label}.`,
          confirmAction: {
            actionId: pending.id,
            label: copy.label,
            severity: copy.severity,
            description: copy.description,
            effect: copy.effect,
            status: "open",
          },
          createdAt: new Date().toISOString(),
        };
      }
    } else {
      // Every block is read-only — execute all of them, then make exactly
      // one follow-up call (same cached prefix) to get the final answer.
      const results = await Promise.all(
        toolUseBlocks.map(async (block) => {
          const handler = READ_ONLY_HANDLERS[block.name];
          if (!handler) {
            return {
              type: "tool_result" as const,
              tool_use_id: block.id,
              content: `Unknown tool: ${block.name}`,
              is_error: true,
            };
          }
          try {
            const data = await handler((block.input ?? {}) as Record<string, unknown>, toolCtx);
            return {
              type: "tool_result" as const,
              tool_use_id: block.id,
              content: JSON.stringify(data),
            };
          } catch {
            return {
              type: "tool_result" as const,
              tool_use_id: block.id,
              content: "This tool failed to run.",
              is_error: true,
            };
          }
        })
      );

      rowsToPersist.push({ role: "assistant", content: firstResponse.content });
      rowsToPersist.push({ role: "user", content: results });

      const followUp = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
        anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: MAX_TOKENS,
          thinking: { type: "disabled" },
          system,
          tools: CLAUDE_TOOL_DEFINITIONS,
          messages: [...priorMessages, { role: "user", content: message }, { role: "assistant", content: firstResponse.content }, { role: "user", content: results }],
        })
      );

      const text = followUp.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      replyMessage = {
        id: randomUUID(),
        role: "assistant",
        kind: "text",
        content: text || "Sorry, I couldn't come up with an answer for that.",
        createdAt: new Date().toISOString(),
      };
      rowsToPersist.push({ role: "assistant", content: followUp.content, usage: followUp.usage });
    }
  }

  // Explicit, strictly-increasing created_at per row: a single batch insert
  // runs inside one transaction, and Postgres's now() returns that
  // transaction's start time for every row in it — a plain `default now()`
  // would give every row in this batch the SAME timestamp, and a later
  // `order by created_at` used to reconstruct the conversation (see
  // priorMessages above) would have no reliable way to preserve turn order.
  const baseTime = Date.now();
  await supabaseAdmin.from("chat_messages").insert(
    rowsToPersist.map((row, index) => ({
      conversation_id: conversationId,
      workspace_id: workspaceId,
      role: row.role,
      content: row.content,
      created_at: new Date(baseTime + index).toISOString(),
      ...usageFields(row.usage),
    }))
  );

  await supabaseAdmin
    .from("chat_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  return NextResponse.json({ message: replyMessage }, { status: 200 });
});

// Hydrates the panel's message list for a given app_id — called on initial
// mount/refresh and on every app switch (see ChatPanel's useEffect keyed on
// selectedAppId), since the panel itself holds no server-rendered state of
// its own (it's mounted once at the dashboard-shell level, not per app page).
export const GET = withErrorHandling(async (request: NextRequest) => {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Route Handlers reading via GET don't need to refresh cookies.
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new UnauthorizedError(ErrorMessages.auth.UNAUTHORIZED);
  }

  const { data: membership } = await supabaseAdmin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  const workspaceId = membership?.workspace_id as string | undefined;

  if (!workspaceId) {
    throw new ForbiddenError(ErrorMessages.auth.NO_WORKSPACE, "NO_WORKSPACE");
  }

  const parsedQuery = getQuerySchema.safeParse({ appId: request.nextUrl.searchParams.get("appId") });

  if (!parsedQuery.success) {
    throw new ValidationError(ErrorMessages.generic.INVALID_REQUEST_BODY);
  }

  const { appId } = parsedQuery.data;

  const { data: app } = await supabaseAdmin
    .from("apps")
    .select("id")
    .eq("id", appId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!app) {
    throw new NotFoundError(ErrorMessages.apps.NOT_FOUND);
  }

  const conversationId = await getOrCreateConversation(appId, workspaceId, user.id);

  const [{ data: rows }, { data: pendingRows }] = await Promise.all([
    supabaseAdmin
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("pending_chat_actions")
      .select("id, tool_use_id, tool_name, tool_params, status")
      .eq("conversation_id", conversationId),
  ]);

  const pendingByToolUseId = new Map<string, PendingActionRow>(
    (pendingRows ?? []).map((row) => [row.tool_use_id, row as PendingActionRow])
  );

  const messages = reconstructChatMessages(
    (rows ?? []) as PersistedMessageRow[],
    pendingByToolUseId
  );

  return NextResponse.json({ conversationId, messages }, { status: 200 });
});
