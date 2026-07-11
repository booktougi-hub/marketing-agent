import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { topicResearch } from "@/trigger/topic-research";
import type { problemDiscovery } from "@/trigger/problem-discovery";
import type { competitorGapAnalysis } from "@/trigger/competitor-gap-analysis";
import {
  MANUAL_RESEARCH_ALLOWANCE,
  MANUAL_RESEARCH_COOLDOWN_MS,
  UNLIMITED_MANUAL_RESEARCH_PLANS,
  isWeeklyResetDue,
} from "@/lib/manual-research";
import type { PlanTier } from "@/types";

// Manually re-runs the topic-research, problem-discovery, and
// competitor-gap-analysis streams for an app, rate-limited per plan.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Validate session, resolve workspace_id.
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
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHENTICATED" },
        { status: 401 }
      );
    }

    const { data: membership } = await supabaseAdmin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .single();

    const workspaceId = membership?.workspace_id as string | undefined;

    if (!workspaceId) {
      return NextResponse.json(
        { error: "No workspace found for this account.", code: "NO_WORKSPACE" },
        { status: 401 }
      );
    }

    // 2. Verify the app belongs to this workspace.
    const { data: app } = await supabaseAdmin
      .from("apps")
      .select(
        "id, manual_research_count_this_week, manual_research_reset_at, last_manual_research_at"
      )
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!app) {
      return NextResponse.json(
        { error: "App not found in this workspace.", code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    // 3. Get the workspace plan tier.
    const { data: workspace } = await supabaseAdmin
      .from("workspaces")
      .select("plan_tier")
      .eq("id", workspaceId)
      .single();

    const planTier = (workspace?.plan_tier ?? "free") as PlanTier;

    // 4. Determine manual trigger allowance by plan.
    const allowance = MANUAL_RESEARCH_ALLOWANCE[planTier] ?? MANUAL_RESEARCH_ALLOWANCE.free;

    // 5. Reset the weekly counter if the window has elapsed.
    let count = app.manual_research_count_this_week;
    let resetAt = app.manual_research_reset_at;
    const resetDue = isWeeklyResetDue(resetAt);

    if (resetDue) {
      count = 0;
      resetAt = new Date().toISOString();
      await supabaseAdmin
        .from("apps")
        .update({
          manual_research_count_this_week: count,
          manual_research_reset_at: resetAt,
        })
        .eq("id", id)
        .eq("workspace_id", workspaceId);
    }

    // 6. Enforce the weekly allowance.
    if (count >= allowance && !UNLIMITED_MANUAL_RESEARCH_PLANS.has(planTier)) {
      return NextResponse.json(
        {
          error:
            "No manual research runs remaining this week. Upgrade for more, or wait for your next automatic weekly scan.",
        },
        { status: 403 }
      );
    }

    // 7. Enforce the cooldown between manual triggers.
    if (app.last_manual_research_at) {
      const msSinceLast = Date.now() - new Date(app.last_manual_research_at).getTime();
      if (msSinceLast < MANUAL_RESEARCH_COOLDOWN_MS) {
        const retryAfter = Math.ceil(
          (MANUAL_RESEARCH_COOLDOWN_MS - msSinceLast) / (60 * 60 * 1000)
        );
        return NextResponse.json(
          { error: "Please wait before running research again.", retryAfter },
          { status: 429 }
        );
      }
    }

    // 8. Record the trigger and kick off the research jobs.
    const newCount = count + 1;
    const nowIso = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin
      .from("apps")
      .update({
        manual_research_count_this_week: newCount,
        last_manual_research_at: nowIso,
      })
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to start research.", code: "SERVER_ERROR" },
        { status: 500 }
      );
    }

    const jobPayload = { app_id: id, workspace_id: workspaceId, triggered_manually: true };

    await Promise.all([
      tasks.trigger<typeof topicResearch>("topic-research", jobPayload),
      tasks.trigger<typeof problemDiscovery>("problem-discovery", jobPayload),
      tasks.trigger<typeof competitorGapAnalysis>("competitor-gap-analysis", {
        app_id: id,
        workspace_id: workspaceId,
      }),
    ]);

    // 9. Success.
    return NextResponse.json(
      { success: true, remaining: allowance - newCount },
      { status: 200 }
    );
  } catch (error) {
    console.error("POST /api/apps/[id]/research/trigger error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
