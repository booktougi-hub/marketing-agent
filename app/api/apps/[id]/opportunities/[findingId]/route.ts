import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError, InternalError } from "@/lib/errors/AppError";

const patchSchema = z.object({
  status: z.literal("dismissed"),
});

export const PATCH = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string; findingId: string }> }
) => {
    const { id, findingId } = await params;

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
    const parsed = patchSchema.safeParse(json);

    if (!parsed.success) {
      throw new ValidationError(ErrorMessages.generic.INVALID_REQUEST_BODY);
    }

    const { data: existing } = await supabaseAdmin
      .from("research_findings")
      .select("id")
      .eq("id", findingId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .eq("stream", "forum_opportunities")
      .single();

    if (!existing) {
      throw new NotFoundError(ErrorMessages.research.OPPORTUNITY_NOT_FOUND);
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("research_findings")
      .update({ status: parsed.data.status })
      .eq("id", findingId)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (updateError || !updated) {
      throw new InternalError(ErrorMessages.research.OPPORTUNITY_DISMISS_FAILED);
    }

    return NextResponse.json({ finding: updated }, { status: 200 });
});
