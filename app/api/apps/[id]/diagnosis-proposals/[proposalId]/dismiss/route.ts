import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors/AppError";

// "Keep current strategy" on the diagnosis refresh notice
// (components/apps/diagnosis-refresh-notice.tsx) — dismisses the proposal
// and clears the notice. Takes no other action: the current diagnosis and
// strategy are left exactly as they are.
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
    .select("id, status")
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

  await supabaseAdmin
    .from("diagnosis_proposals")
    .update({ status: "dismissed" })
    .eq("id", proposalId)
    .eq("workspace_id", workspaceId);

  await supabaseAdmin
    .from("apps")
    .update({ diagnosis_refresh_status: "none" })
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  return NextResponse.json({ success: true }, { status: 200 });
});
