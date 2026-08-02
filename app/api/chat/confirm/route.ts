import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getRemainingCredits } from "@/lib/agentCredits";
import { isKnownTool, isMutatingTool, MUTATING_TOOL_HANDLERS } from "@/lib/chat/tools";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/lib/errors/AppError";
import type { PlanTier } from "@/types";

const postSchema = z.object({
  actionId: z.string().uuid(),
  decision: z.enum(["confirm", "decline"]),
});

// Executes (or discards) a mutating tool call the chat coordinator proposed
// in app/api/chat/route.ts. Never trusts the pending_chat_actions row alone
// — re-checks the tool name against the same server-side registry and the
// credit balance against its CURRENT value, since both can have changed
// since the proposal was made.
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

  const { actionId, decision } = parsed.data;

  const { data: pending } = await supabaseAdmin
    .from("pending_chat_actions")
    .select("id, conversation_id, app_id, tool_use_id, tool_name, tool_params, credit_cost, status, expires_at")
    .eq("id", actionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!pending) {
    throw new NotFoundError(ErrorMessages.chat.ACTION_NOT_FOUND);
  }

  if (pending.status !== "pending") {
    throw new ValidationError(ErrorMessages.chat.ACTION_NOT_PENDING, "ACTION_NOT_PENDING");
  }

  if (new Date(pending.expires_at).getTime() < Date.now()) {
    await supabaseAdmin.from("pending_chat_actions").update({ status: "expired" }).eq("id", pending.id);
    throw new ValidationError(ErrorMessages.chat.ACTION_EXPIRED, "ACTION_EXPIRED");
  }

  // Never execute a tool name without checking it against the registry
  // again here, even though it already came from a controlled LLM call.
  if (!isKnownTool(pending.tool_name) || !isMutatingTool(pending.tool_name)) {
    await supabaseAdmin.from("pending_chat_actions").update({ status: "cancelled" }).eq("id", pending.id);
    throw new ForbiddenError(ErrorMessages.chat.UNKNOWN_TOOL, "UNKNOWN_TOOL");
  }

  if (decision === "decline") {
    await supabaseAdmin.from("pending_chat_actions").update({ status: "cancelled" }).eq("id", pending.id);
    // No-op for ordinary mutating tools (no matching row) — only tools in
    // PROACTIVE_OFFER_TOOLS ever get a chat_action_suggestions row created
    // for them in the first place. See lib/chat/tools.ts.
    await supabaseAdmin
      .from("chat_action_suggestions")
      .update({ status: "dismissed" })
      .eq("pending_action_id", pending.id);
    await appendToolResult(pending.conversation_id, workspaceId, pending.tool_use_id, "Declined by the user.");
    return NextResponse.json({ success: true }, { status: 200 });
  }

  // Re-check against the CURRENT balance — it may have changed since the
  // proposal was created.
  if (pending.credit_cost > 0) {
    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("agent_credits_used_this_week, agent_credits_reset_at")
      .eq("id", pending.app_id)
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
        agent_credits_used_this_week: app?.agent_credits_used_this_week ?? 0,
        agent_credits_reset_at: app?.agent_credits_reset_at ?? null,
      },
      planTier
    );
    if (remaining < pending.credit_cost) {
      throw new ForbiddenError(ErrorMessages.research.NO_CREDITS_REMAINING);
    }
  }

  await supabaseAdmin.from("pending_chat_actions").update({ status: "confirmed" }).eq("id", pending.id);

  const handler = MUTATING_TOOL_HANDLERS[pending.tool_name];
  const { trackingId } = await handler.execute(pending.tool_params as Record<string, unknown>, {
    appId: pending.app_id,
    workspaceId,
  });

  await supabaseAdmin.from("pending_chat_actions").update({ status: "executed" }).eq("id", pending.id);
  await supabaseAdmin
    .from("chat_action_suggestions")
    .update({ status: "confirmed" })
    .eq("pending_action_id", pending.id);
  await appendToolResult(
    pending.conversation_id,
    workspaceId,
    pending.tool_use_id,
    trackingId ? `Confirmed and started. Tracking id: ${trackingId}.` : "Confirmed and applied."
  );

  return NextResponse.json({ success: true, trackingId }, { status: 200 });
});

async function appendToolResult(conversationId: string, workspaceId: string, toolUseId: string, text: string) {
  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    workspace_id: workspaceId,
    role: "user",
    content: [{ type: "tool_result", tool_use_id: toolUseId, content: text }],
  });
  await supabaseAdmin
    .from("chat_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);
}
