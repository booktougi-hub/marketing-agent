import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { strategyGeneration } from "@/trigger/strategy-generation";

// Distinct from /api/apps/[id]/regenerate, which only handles regenerating a
// *draft* strategy before its first approval. This route regenerates the
// currently *active* strategy for an already-launched app: it supersedes the
// active row and re-triggers strategy-generation, which flips the app back
// to 'awaiting_approval' when the new draft is ready — reusing the same
// review/approve gate as the original onboarding flow rather than replacing
// a live strategy unreviewed.
export async function POST(
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
      .select("id, status")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!app) {
      return NextResponse.json(
        { error: "App not found.", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    if (app.status !== "active") {
      return NextResponse.json(
        {
          error: "Only active apps can regenerate their strategy.",
          code: "INVALID_STATE",
        },
        { status: 422 }
      );
    }

    const { data: activeStrategy } = await supabaseAdmin
      .from("strategies")
      .select("id")
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activeStrategy) {
      return NextResponse.json(
        { error: "No active strategy found to regenerate.", code: "NO_STRATEGY" },
        { status: 422 }
      );
    }

    await supabaseAdmin
      .from("strategies")
      .update({ status: "superseded" })
      .eq("id", activeStrategy.id)
      .eq("workspace_id", workspaceId);

    await supabaseAdmin
      .from("apps")
      .update({ status: "strategy_pending" })
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    try {
      await tasks.trigger<typeof strategyGeneration>("strategy-generation", {
        app_id: id,
        workspace_id: workspaceId,
      });
    } catch (err) {
      console.error("Failed to trigger strategy-generation:", err);
      await supabaseAdmin
        .from("apps")
        .update({
          status: "error",
          error_message: "Failed to start strategy regeneration.",
        })
        .eq("id", id)
        .eq("workspace_id", workspaceId);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("POST /api/apps/[id]/strategy/regenerate error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
