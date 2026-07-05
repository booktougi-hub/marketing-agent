import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { encryptSecret } from "@/lib/crypto";

const PLATFORM = "devto";

const postSchema = z.object({
  api_key: z.string().trim().min(1, "API key is required.").max(500),
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

// Connecting/disconnecting Dev.to is a workspace-level credential (see
// platform_credentials in SCHEMA.md — unique on (workspace_id, platform),
// no app_id column), even though this is triggered from a single app's
// settings page. We still confirm `id` belongs to the caller's workspace
// so the route can't be used to probe app ids across workspaces.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const cookieStore = await cookies();

    const resolved = await resolveWorkspaceId(cookieStore);
    if (resolved.error) return resolved.error;
    const { workspaceId } = resolved;

    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!app) {
      return NextResponse.json(
        { error: "App not found.", code: "NOT_FOUND" },
        { status: 404 }
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

    let encrypted: string;
    try {
      encrypted = encryptSecret(JSON.stringify({ api_key: parsed.data.api_key }));
    } catch (err) {
      console.error("Failed to encrypt platform credentials:", err);
      return NextResponse.json(
        { error: "Server is not configured to store credentials.", code: "SERVER_ERROR" },
        { status: 500 }
      );
    }

    const { error: upsertError } = await supabaseAdmin
      .from("platform_credentials")
      .upsert(
        {
          workspace_id: workspaceId,
          platform: PLATFORM,
          credentials: encrypted,
          is_active: true,
          connected_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,platform" }
      );

    if (upsertError) {
      return NextResponse.json(
        { error: "Failed to save connection.", code: "SERVER_ERROR" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("POST /api/apps/[id]/platforms/devto error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const cookieStore = await cookies();

    const resolved = await resolveWorkspaceId(cookieStore);
    if (resolved.error) return resolved.error;
    const { workspaceId } = resolved;

    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!app) {
      return NextResponse.json(
        { error: "App not found.", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const { error: deleteError } = await supabaseAdmin
      .from("platform_credentials")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("platform", PLATFORM);

    if (deleteError) {
      return NextResponse.json(
        { error: "Failed to disconnect.", code: "SERVER_ERROR" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/apps/[id]/platforms/devto error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
