import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { StrategyContentPillar } from "@/types";

const postSchema = z.object({
  findingId: z.string().uuid(),
  pillar: z.object({
    name: z.string().trim().min(1, "Pillar name can't be empty.").max(200),
    description: z.string().trim().min(1, "Pillar description can't be empty.").max(1000),
    example_topics: z.array(z.string()).default([]),
  }),
});

// Appends a new content pillar to the app's active strategy — used by the
// Research section's "Add to Strategy" action (competitor gap findings).
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

    const { data: finding } = await supabaseAdmin
      .from("research_findings")
      .select("id")
      .eq("id", parsed.data.findingId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!finding) {
      return NextResponse.json(
        { error: "Finding not found.", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const { data: strategy } = await supabaseAdmin
      .from("strategies")
      .select("id, content_pillars")
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!strategy) {
      return NextResponse.json(
        { error: "No active strategy found for this app.", code: "NO_STRATEGY" },
        { status: 422 }
      );
    }

    const existingPillars = (strategy.content_pillars ?? []) as StrategyContentPillar[];
    const updatedPillars: StrategyContentPillar[] = [...existingPillars, parsed.data.pillar];

    const { data: updatedStrategy, error: updateError } = await supabaseAdmin
      .from("strategies")
      .update({ content_pillars: updatedPillars })
      .eq("id", strategy.id)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (updateError || !updatedStrategy) {
      return NextResponse.json(
        { error: "Failed to update strategy.", code: "SERVER_ERROR" },
        { status: 500 }
      );
    }

    await supabaseAdmin
      .from("research_findings")
      .update({ status: "acted_on" })
      .eq("id", parsed.data.findingId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId);

    return NextResponse.json({ strategy: updatedStrategy }, { status: 200 });
  } catch (error) {
    console.error("POST /api/apps/[id]/strategy/pillars error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
