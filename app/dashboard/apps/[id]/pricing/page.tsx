import { notFound, redirect } from "next/navigation";
import { AppPricingView } from "@/components/apps/app-pricing-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getWorkspaceContext } from "@/lib/workspace-context";
import type { PlanTier, PricingFinding } from "@/types";

export default async function AppPricingPage({
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
      supabaseAdmin
        .from("pricing_findings")
        .select("*")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .eq("status", "open")
        .order("created_at", { ascending: false }),
      // Same purpose as the other three audits' firstFinding query —
      // whether an audit has EVER run for this app (and when), independent
      // of the (status = 'open') list above.
      supabaseAdmin
        .from("pricing_findings")
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
        <h1 className="text-2xl font-semibold tracking-tight">{app.name || "Pricing"}</h1>
        <p className="text-sm text-muted-foreground">Pricing Audit</p>
      </div>

      <AppPricingView
        appId={id}
        initialFindings={(openFindings ?? []) as PricingFinding[]}
        planTier={(workspace?.plan_tier ?? "free") as PlanTier}
        agentCreditsUsedThisWeek={app.agent_credits_used_this_week}
        agentCreditsResetAt={app.agent_credits_reset_at}
        agentActionCooldowns={app.agent_action_cooldowns}
        firstAuditCompletedAt={firstFinding?.created_at ?? null}
      />
    </div>
  );
}
