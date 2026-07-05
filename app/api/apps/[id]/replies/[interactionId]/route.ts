import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";

const patchSchema = z.object({
  actioned: z.boolean(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; interactionId: string }> }
) {
  try {
    const { id, interactionId } = await params;

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
    const parsed = patchSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body.", code: "VALIDATION_ERROR" },
        { status: 422 }
      );
    }

    const { data: existing } = await supabaseAdmin
      .from("email_interactions")
      .select("id, replied_at")
      .eq("id", interactionId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: "Reply not found.", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    if (!existing.replied_at) {
      return NextResponse.json(
        { error: "This interaction is not a reply.", code: "INVALID_STATE" },
        { status: 422 }
      );
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("email_interactions")
      .update({ actioned_at: parsed.data.actioned ? new Date().toISOString() : null })
      .eq("id", interactionId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "Failed to update reply.", code: "SERVER_ERROR" },
        { status: 500 }
      );
    }

    return NextResponse.json({ interaction: updated }, { status: 200 });
  } catch (error) {
    console.error("PATCH /api/apps/[id]/replies/[interactionId] error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
