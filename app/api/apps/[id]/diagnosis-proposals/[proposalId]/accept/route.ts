import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { tasks } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { appRunTag } from "@/lib/jobHealthRegistry";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors/AppError";
import type { strategyGeneration } from "@/trigger/strategy-generation";
import type { DiagnosisData } from "@/types";

const patchSchema = z.object({
  correction: z.string().nullable().optional(),
});

// "Review updated diagnosis" on the diagnosis refresh notice
// (components/apps/diagnosis-refresh-notice.tsx) — same effect as
// PATCH /api/apps/[id]/acknowledge-diagnosis (adopt the diagnosis, rebuild
// the strategy), just sourced from a diagnosis_proposals row instead of a
// fresh diagnosis run, and without forcing the app through
// 'diagnosis_ready' first since it's already past onboarding.
export const PATCH = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string; proposalId: string }> }
) => {
  const { id, proposalId } = await params;

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
  const parsed = patchSchema.safeParse(json);

  if (!parsed.success) {
    throw new ValidationError(ErrorMessages.generic.INVALID_REQUEST_BODY);
  }

  const { data: app } = await supabaseAdmin
    .from("apps")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!app) {
    throw new NotFoundError(ErrorMessages.apps.NOT_FOUND);
  }

  const { data: proposal } = await supabaseAdmin
    .from("diagnosis_proposals")
    .select("id, status, proposed_diagnosis")
    .eq("id", proposalId)
    .eq("app_id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!proposal) {
    throw new NotFoundError(ErrorMessages.diagnosisRefresh.PROPOSAL_NOT_FOUND);
  }

  if (proposal.status !== "pending") {
    throw new ValidationError(ErrorMessages.diagnosisRefresh.PROPOSAL_NOT_PENDING, "INVALID_STATE");
  }

  const proposedDiagnosis = proposal.proposed_diagnosis as DiagnosisData;

  await supabaseAdmin
    .from("diagnosis_proposals")
    .update({ status: "accepted" })
    .eq("id", proposalId)
    .eq("workspace_id", workspaceId);

  await supabaseAdmin
    .from("apps")
    .update({
      diagnosis: proposedDiagnosis,
      diagnosis_refresh_status: "reviewed",
      status: "strategy_pending",
    })
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  try {
    const handle = await tasks.trigger<typeof strategyGeneration>(
      "strategy-generation",
      { app_id: id, workspace_id: workspaceId, diagnosis_correction: parsed.data.correction ?? null },
      { tags: [appRunTag(id)] }
    );
    await supabaseAdmin
      .from("apps")
      .update({ pending_run_id: handle.id, pending_run_task: "strategy-generation" })
      .eq("id", id)
      .eq("workspace_id", workspaceId);
  } catch (err) {
    console.error("Failed to trigger strategy-generation from diagnosis proposal:", err);
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
