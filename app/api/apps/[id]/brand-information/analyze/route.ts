import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { tasks } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, ValidationError, InternalError } from "@/lib/errors/AppError";
import { appRunTag } from "@/lib/jobHealthRegistry";
import type { brandInfoExtraction } from "@/trigger/brand-info-extraction";

const postSchema = z.object({
  website_url: z.string().url(ErrorMessages.brandInformation.INVALID_URL),
});

// The free, first-ever brand analysis — separate from the credit-gated
// Re-analyze action (POST /api/apps/[id]/agent-action with actionType
// "brand_info_extraction"), same relationship as DNA extraction (free,
// part of onboarding) vs. App Identity's credit-gated "Re-analyse App".
// Only usable once per app: after a successful run, last_analyzed_at is
// set and this route refuses to run again — from then on it's Re-analyze
// or nothing.
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
    .select("id")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!app) {
    throw new ForbiddenError(ErrorMessages.apps.NOT_FOUND_IN_WORKSPACE, "FORBIDDEN");
  }

  const json = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(json);

  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? ErrorMessages.generic.INVALID_REQUEST_BODY);
  }

  const { website_url } = parsed.data;

  const { data: existingRow } = await supabaseAdmin
    .from("brand_information")
    .select("id, extraction_status, last_analyzed_at")
    .eq("app_id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (existingRow?.last_analyzed_at) {
    throw new ValidationError(ErrorMessages.brandInformation.ALREADY_ANALYZED, "ALREADY_ANALYZED");
  }
  if (existingRow?.extraction_status === "processing") {
    throw new ValidationError(ErrorMessages.brandInformation.ALREADY_IN_PROGRESS, "ALREADY_IN_PROGRESS");
  }

  const { error: upsertError } = await supabaseAdmin
    .from("brand_information")
    .upsert(
      {
        app_id: id,
        workspace_id: workspaceId,
        website_url,
        extraction_status: "processing",
        extraction_error: null,
      },
      { onConflict: "app_id" }
    );

  if (upsertError) {
    throw new InternalError(ErrorMessages.brandInformation.TRIGGER_FAILED);
  }

  let handle: { id: string };
  try {
    handle = await tasks.trigger<typeof brandInfoExtraction>(
      "brand-info-extraction",
      { app_id: id, workspace_id: workspaceId },
      { tags: [appRunTag(id)] }
    );
  } catch {
    await supabaseAdmin
      .from("brand_information")
      .update({ extraction_status: "error", extraction_error: ErrorMessages.brandInformation.TRIGGER_FAILED })
      .eq("app_id", id)
      .eq("workspace_id", workspaceId);
    throw new InternalError(ErrorMessages.brandInformation.TRIGGER_FAILED);
  }

  // Tracked so trigger/job-watchdog.ts can detect a run that expired/
  // crashed/was canceled before brand-info-extraction's own catch block
  // ever ran — without this, a run that never executes leaves this row
  // stuck at extraction_status: "processing" forever (see that job's own
  // success/catch paths, which clear this on every real outcome).
  await supabaseAdmin
    .from("brand_information")
    .update({ pending_run_id: handle.id })
    .eq("app_id", id)
    .eq("workspace_id", workspaceId);

  return NextResponse.json({ success: true }, { status: 200 });
});
