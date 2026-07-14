import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError, InternalError } from "@/lib/errors/AppError";
import type { StrategyContentPillar } from "@/types";

const postSchema = z.object({
  name: z.string().trim().min(1, "Pillar name can't be empty.").max(200),
  description: z.string().trim().min(1, "Pillar description can't be empty.").max(1000),
  example_topics: z.array(z.string().trim().min(1)).max(20).default([]),
});

// Lets the user add a custom content pillar to the draft strategy shown on
// the awaiting-approval preview, before they approve or regenerate it. Only
// ever targets the current 'draft' strategy row — the active strategy has
// its own append endpoint (strategy/pillars) used from the Research page.
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

    const json = await request.json().catch(() => null);
    const parsed = postSchema.safeParse(json);

    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? ErrorMessages.generic.INVALID_REQUEST_BODY);
    }

    const { data: draftStrategy } = await supabaseAdmin
      .from("strategies")
      .select("id, content_pillars")
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!draftStrategy) {
      throw new NotFoundError(ErrorMessages.strategy.NO_DRAFT_FOR_APP, "NO_STRATEGY");
    }

    const existingPillars = (draftStrategy.content_pillars ?? []) as StrategyContentPillar[];
    const newPillar: StrategyContentPillar = {
      name: parsed.data.name,
      description: parsed.data.description,
      example_topics: parsed.data.example_topics,
    };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("strategies")
      .update({ content_pillars: [...existingPillars, newPillar] })
      .eq("id", draftStrategy.id)
      .eq("workspace_id", workspaceId)
      .select("id, personas, content_pillars, tone, channels")
      .single();

    if (updateError || !updated) {
      throw new InternalError(ErrorMessages.strategy.ADD_PILLAR_FAILED);
    }

    return NextResponse.json({ strategy: updated }, { status: 200 });
});
