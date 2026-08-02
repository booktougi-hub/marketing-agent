import { notFound, redirect } from "next/navigation";
import {
  AppOpportunitiesView,
  type OpportunityFinding,
} from "@/components/apps/app-opportunities-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getWorkspaceContext } from "@/lib/workspace-context";
import { timed } from "@/lib/perf-log";
import type { PlanTier, ResearchDay } from "@/types";

export default async function AppOpportunitiesPage({
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

  // findingRows only needs `id`/`workspaceId` — merged into the same
  // Promise.all as app/workspace instead of being awaited after them.
  const [{ data: app }, { data: workspace }, { data: findingRows }] = await Promise.all([
    timed("opportunities/page:app_row", () =>
      supabaseAdmin
        .from("apps")
        .select(
          "id, name, source_url, agent_credits_used_this_week, agent_credits_reset_at, agent_action_cooldowns, first_research_completed, first_research_completed_at, preferred_research_day, preferred_research_hour"
        )
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .single()
    ),
    timed("opportunities/page:workspace", () =>
      supabaseAdmin.from("workspaces").select("plan_tier").eq("id", workspaceId).single()
    ),
    timed("opportunities/page:research_findings", () =>
      supabaseAdmin
        .from("research_findings")
        .select("id, findings, status, created_at")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .eq("stream", "forum_opportunities")
        .order("created_at", { ascending: false })
    ),
  ]);

  if (!app) {
    notFound();
  }

  const findings: OpportunityFinding[] = findingRows ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {app.name || app.source_url}
        </h1>
        <p className="text-sm text-muted-foreground">Opportunities</p>
      </div>

      <AppOpportunitiesView
        appId={id}
        initialFindings={findings}
        planTier={(workspace?.plan_tier ?? "free") as PlanTier}
        agentCreditsUsedThisWeek={app.agent_credits_used_this_week}
        agentCreditsResetAt={app.agent_credits_reset_at}
        agentActionCooldowns={app.agent_action_cooldowns}
        firstResearchCompleted={app.first_research_completed}
        firstResearchCompletedAt={app.first_research_completed_at}
        preferredResearchDay={app.preferred_research_day as ResearchDay}
        preferredResearchHour={app.preferred_research_hour}
      />
    </div>
  );
}
