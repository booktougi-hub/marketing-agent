import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { tasks } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getRemainingCredits, isCreditResetDue, nextResetDate } from "@/lib/reanalysis";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  InternalError,
} from "@/lib/errors/AppError";
import type { PlanTier } from "@/types";
import type { dnaExtraction } from "@/trigger/dna-extraction";

const postSchema = z.object({
  new_url: z.string().trim().url("Enter a valid URL, like https://yourapp.com.").optional(),
});

// Also backs the Settings > App Identity "Change URL (one time only)" flow —
// when `new_url` is present this both changes the URL and performs the same
// re-analysis, rather than duplicating the credit/trigger logic in a second
// route.
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

    const json = await request.json().catch(() => ({}));
    const parsed = postSchema.safeParse(json);

    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? ErrorMessages.generic.INVALID_REQUEST_BODY);
    }

    const { data: workspace } = await supabaseAdmin
      .from("workspaces")
      .select("plan_tier")
      .eq("id", workspaceId)
      .single();

    const planTier = (workspace?.plan_tier ?? "free") as PlanTier;

    const { data: app } = await supabaseAdmin
      .from("apps")
      .select(
        "id, source_url, additional_context, doc_paths, url_changed_at, reanalysis_credits_used, reanalysis_credits_reset_at"
      )
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!app) {
      throw new NotFoundError(ErrorMessages.apps.NOT_FOUND);
    }

    const remainingCredits = getRemainingCredits(
      planTier,
      app.reanalysis_credits_used,
      app.reanalysis_credits_reset_at
    );

    if (remainingCredits !== null && remainingCredits <= 0) {
      throw new ForbiddenError(ErrorMessages.apps.NO_CREDITS_REMAINING, "NO_CREDITS");
    }

    const newUrl = parsed.data.new_url;
    if (newUrl && app.url_changed_at) {
      throw new ValidationError(ErrorMessages.apps.URL_LOCKED, "URL_ALREADY_CHANGED");
    }

    const resetDue = isCreditResetDue(app.reanalysis_credits_reset_at);
    const newCreditsUsed = resetDue ? 1 : app.reanalysis_credits_used + 1;
    const newResetAt = resetDue ? nextResetDate() : app.reanalysis_credits_reset_at;

    const sourceUrl = newUrl ?? app.source_url;

    const appUpdate: Record<string, unknown> = {
      status: "extracting",
      is_paused: true,
      reanalysis_credits_used: newCreditsUsed,
      reanalysis_credits_reset_at: newResetAt,
    };
    if (newUrl) {
      appUpdate.source_url = newUrl;
      appUpdate.url_changed_at = new Date().toISOString();
    }

    const { error: updateError } = await supabaseAdmin
      .from("apps")
      .update(appUpdate)
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (updateError) {
      throw new InternalError(ErrorMessages.apps.TRIGGER_REANALYSE_FAILED);
    }

    // Superseding the active strategy keeps the Strategy page from showing
    // stale "active" data while a new draft is pending approval — mirrors
    // /api/apps/[id]/strategy/regenerate.
    await supabaseAdmin
      .from("strategies")
      .update({ status: "superseded" })
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .eq("status", "active");

    try {
      const handle = await tasks.trigger<typeof dnaExtraction>("dna-extraction", {
        app_id: id,
        workspace_id: workspaceId,
        source_url: sourceUrl,
        has_additional_context: !!app.additional_context,
        has_docs: (app.doc_paths?.length ?? 0) > 0,
      });
      await supabaseAdmin
        .from("apps")
        .update({ pending_run_id: handle.id, pending_run_task: "dna-extraction" })
        .eq("id", id)
        .eq("workspace_id", workspaceId);
    } catch (err) {
      console.error("Failed to trigger dna-extraction:", err);
      await supabaseAdmin
        .from("apps")
        .update({
          status: "error",
          error_message: ErrorMessages.apps.TRIGGER_REANALYSE_FAILED,
          pending_run_id: null,
          pending_run_task: null,
        })
        .eq("id", id)
        .eq("workspace_id", workspaceId);

      throw new InternalError(ErrorMessages.apps.TRIGGER_REANALYSE_FAILED);
    }

    return NextResponse.json({ success: true }, { status: 200 });
});
