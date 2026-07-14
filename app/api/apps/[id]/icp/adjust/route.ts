import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { tasks } from "@trigger.dev/sdk";
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
import type { icpInference } from "@/trigger/icp-inference";

const postSchema = z.object({
  company_stage: z.enum(["bootstrapped", "funded", "established"]).nullable(),
  exclusions: z.string().nullable(),
  geographic_focus: z.string().nullable(),
  persona_feedback: z.string().nullable(),
});

// "Adjust this" → Save on the Outreach onboarding view. Sets icp_status to
// 'needs_adjustment' immediately (the UI shows a regenerating state off
// this) and re-triggers icp-inference with the adjustment as extra context;
// icp-inference itself flips icp_status back to 'pending_review' with the
// new summary/filters once done, and chains into outreach-preview for a
// fresh set of 5 previews that replaces the old batch.
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

  const json = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(json);

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

  await supabaseAdmin
    .from("apps")
    .update({ icp_status: "needs_adjustment" })
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  try {
    await tasks.trigger<typeof icpInference>("icp-inference", {
      app_id: id,
      workspace_id: workspaceId,
      adjustment: parsed.data,
    });
  } catch (err) {
    console.error("Failed to trigger icp-inference re-run:", err);
    throw new InternalError(ErrorMessages.outreach.TRIGGER_ICP_INFERENCE_FAILED);
  }

  return NextResponse.json({ success: true }, { status: 200 });
});
