import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";

const postSchema = z.object({
  confirm_name: z.string().trim().min(1, "Confirmation text is required."),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHENTICATED" },
        { status: 401 }
      );
    }

    const { data: membership } = await supabaseAdmin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .single();

    const workspaceId = membership?.workspace_id as string | undefined;

    if (!workspaceId) {
      return NextResponse.json(
        { error: "No workspace found for this account.", code: "NO_WORKSPACE" },
        { status: 403 }
      );
    }

    const json = await request.json().catch(() => null);
    const parsed = postSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid request body.",
          code: "VALIDATION_ERROR",
        },
        { status: 422 }
      );
    }

    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("id, name, source_url, deleted_at")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!app || app.deleted_at) {
      return NextResponse.json(
        { error: "App not found.", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const expectedConfirmation = app.name || app.source_url;
    if (parsed.data.confirm_name !== expectedConfirmation) {
      return NextResponse.json(
        { error: "Confirmation text does not match the app name.", code: "VALIDATION_ERROR" },
        { status: 422 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("apps")
      .update({ deleted_at: new Date().toISOString(), status: "deleted" })
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to delete app.", code: "SERVER_ERROR" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("POST /api/apps/[id]/delete error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
