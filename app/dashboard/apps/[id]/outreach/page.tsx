import { notFound, redirect } from "next/navigation";
import { AppOutreachView } from "@/components/apps/app-outreach-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getWorkspaceContext } from "@/lib/workspace-context";
import type { ColdEmailProspect, EmailInteraction, IcpData, IcpStatus, PlanTier } from "@/types";

export default async function AppOutreachPage({
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

  // None of these four queries depend on each other (prospects/interactions
  // only need `id`/`workspaceId`, already known) — merged into one
  // Promise.all instead of two sequential ones.
  const [{ data: app }, { data: workspace }, { data: prospectRows }, { data: interactionRows }] =
    await Promise.all([
      supabaseAdmin
        .from("apps")
        .select(
          "id, name, source_url, agent_credits_used_this_week, agent_credits_reset_at, agent_action_cooldowns, icp_data, icp_status, first_outreach_completed"
        )
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .single(),
      supabaseAdmin.from("workspaces").select("plan_tier").eq("id", workspaceId).single(),
      supabaseAdmin
        .from("cold_email_prospects")
        .select("*")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("email_interactions")
        .select("*")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true }),
    ]);

  if (!app) {
    notFound();
  }

  const prospects: ColdEmailProspect[] = prospectRows ?? [];
  const interactions: EmailInteraction[] = interactionRows ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {app.name || app.source_url}
        </h1>
        <p className="text-sm text-muted-foreground">Outreach</p>
      </div>

      <AppOutreachView
        appId={id}
        initialProspects={prospects}
        initialInteractions={interactions}
        planTier={(workspace?.plan_tier ?? "free") as PlanTier}
        agentCreditsUsedThisWeek={app.agent_credits_used_this_week}
        agentCreditsResetAt={app.agent_credits_reset_at}
        agentActionCooldowns={app.agent_action_cooldowns}
        initialIcpData={app.icp_data as IcpData | null}
        initialIcpStatus={app.icp_status as IcpStatus}
        firstOutreachCompleted={app.first_outreach_completed}
      />
    </div>
  );
}
