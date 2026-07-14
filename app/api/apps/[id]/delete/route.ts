import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError, InternalError } from "@/lib/errors/AppError";

const postSchema = z.object({
  confirm_name: z.string().trim().min(1, "Confirmation text is required."),
});

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
      throw new ValidationError(parsed.error.issues[0]?.message ?? ErrorMessages.generic.INVALID_REQUEST_BODY);
    }

    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("id, name, source_url, deleted_at")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!app || app.deleted_at) {
      throw new NotFoundError(ErrorMessages.apps.NOT_FOUND);
    }

    const expectedConfirmation = app.name || app.source_url;
    if (parsed.data.confirm_name !== expectedConfirmation) {
      throw new ValidationError(ErrorMessages.apps.DELETE_CONFIRMATION_MISMATCH);
    }

    const { error: updateError } = await supabaseAdmin
      .from("apps")
      .update({ deleted_at: new Date().toISOString(), status: "deleted" })
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (updateError) {
      throw new InternalError(ErrorMessages.apps.DELETE_FAILED);
    }

    return NextResponse.json({ success: true }, { status: 200 });
});
