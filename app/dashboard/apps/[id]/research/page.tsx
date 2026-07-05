import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { AppResearchView } from "@/components/apps/app-research-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getLatestMonthRows, getLatestWeekRows } from "@/lib/research";
import type { ResearchFinding } from "@/types";

type FindingRow = Pick<ResearchFinding, "id" | "findings" | "status" | "week_of" | "created_at">;

export default async function AppResearchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
        setAll() {
          // Server Components can't set cookies; middleware handles refresh.
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: membership } = await supabaseAdmin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  const workspaceId = membership?.workspace_id as string | undefined;

  if (!workspaceId) {
    notFound();
  }

  const { data: app } = await supabaseAdmin
    .from("apps")
    .select("id, name, source_url")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!app) {
    notFound();
  }

  const [{ data: topicRows }, { data: problemRows }, { data: competitorRows }] =
    await Promise.all([
      supabaseAdmin
        .from("research_findings")
        .select("id, findings, status, week_of, created_at")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .eq("stream", "topic_research")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("research_findings")
        .select("id, findings, status, week_of, created_at")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .eq("stream", "problem_discovery")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("research_findings")
        .select("id, findings, status, week_of, created_at")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .eq("stream", "competitor_gap")
        .order("created_at", { ascending: false }),
    ]);

  const topics = getLatestWeekRows((topicRows ?? []) as FindingRow[]);
  const problems = (problemRows ?? []) as FindingRow[];
  const competitors = getLatestMonthRows((competitorRows ?? []) as FindingRow[]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {app.name || app.source_url}
        </h1>
        <p className="text-sm text-muted-foreground">Research</p>
      </div>

      <AppResearchView
        appId={id}
        initialTopics={topics}
        initialProblems={problems}
        initialCompetitors={competitors}
      />
    </div>
  );
}
