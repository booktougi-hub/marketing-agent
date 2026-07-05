import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { StrategyPersona } from "@/types";

const postSchema = z.object({
  name: z.string().trim().min(1, "Persona name can't be empty.").max(200),
  role: z.string().trim().min(1, "Persona role can't be empty.").max(200),
  pain_points: z.array(z.string().trim().min(1)).max(20).default([]),
  where_they_hang_out: z.array(z.string().trim().min(1)).max(20).default([]),
});

// Lets the user add a custom persona to the draft strategy shown on the
// awaiting-approval preview, before they approve or regenerate it. Only
// ever targets the current 'draft' strategy row — the active strategy has
// its own append endpoint (strategy/pillars) used from the Research page.
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

    const { data: draftStrategy } = await supabaseAdmin
      .from("strategies")
      .select("id, personas")
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!draftStrategy) {
      return NextResponse.json(
        { error: "No draft strategy found for this app.", code: "NO_STRATEGY" },
        { status: 404 }
      );
    }

    const existingPersonas = (draftStrategy.personas ?? []) as StrategyPersona[];
    const newPersona: StrategyPersona = {
      name: parsed.data.name,
      role: parsed.data.role,
      pain_points: parsed.data.pain_points,
      where_they_hang_out: parsed.data.where_they_hang_out,
    };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("strategies")
      .update({ personas: [...existingPersonas, newPersona] })
      .eq("id", draftStrategy.id)
      .eq("workspace_id", workspaceId)
      .select("id, personas, content_pillars, tone, channels")
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "Failed to add persona.", code: "SERVER_ERROR" },
        { status: 500 }
      );
    }

    return NextResponse.json({ strategy: updated }, { status: 200 });
  } catch (error) {
    console.error("POST /api/apps/[id]/strategy/draft/personas error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
