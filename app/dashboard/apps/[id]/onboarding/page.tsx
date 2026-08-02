import { notFound, redirect } from "next/navigation";
import { AppOnboardingView } from "@/components/apps/app-onboarding-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getWorkspaceContext } from "@/lib/workspace-context";
import type { OnboardingFinding, PlanTier } from "@/types";

export default async function AppOnboardingPage({
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

  const [{ data: app }, { data: workspace }, { data: openFindings }, { data: firstFinding }] =
    await Promise.all([
      supabaseAdmin
        .from("apps")
        .select("id, name, agent_credits_used_this_week, agent_credits_reset_at, agent_action_cooldowns")
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .single(),
      supabaseAdmin.from("workspaces").select("plan_tier").eq("id", workspaceId).single(),
      // Ordered by created_at only — 'high'/'medium'/'low' don't sort into
      // real priority order alphabetically, so severity ranking happens
      // client-side in AppOnboardingView instead.
      supabaseAdmin
        .from("onboarding_findings")
        .select("*")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .eq("status", "open")
        .order("created_at", { ascending: false }),
      // Separate from the (status = 'open') list above — this is only used
      // to know whether an audit has EVER run for this app (and when), so
      // the empty state can say "Your first audit ran on [date]" even once
      // every finding from that run has since been fixed/dismissed.
      supabaseAdmin
        .from("onboarding_findings")
        .select("created_at")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  if (!app) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{app.name || "Onboarding"}</h1>
        <p className="text-sm text-muted-foreground">Onboarding Audit</p>
      </div>

      <AppOnboardingView
        appId={id}
        initialFindings={(openFindings ?? []) as OnboardingFinding[]}
        planTier={(workspace?.plan_tier ?? "free") as PlanTier}
        agentCreditsUsedThisWeek={app.agent_credits_used_this_week}
        agentCreditsResetAt={app.agent_credits_reset_at}
        agentActionCooldowns={app.agent_action_cooldowns}
        firstAuditCompletedAt={firstFinding?.created_at ?? null}
      />
    </div>
  );
}
