import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors/AppError";
import type { strategyGeneration } from "@/trigger/strategy-generation";

// Distinct from /api/apps/[id]/regenerate, which only handles regenerating a
// *draft* strategy before its first approval. This route regenerates the
// currently *active* strategy for an already-launched app: it supersedes the
// active row and re-triggers strategy-generation, which flips the app back
// to 'awaiting_approval' when the new draft is ready — reusing the same
// review/approve gate as the original onboarding flow rather than replacing
// a live strategy unreviewed.
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

    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("id, status")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!app) {
      throw new NotFoundError(ErrorMessages.apps.NOT_FOUND);
    }

    if (app.status !== "active") {
      throw new ValidationError(ErrorMessages.apps.NOT_ACTIVE, "INVALID_STATE");
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
      throw new ValidationError(ErrorMessages.strategy.NO_ACTIVE_STRATEGY_TO_REGENERATE, "NO_STRATEGY");
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
      const handle = await tasks.trigger<typeof strategyGeneration>("strategy-generation", {
        app_id: id,
        workspace_id: workspaceId,
      });
      await supabaseAdmin
        .from("apps")
        .update({ pending_run_id: handle.id, pending_run_task: "strategy-generation" })
        .eq("id", id)
        .eq("workspace_id", workspaceId);
    } catch (err) {
      console.error("Failed to trigger strategy-generation:", err);
      await supabaseAdmin
        .from("apps")
        .update({
          status: "error",
          error_message: ErrorMessages.apps.TRIGGER_STRATEGY_GENERATION_FAILED,
          pending_run_id: null,
          pending_run_task: null,
        })
        .eq("id", id)
        .eq("workspace_id", workspaceId);
    }

    return NextResponse.json({ success: true }, { status: 200 });
});
