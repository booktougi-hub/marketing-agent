import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";

// 5000 was fine when every post was a short social update, but Dev.to
// articles (content_type 'article') routinely run several thousand
// characters of Markdown — headers, tables, links included.
const patchSchema = z.object({
  body: z.string().trim().min(1, "Post body can't be empty.").max(20000),
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
    return { error: NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401 }) };
  }

  const { data: membership } = await supabaseAdmin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  const workspaceId = membership?.workspace_id as string | undefined;

  if (!workspaceId) {
    return {
      error: NextResponse.json(
        { error: "No workspace found for this account.", code: "NO_WORKSPACE" },
        { status: 403 }
      ),
    };
  }

  return { workspaceId };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contentId: string }> }
) {
  try {
    const { id, contentId } = await params;
    const cookieStore = await cookies();

    const resolved = await resolveWorkspaceId(cookieStore);
    if (resolved.error) return resolved.error;
    const { workspaceId } = resolved;

    const json = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid request body.",
          code: "VALIDATION_ERROR",
        },
        { status: 422 }
      );
    }

    const { data: existing } = await supabaseAdmin
      .from("content")
      .select("id, status")
      .eq("id", contentId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: "Post not found.", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    if (existing.status !== "scheduled" && existing.status !== "draft") {
      return NextResponse.json(
        { error: "Only scheduled or draft posts can be edited.", code: "INVALID_STATE" },
        { status: 422 }
      );
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("content")
      .update({ body: parsed.data.body })
      .eq("id", contentId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "Failed to update post.", code: "SERVER_ERROR" },
        { status: 500 }
      );
    }

    return NextResponse.json({ content: updated }, { status: 200 });
  } catch (error) {
    console.error("PATCH /api/apps/[id]/content/[contentId] error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contentId: string }> }
) {
  try {
    const { id, contentId } = await params;
    const cookieStore = await cookies();

    const resolved = await resolveWorkspaceId(cookieStore);
    if (resolved.error) return resolved.error;
    const { workspaceId } = resolved;

    const { data: existing } = await supabaseAdmin
      .from("content")
      .select("id, status")
      .eq("id", contentId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: "Post not found.", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    if (existing.status !== "scheduled" && existing.status !== "draft") {
      return NextResponse.json(
        { error: "Only scheduled or draft posts can be deleted.", code: "INVALID_STATE" },
        { status: 422 }
      );
    }

    const { error: deleteError } = await supabaseAdmin
      .from("content")
      .delete()
      .eq("id", contentId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId);

    if (deleteError) {
      return NextResponse.json(
        { error: "Failed to delete post.", code: "SERVER_ERROR" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/apps/[id]/content/[contentId] error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
