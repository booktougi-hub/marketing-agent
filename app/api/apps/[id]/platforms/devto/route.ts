import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { encryptSecret } from "@/lib/crypto";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError, InternalError } from "@/lib/errors/AppError";

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

// Connecting/disconnecting Dev.to is a workspace-level credential (see
// platform_credentials in SCHEMA.md — unique on (workspace_id, platform),
// no app_id column), even though this is triggered from a single app's
// settings page. We still confirm `id` belongs to the caller's workspace
// so the route can't be used to probe app ids across workspaces.
export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
    const { id } = await params;
    const cookieStore = await cookies();

    const { workspaceId } = await resolveWorkspaceId(cookieStore);

    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!app) {
      throw new NotFoundError(ErrorMessages.apps.NOT_FOUND);
    }

    const json = await request.json().catch(() => null);
    const parsed = postSchema.safeParse(json);

    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? ErrorMessages.generic.INVALID_REQUEST_BODY);
    }

    let encrypted: string;
    try {
      encrypted = encryptSecret(JSON.stringify({ api_key: parsed.data.api_key }));
    } catch (err) {
      console.error("Failed to encrypt platform credentials:", err);
      throw new InternalError(ErrorMessages.platforms.NOT_CONFIGURED);
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
      throw new InternalError(ErrorMessages.platforms.SAVE_FAILED);
    }

    return NextResponse.json({ success: true }, { status: 200 });
});

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
    const { id } = await params;
    const cookieStore = await cookies();

    const { workspaceId } = await resolveWorkspaceId(cookieStore);

    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!app) {
      throw new NotFoundError(ErrorMessages.apps.NOT_FOUND);
    }

    const { error: deleteError } = await supabaseAdmin
      .from("platform_credentials")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("platform", PLATFORM);

    if (deleteError) {
      throw new InternalError(ErrorMessages.platforms.DISCONNECT_FAILED);
    }

    return NextResponse.json({ success: true }, { status: 200 });
});
