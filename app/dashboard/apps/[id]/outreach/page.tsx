import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { AppOutreachView } from "@/components/apps/app-outreach-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { ColdEmailProspect, EmailInteraction, IcpData, IcpStatus, PlanTier } from "@/types";

export default async function AppOutreachPage({
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

  const [{ data: app }, { data: workspace }] = await Promise.all([
    supabaseAdmin
      .from("apps")
      .select(
        "id, name, source_url, agent_credits_used_this_week, agent_credits_reset_at, last_agent_action_at, icp_data, icp_status, first_outreach_completed"
      )
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single(),
    supabaseAdmin.from("workspaces").select("plan_tier").eq("id", workspaceId).single(),
  ]);

  if (!app) {
    notFound();
  }

  const [{ data: prospectRows }, { data: interactionRows }] = await Promise.all([
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
        lastAgentActionAt={app.last_agent_action_at}
        initialIcpData={app.icp_data as IcpData | null}
        initialIcpStatus={app.icp_status as IcpStatus}
        firstOutreachCompleted={app.first_outreach_completed}
      />
    </div>
  );
}
