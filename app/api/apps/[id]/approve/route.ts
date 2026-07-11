import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { contentGeneration } from "@/trigger/content-generation";
import type { topicResearch } from "@/trigger/topic-research";
import type { problemDiscovery } from "@/trigger/problem-discovery";
import type { competitorGapAnalysis } from "@/trigger/competitor-gap-analysis";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
        { status: 403 }
      );
    }

    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("id, status, first_research_completed")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!app) {
      return NextResponse.json(
        { error: "App not found.", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    if (app.status !== "awaiting_approval") {
      return NextResponse.json(
        { error: "This app is not awaiting approval.", code: "INVALID_STATE" },
        { status: 422 }
      );
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
      return NextResponse.json(
        { error: "No draft strategy found to approve.", code: "NO_STRATEGY" },
        { status: 422 }
      );
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
      await tasks.trigger<typeof contentGeneration>("content-generation", {
        app_id: id,
        workspace_id: workspaceId,
      });
    } catch (err) {
      console.error("Failed to trigger content-generation:", err);
      await supabaseAdmin
        .from("apps")
        .update({
          status: "error",
          error_message: "Failed to start content generation.",
        })
        .eq("id", id)
        .eq("workspace_id", workspaceId);
    }

    // Kick off the very first research run automatically so a new app has
    // findings within minutes instead of waiting for the next scheduled
    // Sunday scan. Gated by first_research_completed so this never fires
    // again — not on a later approval after re-analysis, not ever.
    if (!app.first_research_completed) {
      try {
        const researchPayload = {
          app_id: id,
          workspace_id: workspaceId,
          triggered_manually: false,
        };
        await Promise.all([
          tasks.trigger<typeof topicResearch>("topic-research", researchPayload),
          tasks.trigger<typeof problemDiscovery>("problem-discovery", researchPayload),
          tasks.trigger<typeof competitorGapAnalysis>("competitor-gap-analysis", {
            app_id: id,
            workspace_id: workspaceId,
          }),
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

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("PATCH /api/apps/[id]/approve error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
