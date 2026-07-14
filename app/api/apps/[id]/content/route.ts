import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError, InternalError } from "@/lib/errors/AppError";
import type { ContentPlatform } from "@/types";

const DEFAULT_PLATFORM: ContentPlatform = "twitter";

const postSchema = z.object({
  topic: z.string().trim().min(1, "Topic can't be empty.").max(300),
  angle: z.string().trim().max(1000).optional(),
});

// Creates a draft post seeded from a research topic — used by the Research
// section's "Use This Topic" action. There's no dedicated "brief" field on
// content, so the topic + suggested angle become the starting draft body.
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

    const json = await request.json().catch(() => null);
    const parsed = postSchema.safeParse(json);

    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? ErrorMessages.generic.INVALID_REQUEST_BODY);
    }

    const { data: activeStrategy } = await supabaseAdmin
      .from("strategies")
      .select("id, channels")
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const platform: ContentPlatform =
      (activeStrategy?.channels?.[0] as ContentPlatform | undefined) ?? DEFAULT_PLATFORM;

    const body = parsed.data.angle
      ? `${parsed.data.angle}\n\nTopic: ${parsed.data.topic}`
      : `Topic: ${parsed.data.topic}`;

    const { data: created, error: insertError } = await supabaseAdmin
      .from("content")
      .insert({
        app_id: id,
        workspace_id: workspaceId,
        strategy_id: activeStrategy?.id ?? null,
        platform,
        content_type: "post",
        body,
        pillar: parsed.data.topic,
        status: "draft",
      })
      .select()
      .single();

    if (insertError || !created) {
      throw new InternalError(ErrorMessages.content.CREATE_FAILED);
    }

    return NextResponse.json({ content: created }, { status: 201 });
});
