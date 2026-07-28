import { notFound, redirect } from "next/navigation";
import { AppResearchView } from "@/components/apps/app-research-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getWorkspaceContext } from "@/lib/workspace-context";
import { getLatestMonthRows, getLatestWeekRows } from "@/lib/research";
import type { AppDna, ContentPlatform, PlanTier, ResearchDay, ResearchFinding } from "@/types";

type FindingRow = Pick<ResearchFinding, "id" | "findings" | "status" | "week_of" | "created_at">;

export default async function AppResearchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const context = await getWorkspaceContext();
  if (!context) {
    redirect("/auth/login");
  }

  const { workspaceId } = context;

  if (!workspaceId) {
    notFound();
  }

  // All four queries below only need `id`/`workspaceId`, already known at
  // this point — merged into the app/workspace batch (rather than awaited
  // afterward) so this page pays for one round-trip stage instead of two.
  const [
    { data: app },
    { data: workspace },
    { data: topicRows },
    { data: problemRows },
    { data: competitorRows },
    { data: draftRows },
  ] = await Promise.all([
    supabaseAdmin
      .from("apps")
      .select(
        "id, name, source_url, dna, agent_credits_used_this_week, agent_credits_reset_at, last_agent_action_at, first_research_completed, first_research_completed_at, preferred_research_day, preferred_research_hour"
      )
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single(),
    supabaseAdmin.from("workspaces").select("plan_tier").eq("id", workspaceId).single(),
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
    supabaseAdmin
      .from("content")
      .select("source_research_finding_id, platform")
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .not("source_research_finding_id", "is", null),
  ]);

  if (!app) {
    notFound();
  }

  const topics = getLatestWeekRows((topicRows ?? []) as FindingRow[]);
  const problems = (problemRows ?? []) as FindingRow[];
  const competitors = getLatestMonthRows((competitorRows ?? []) as FindingRow[]);
  const knownCompetitors = ((app.dna as AppDna | null)?.competitors ?? []).filter(Boolean);

  // Which platforms already have a draft generated from each finding — lets
  // the Research page's per-platform draft buttons show "already drafted"
  // correctly even after a refresh, not just within the current session.
  const draftedPlatformsByFinding: Record<string, ContentPlatform[]> = {};
  for (const row of draftRows ?? []) {
    if (!row.source_research_finding_id) continue;
    const list = draftedPlatformsByFinding[row.source_research_finding_id];
    if (list) list.push(row.platform);
    else draftedPlatformsByFinding[row.source_research_finding_id] = [row.platform];
  }

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
        knownCompetitors={knownCompetitors}
        initialDraftedPlatforms={draftedPlatformsByFinding}
        planTier={(workspace?.plan_tier ?? "free") as PlanTier}
        agentCreditsUsedThisWeek={app.agent_credits_used_this_week}
        agentCreditsResetAt={app.agent_credits_reset_at}
        lastAgentActionAt={app.last_agent_action_at}
        firstResearchCompleted={app.first_research_completed}
        firstResearchCompletedAt={app.first_research_completed_at}
        preferredResearchDay={app.preferred_research_day as ResearchDay}
        preferredResearchHour={app.preferred_research_hour}
      />
    </div>
  );
}
