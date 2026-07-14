import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { parseCompetitorGap, parseProblem } from "@/lib/research";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError, InternalError } from "@/lib/errors/AppError";
import type { ResearchStream } from "@/types";

const postSchema = z.object({
  research_finding_id: z.string().uuid(),
});

// Only problems and competitor gaps seed forum search — a trending topic
// isn't a complaint or a gap, so there's nothing for the Forum Opportunity
// Finder to look for a matching thread about.
const ALLOWED_STREAMS: ResearchStream[] = ["problem_discovery", "competitor_gap"];

const SEED_MAX_LENGTH = 300;

// Queues a research finding's text as input for the next Forum Opportunity
// Finder run (trigger/forum-opportunity-finder.ts) — used by the Problems
// and Competitors tabs' "Search Forums For This" action. Never generates
// content itself: Reddit/forum posts must always be a reply to a thread
// that job actually finds, never a standalone draft.
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

    const { data: finding } = await supabaseAdmin
      .from("research_findings")
      .select("id, stream, findings")
      .eq("id", parsed.data.research_finding_id)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!finding) {
      throw new NotFoundError(ErrorMessages.research.FINDING_NOT_FOUND);
    }

    if (!ALLOWED_STREAMS.includes(finding.stream as ResearchStream)) {
      throw new ValidationError(ErrorMessages.research.SEED_TYPE_MISMATCH, "TYPE_MISMATCH");
    }

    const seedText =
      finding.stream === "problem_discovery"
        ? parseProblem(finding.findings).statement
        : parseCompetitorGap(finding.findings).gap;

    if (!seedText) {
      throw new ValidationError(ErrorMessages.research.SEED_INCOMPLETE, "INCOMPLETE_FINDING");
    }

    const { error: insertError } = await supabaseAdmin.from("forum_search_seeds").insert({
      app_id: id,
      workspace_id: workspaceId,
      keyword: seedText.slice(0, SEED_MAX_LENGTH),
      source_research_finding_id: finding.id,
    });

    if (insertError) {
      throw new InternalError(ErrorMessages.research.SEED_FAILED);
    }

    return NextResponse.json({ success: true }, { status: 201 });
});
