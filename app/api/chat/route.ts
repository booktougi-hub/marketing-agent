import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { supabaseAdmin } from "@/lib/supabase-server";
import { assembleIdentityBlock } from "@/lib/chat/assemble-context";
import { DECLINE_MARKER, SCOPED_SYSTEM_PROMPT } from "@/lib/chat/system-prompt";
import {
  CLAUDE_TOOL_DEFINITIONS,
  MUTATING_TOOL_HANDLERS,
  READ_ONLY_HANDLERS,
  describeToolProposal,
  isMutatingTool,
  isProactiveOfferTool,
  type ChatToolContext,
} from "@/lib/chat/tools";
import { getRemainingCredits } from "@/lib/agentCredits";
import {
  reconstructChatMessages,
  type PendingActionRow,
  type PersistedMessageRow,
} from "@/lib/chat/reconstruct-messages";
import { planToolUseRepairs } from "@/lib/chat/repair-history";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { callExternalService, ForbiddenError, NotFoundError, RateLimitError, UnauthorizedError, ValidationError } from "@/lib/errors/AppError";
import { MODELS } from "@/lib/ai/models";
import type { ChatMessage, PlanTier } from "@/types";

const CLAUDE_MODEL: string = MODELS.STANDARD;
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
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  // Self-healing repair pass (lib/chat/repair-history.ts) — scans the
  // ENTIRE history for any assistant tool_use block not immediately
  // followed by a matching tool_result, and plans a fix for each gap found.
  // See that file's header comment for the two confirmed real causes this
  // guards against. Persisting the fix (not just patching this one call in
  // memory) is what makes a conversation self-heal on its next message
  // instead of staying permanently broken.
  const repairPlan = planToolUseRepairs(
    (priorRows ?? []).map((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content as Anthropic.MessageParam["content"],
      created_at: row.created_at,
    }))
  );

  if (repairPlan.inserts.length > 0) {
    await supabaseAdmin.from("chat_messages").insert(
      repairPlan.inserts.map((insert) => ({
        conversation_id: conversationId,
        workspace_id: workspaceId,
        role: "user" as const,
        content: insert.content,
        created_at: insert.created_at,
      }))
    );
  }

  if (repairPlan.supersededToolUseIds.length > 0) {
    // Anything still "pending" here was abandoned by the founder moving on
    // to a different message rather than confirming/declining it — mark it
    // cancelled so app/api/chat/confirm/route.ts safely rejects a stale
    // confirm-tap on an old card (ACTION_NOT_PENDING) instead of trying to
    // append a second, out-of-place tool_result for an id already resolved
    // above.
    await supabaseAdmin
      .from("pending_chat_actions")
      .update({ status: "cancelled" })
      .in("tool_use_id", repairPlan.supersededToolUseIds)
      .eq("status", "pending");
  }

  const priorMessages: Anthropic.MessageParam[] = repairPlan.repairedMessages;

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

  // Growing message list sent on every call in this turn's loop below — the
  // same array instance is mutated (pushed to) as read-only rounds run, so
  // each subsequent call replays the full in-progress turn.
  const conversationForApi: Anthropic.MessageParam[] = [...priorMessages, { role: "user", content: message }];

  let currentResponse = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
    anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "disabled" },
      system,
      tools: CLAUDE_TOOL_DEFINITIONS,
      messages: conversationForApi,
    })
  );
  rowsToPersist[0].usage = currentResponse.usage;

  // A read-only turn isn't always resolved in a single follow-up call — the
  // model can legitimately chain more than one read-only tool (e.g. check
  // SEO status, then check credit balance for context) inside what still
  // reads as "one turn" to the user. Capped rather than unbounded so a
  // single turn can't run away on latency/cost; the final round below
  // always omits `tools` so it's structurally impossible for that last call
  // to return yet another unresolved tool_use — every prior version of this
  // loop assumed exactly one follow-up and persisted whatever it got back
  // verbatim, which let a second tool_use slip into chat_messages with no
  // tool_result after it. Anthropic requires a tool_result immediately
  // after every tool_use, so once that happens the ENTIRE conversation
  // 400s on every future turn (the full history is replayed each time) —
  // this is what "every query fails" for an existing conversation traces
  // back to.
  const MAX_READ_ONLY_ROUNDS = 4;
  let readOnlyRound = 0;

  let replyMessage: ChatMessage;

  while (true) {
    const toolUseBlocks = currentResponse.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (toolUseBlocks.length === 0 || currentResponse.stop_reason !== "tool_use") {
      // Plain text answer — this also covers an off-topic redirect, which the
      // coordinator produces as ordinary text per SCOPED_SYSTEM_PROMPT, marked
      // with a leading DECLINE_MARKER token so this code can tell the two
      // apart without a second classification call (see that constant's
      // comment in lib/chat/system-prompt.ts). The rare refusal stop_reason
      // also lands here.
      const text = currentResponse.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      const isDecline = text.startsWith(DECLINE_MARKER);
      const displayText = isDecline ? text.slice(DECLINE_MARKER.length).trim() : text;

      // The marker must never reach a persisted row — chat_messages.content is
      // replayed verbatim on reload (see reconstructChatMessages) and fed back
      // to Claude as conversation history on the next turn, so it's stripped
      // here too, not just from the live replyMessage below.
      const persistedContent = isDecline
        ? currentResponse.content.map((block) =>
            block.type === "text" && block.text.trim().startsWith(DECLINE_MARKER)
              ? { ...block, text: block.text.trim().slice(DECLINE_MARKER.length).trim() }
              : block
          )
        : currentResponse.content;

      if (isDecline) {
        await supabaseAdmin.from("chat_declines").insert({
          conversation_id: conversationId,
          app_id: appId,
          workspace_id: workspaceId,
          user_message: message,
        });
      }

      replyMessage = {
        id: randomUUID(),
        role: "assistant",
        kind: "text",
        content: displayText || "Sorry, I couldn't come up with an answer for that.",
        createdAt: new Date().toISOString(),
      };
      // The very first call's usage already landed on rowsToPersist[0] (the
      // user row) above — only attach it here too when at least one
      // read-only round happened first, i.e. this text answer came from a
      // follow-up call, not the first one.
      rowsToPersist.push({
        role: "assistant",
        content: persistedContent,
        ...(readOnlyRound > 0 ? { usage: currentResponse.usage } : {}),
      });
      break;
    }

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

      rowsToPersist.push({ role: "assistant", content: currentResponse.content });

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

        // Logged only for the small allowlist of "proactive offer" tools
        // (today just add_content_to_plan) — see chat_action_suggestions in
        // SCHEMA.md. Every other mutating tool is founder-requested, not
        // unprompted, so it doesn't belong in this log.
        if (isProactiveOfferTool(mutatingBlock.name)) {
          await supabaseAdmin.from("chat_action_suggestions").insert({
            conversation_id: conversationId,
            app_id: appId,
            workspace_id: workspaceId,
            pending_action_id: pending.id,
            tool_name: mutatingBlock.name,
            status: "offered",
          });
        }

        const copy = describeToolProposal(mutatingBlock.name, input);
        const introText = currentResponse.content
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
      break;
    }

    // Every block is read-only — execute all of them, persist this round,
    // then loop back with the result appended so the next call can either
    // answer in text or chain another read-only tool.
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

    rowsToPersist.push({ role: "assistant", content: currentResponse.content });
    rowsToPersist.push({ role: "user", content: results });
    conversationForApi.push({ role: "assistant", content: currentResponse.content }, { role: "user", content: results });

    readOnlyRound += 1;
    const offerTools = readOnlyRound < MAX_READ_ONLY_ROUNDS;

    currentResponse = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
      anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "disabled" },
        system,
        ...(offerTools ? { tools: CLAUDE_TOOL_DEFINITIONS } : {}),
        messages: conversationForApi,
      })
    );
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
