import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError, InternalError } from "@/lib/errors/AppError";

// 5000 was fine when every post was a short social update, but Dev.to
// articles (content_type 'article') routinely run several thousand
// characters of Markdown — headers, tables, links included.
const patchSchema = z.object({
  body: z.string().trim().min(1, "Post body can't be empty.").max(20000),
  // Optional — only sent when the caller is rescheduling a planned post's
  // date/time (see PlannedPostCard's date/time picker). Draft edits never
  // include this.
  scheduled_at: z.string().datetime().optional(),
});

async function resolveWorkspaceId(cookieStore: Awaited<ReturnType<typeof cookies>>) {
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

  return { workspaceId };
}

export const PATCH = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contentId: string }> }
) => {
    const { id, contentId } = await params;
    const cookieStore = await cookies();

    const { workspaceId } = await resolveWorkspaceId(cookieStore);

    const json = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(json);

    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? ErrorMessages.generic.INVALID_REQUEST_BODY);
    }

    const { data: existing } = await supabaseAdmin
      .from("content")
      .select("id, status")
      .eq("id", contentId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!existing) {
      throw new NotFoundError(ErrorMessages.content.NOT_FOUND);
    }

    if (existing.status !== "scheduled" && existing.status !== "draft") {
      throw new ValidationError(ErrorMessages.content.INVALID_STATE_EDIT, "INVALID_STATE");
    }

    // Rescheduling only makes sense for a post that's already scheduled —
    // a draft is promoted to "scheduled" through its own flow, not by
    // slipping a scheduled_at onto this generic edit route.
    if (parsed.data.scheduled_at && existing.status !== "scheduled") {
      throw new ValidationError(ErrorMessages.content.INVALID_STATE_EDIT, "INVALID_STATE");
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("content")
      .update({
        body: parsed.data.body,
        ...(parsed.data.scheduled_at ? { scheduled_at: parsed.data.scheduled_at } : {}),
      })
      .eq("id", contentId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (updateError || !updated) {
      throw new InternalError(ErrorMessages.content.UPDATE_FAILED);
    }

    return NextResponse.json({ content: updated }, { status: 200 });
});

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contentId: string }> }
) => {
    const { id, contentId } = await params;
    const cookieStore = await cookies();

    const { workspaceId } = await resolveWorkspaceId(cookieStore);

    const { data: existing } = await supabaseAdmin
      .from("content")
      .select("id, status")
      .eq("id", contentId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!existing) {
      throw new NotFoundError(ErrorMessages.content.NOT_FOUND);
    }

    if (existing.status !== "scheduled" && existing.status !== "draft") {
      throw new ValidationError(ErrorMessages.content.INVALID_STATE_DELETE, "INVALID_STATE");
    }

    const { error: deleteError } = await supabaseAdmin
      .from("content")
      .delete()
      .eq("id", contentId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId);

    if (deleteError) {
      throw new InternalError(ErrorMessages.content.DELETE_FAILED);
    }

    return NextResponse.json({ success: true }, { status: 200 });
});
