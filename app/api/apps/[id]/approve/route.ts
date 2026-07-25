import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors/AppError";
import { appRunTag } from "@/lib/jobHealthRegistry";
import type { contentGeneration } from "@/trigger/content-generation";
import type { topicResearch } from "@/trigger/topic-research";
import type { problemDiscovery } from "@/trigger/problem-discovery";
import type { forumOpportunityFinder } from "@/trigger/forum-opportunity-finder";
import type { icpInference } from "@/trigger/icp-inference";

export const PATCH = withErrorHandling(async (
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

    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("id, status, first_research_completed")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!app) {
      throw new NotFoundError(ErrorMessages.apps.NOT_FOUND);
    }

    if (app.status !== "awaiting_approval") {
      throw new ValidationError(ErrorMessages.apps.NOT_AWAITING_APPROVAL, "INVALID_STATE");
    }

    const { data: strategy, error: strategyError } = await supabaseAdmin
      .from("strategies")
      .select("id")
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (strategyError || !strategy) {
      throw new ValidationError(ErrorMessages.strategy.NO_DRAFT_TO_APPROVE, "NO_STRATEGY");
    }

    await supabaseAdmin
      .from("strategies")
      .update({ status: "active" })
      .eq("id", strategy.id)
      .eq("workspace_id", workspaceId);

    await supabaseAdmin
      .from("apps")
      .update({ status: "active" })
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    try {
      const handle = await tasks.trigger<typeof contentGeneration>(
        "content-generation",
        { app_id: id, workspace_id: workspaceId },
        { tags: [appRunTag(id)] }
      );
      await supabaseAdmin
        .from("apps")
        .update({ pending_run_id: handle.id, pending_run_task: "content-generation" })
        .eq("id", id)
        .eq("workspace_id", workspaceId);
    } catch (err) {
      console.error("Failed to trigger content-generation:", err);
      await supabaseAdmin
        .from("apps")
        .update({
          status: "error",
          error_message: ErrorMessages.apps.TRIGGER_CONTENT_GENERATION_FAILED,
          pending_run_id: null,
          pending_run_task: null,
        })
        .eq("id", id)
        .eq("workspace_id", workspaceId);
    }

    // Kick off the very first research run automatically so a new app has
    // findings within minutes instead of waiting for the next scheduled
    // weekly scan. Gated by first_research_completed so this never fires
    // again — not on a later approval after re-analysis, not ever. Topics,
    // Problems, and Opportunities all fire together here since all three
    // are weekly-cadence streams; Competitor Gap Analysis stays out of this
    // burst since it's monthly-cadence, not part of immediate onboarding.
    if (!app.first_research_completed) {
      try {
        const researchPayload = {
          app_id: id,
          workspace_id: workspaceId,
          triggered_manually: false,
        };
        const tagOptions = { tags: [appRunTag(id)] };
        await Promise.all([
          tasks.trigger<typeof topicResearch>("topic-research", researchPayload, tagOptions),
          tasks.trigger<typeof problemDiscovery>("problem-discovery", researchPayload, tagOptions),
          tasks.trigger<typeof forumOpportunityFinder>(
            "forum-opportunity-finder",
            { app_id: id, workspace_id: workspaceId },
            tagOptions
          ),
        ]);
      } catch (err) {
        console.error("Failed to trigger initial research run:", err);
      }

      await supabaseAdmin
        .from("apps")
        .update({
          first_research_completed: true,
          first_research_completed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("workspace_id", workspaceId);
    }

    // Outreach onboarding (PHASES.md Notes Log, 2026-07-14): icp-inference
    // fires alongside the research burst above so the founder has an ICP
    // summary + prospect previews waiting by the time they check the
    // Outreach tab. Not gated by first_research_completed — icp-inference
    // has its own idempotency via icp_status/first_outreach_completed, and
    // outreach-preview itself replaces any prior preview batch, so this is
    // safe to fire on every approval (including after a later re-analysis)
    // rather than only the very first one.
    try {
      await tasks.trigger<typeof icpInference>("icp-inference", {
        app_id: id,
        workspace_id: workspaceId,
      });
    } catch (err) {
      console.error("Failed to trigger icp-inference:", err);
    }

    return NextResponse.json({ success: true }, { status: 200 });
});
