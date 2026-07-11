import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { parseCompetitorGap, parseProblem } from "@/lib/research";
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

    const { data: finding } = await supabaseAdmin
      .from("research_findings")
      .select("id, stream, findings")
      .eq("id", parsed.data.research_finding_id)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!finding) {
      return NextResponse.json(
        { error: "Research finding not found.", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    if (!ALLOWED_STREAMS.includes(finding.stream as ResearchStream)) {
      return NextResponse.json(
        { error: "This finding can't be used to seed a forum search.", code: "TYPE_MISMATCH" },
        { status: 422 }
      );
    }

    const seedText =
      finding.stream === "problem_discovery"
        ? parseProblem(finding.findings).statement
        : parseCompetitorGap(finding.findings).gap;

    if (!seedText) {
      return NextResponse.json(
        {
          error: "This finding is missing the text needed to seed a search.",
          code: "INCOMPLETE_FINDING",
        },
        { status: 422 }
      );
    }

    const { error: insertError } = await supabaseAdmin.from("forum_search_seeds").insert({
      app_id: id,
      workspace_id: workspaceId,
      keyword: seedText.slice(0, SEED_MAX_LENGTH),
      source_research_finding_id: finding.id,
    });

    if (insertError) {
      return NextResponse.json(
        { error: "Failed to queue forum search.", code: "SERVER_ERROR" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("POST /api/apps/[id]/research/seed-forum-search error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
