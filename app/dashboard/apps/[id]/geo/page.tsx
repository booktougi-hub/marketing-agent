import { notFound, redirect } from "next/navigation";
import { AppGeoView } from "@/components/apps/app-geo-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getWorkspaceContext } from "@/lib/workspace-context";
import type { GeoDimScores, PlanTier, SeoGeoCheckResultMap, SeoGeoFinding } from "@/types";

// Real GEO audit panel — mirrors app/dashboard/apps/[id]/seo/page.tsx
// exactly, reading track='geo' rows from the same seo_geo_scores/
// seo_geo_findings tables trigger/seo-geo-audit.ts now writes for both
// tracks in one run.
export default async function AppGeoPage({
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

  const [{ data: app }, { data: workspace }, { data: openFindings }, { data: latestScore }] =
    await Promise.all([
      supabaseAdmin
        .from("apps")
        .select("id, name, agent_credits_used_this_week, agent_credits_reset_at, agent_action_cooldowns")
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .single(),
      supabaseAdmin.from("workspaces").select("plan_tier").eq("id", workspaceId).single(),
      supabaseAdmin
        .from("seo_geo_findings")
        .select("*")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .eq("track", "geo")
        .eq("status", "open")
        .order("expected_gain", { ascending: false }),
      supabaseAdmin
        .from("seo_geo_scores")
        .select("score, dim_scores, check_results, run_at")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .eq("track", "geo")
        .order("run_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (!app) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{app.name || "GEO"}</h1>
        <p className="text-sm text-muted-foreground">Generative Engine Optimization</p>
      </div>

      <AppGeoView
        appId={id}
        initialFindings={(openFindings ?? []) as SeoGeoFinding[]}
        latestScore={
          latestScore
            ? {
                score: latestScore.score,
                dim_scores: latestScore.dim_scores as GeoDimScores,
                check_results: latestScore.check_results as SeoGeoCheckResultMap,
                run_at: latestScore.run_at,
              }
            : null
        }
        planTier={(workspace?.plan_tier ?? "free") as PlanTier}
        agentCreditsUsedThisWeek={app.agent_credits_used_this_week}
        agentCreditsResetAt={app.agent_credits_reset_at}
        agentActionCooldowns={app.agent_action_cooldowns}
      />
    </div>
  );
}
