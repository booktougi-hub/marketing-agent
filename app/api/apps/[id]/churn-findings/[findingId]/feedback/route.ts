import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  InternalError,
} from "@/lib/errors/AppError";

const postSchema = z.object({
  note: z.string().trim().min(1, ErrorMessages.churnAudit.FEEDBACK_EMPTY).max(2000),
});

// AuditFindingCard's "Tell us more" action, mirroring
// app/api/apps/[id]/onboarding-findings/[findingId]/feedback/route.ts
// exactly. Never changes the finding's own status (stays 'open') — folds
// the note into apps.additional_context, which trigger/churn-audit.ts
// already reads on every run, so the *next* audit actually sees it.
export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string; findingId: string }> }
) => {
  const { id, findingId } = await params;

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

  const [{ data: finding }, { data: app }] = await Promise.all([
    supabaseAdmin
      .from("churn_findings")
      .select("id, issue_description")
      .eq("id", findingId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .single(),
    supabaseAdmin
      .from("apps")
      .select("additional_context")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single(),
  ]);

  if (!finding) {
    throw new NotFoundError(ErrorMessages.churnAudit.FINDING_NOT_FOUND);
  }
  if (!app) {
    throw new NotFoundError(ErrorMessages.apps.NOT_FOUND_IN_WORKSPACE);
  }

  const dateLabel = new Date().toISOString().slice(0, 10);
  const feedbackBlock = `[Churn audit feedback, ${dateLabel}, on "${finding.issue_description.slice(0, 80)}"]: ${parsed.data.note}`;
  const newAdditionalContext = app.additional_context
    ? `${app.additional_context}\n\n${feedbackBlock}`
    : feedbackBlock;

  const { error: updateError } = await supabaseAdmin
    .from("apps")
    .update({ additional_context: newAdditionalContext })
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (updateError) {
    throw new InternalError(ErrorMessages.churnAudit.FEEDBACK_FAILED);
  }

  return NextResponse.json({ success: true }, { status: 200 });
});
