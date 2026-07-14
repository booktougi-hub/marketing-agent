import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { tasks } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  AGENT_ACTION_COST,
  canAffordAction,
  getCooldownHoursRemaining,
  getRemainingCredits,
  isCreditsResetDue,
  type AgentActionType,
} from "@/lib/agentCredits";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import {
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  InternalError,
  ValidationError,
} from "@/lib/errors/AppError";
import type { topicResearch } from "@/trigger/topic-research";
import type { problemDiscovery } from "@/trigger/problem-discovery";
import type { forumOpportunityFinder } from "@/trigger/forum-opportunity-finder";
import type { competitorGapAnalysis } from "@/trigger/competitor-gap-analysis";
import type { PlanTier } from "@/types";

const postSchema = z.object({
  actionType: z.enum([
    "topic_and_problem_research",
    "forum_opportunity_scan",
    "competitor_gap_analysis",
    "cold_email_prospecting",
  ]),
});

// Unified replacement for the old single-purpose
// /api/apps/[id]/research/trigger — every manually-triggerable agent action
// now goes through here, drawing from one shared weekly credit pool
// (lib/agentCredits.ts) instead of each action having its own counter.
export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

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

  const actionType: AgentActionType = parsed.data.actionType;

  const { data: app } = await supabaseAdmin
    .from("apps")
    .select("id, agent_credits_used_this_week, agent_credits_reset_at, last_agent_action_at")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!app) {
    throw new ForbiddenError(ErrorMessages.apps.NOT_FOUND_IN_WORKSPACE, "FORBIDDEN");
  }

  const { data: workspace } = await supabaseAdmin
    .from("workspaces")
    .select("plan_tier")
    .eq("id", workspaceId)
    .single();

  const planTier = (workspace?.plan_tier ?? "free") as PlanTier;

  // The cold-email prospecting job doesn't exist yet (V3 scope, not built —
  // see PHASES.md) — checked before any credit/cooldown mutation so a
  // request for it never silently spends a credit on an action that can't
  // actually run.
  if (actionType === "cold_email_prospecting") {
    const affordCheck = canAffordAction(app, actionType, planTier);
    if (!affordCheck.allowed) {
      throw new ForbiddenError(affordCheck.reason ?? ErrorMessages.research.NO_CREDITS_REMAINING);
    }
    return NextResponse.json(
      { error: "Cold email prospecting isn't available yet.", code: "NOT_IMPLEMENTED" },
      { status: 501 }
    );
  }

  const affordCheck = canAffordAction(app, actionType, planTier);
  if (!affordCheck.allowed) {
    throw new ForbiddenError(affordCheck.reason ?? ErrorMessages.research.NO_CREDITS_REMAINING);
  }

  const cooldownHoursRemaining = getCooldownHoursRemaining(app.last_agent_action_at);
  if (cooldownHoursRemaining > 0) {
    throw new RateLimitError(ErrorMessages.research.COOLDOWN_ACTIVE, "RATE_LIMITED", {
      retryAfter: cooldownHoursRemaining,
    });
  }

  const cost = AGENT_ACTION_COST[actionType];
  const resetDue = isCreditsResetDue(app.agent_credits_reset_at);
  const currentUsed = resetDue ? 0 : app.agent_credits_used_this_week;
  const newUsed = currentUsed + cost;
  const newResetAt = resetDue ? new Date().toISOString() : app.agent_credits_reset_at;
  const nowIso = new Date().toISOString();

  const { error: updateError } = await supabaseAdmin
    .from("apps")
    .update({
      agent_credits_used_this_week: newUsed,
      agent_credits_reset_at: newResetAt,
      last_agent_action_at: nowIso,
    })
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (updateError) {
    throw new InternalError(ErrorMessages.research.START_FAILED);
  }

  const jobPayload = { app_id: id, workspace_id: workspaceId };

  if (actionType === "topic_and_problem_research") {
    await Promise.all([
      tasks.trigger<typeof topicResearch>("topic-research", {
        ...jobPayload,
        triggered_manually: true,
      }),
      tasks.trigger<typeof problemDiscovery>("problem-discovery", {
        ...jobPayload,
        triggered_manually: true,
      }),
    ]);
  } else if (actionType === "forum_opportunity_scan") {
    await tasks.trigger<typeof forumOpportunityFinder>("forum-opportunity-finder", jobPayload);
  } else if (actionType === "competitor_gap_analysis") {
    await tasks.trigger<typeof competitorGapAnalysis>("competitor-gap-analysis", jobPayload);
  }

  const { remaining } = getRemainingCredits(
    { agent_credits_used_this_week: newUsed, agent_credits_reset_at: newResetAt },
    planTier
  );

  return NextResponse.json({ success: true, remaining }, { status: 200 });
});
