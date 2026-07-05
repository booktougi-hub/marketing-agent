import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { ContentPlatform } from "@/types";

const DEFAULT_PLATFORM: ContentPlatform = "twitter";

const postSchema = z.object({
  topic: z.string().trim().min(1, "Topic can't be empty.").max(300),
  angle: z.string().trim().max(1000).optional(),
});

// Creates a draft post seeded from a research topic — used by the Research
// section's "Use This Topic" action. There's no dedicated "brief" field on
// content, so the topic + suggested angle become the starting draft body.
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
      return NextResponse.json(
        { error: "Failed to create draft post.", code: "SERVER_ERROR" },
        { status: 500 }
      );
    }

    return NextResponse.json({ content: created }, { status: 201 });
  } catch (error) {
    console.error("POST /api/apps/[id]/content error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
