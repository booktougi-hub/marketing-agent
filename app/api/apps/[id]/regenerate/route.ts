import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors/AppError";
import type { strategyGeneration } from "@/trigger/strategy-generation";

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

    if (app.status !== "awaiting_approval") {
      throw new ValidationError(ErrorMessages.apps.NOT_AWAITING_APPROVAL, "INVALID_STATE");
    }

    await supabaseAdmin
      .from("strategies")
      .update({ status: "superseded" })
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .eq("status", "draft");

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
