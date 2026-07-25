import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { supabaseAdmin } from "@/lib/supabase-server";
import { retryPipeline } from "@/lib/pipelineRetry";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError } from "@/lib/errors/AppError";

// "Retry" on the app-level error card (components/apps/app-content-gate.tsx)
// — re-triggers whichever core pipeline stage (dna-extraction ->
// competitor-research -> diagnosis -> strategy-generation ->
// content-generation) actually needs to run next. See lib/pipelineRetry.ts
// for how the stage is determined and triggered; also used by
// POST /api/apps/[id]/retry-job when the failed System Health row is
// "content-generation" or "diagnosis".
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
    throw new NotFoundError(ErrorMessages.apps.NOT_FOUND);
  }

  const { stage } = await retryPipeline(id, workspaceId);

  return NextResponse.json({ success: true, stage }, { status: 200 });
});
