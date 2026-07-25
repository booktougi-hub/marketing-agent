import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { AppRetentionView } from "@/components/apps/app-retention-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { ChurnFinding, PlanTier } from "@/types";

export default async function AppRetentionPage({
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

  const [{ data: app }, { data: workspace }, { data: openFindings }, { data: firstFinding }] =
    await Promise.all([
      supabaseAdmin
        .from("apps")
        .select("id, name, agent_credits_used_this_week, agent_credits_reset_at, last_agent_action_at")
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .single(),
      supabaseAdmin.from("workspaces").select("plan_tier").eq("id", workspaceId).single(),
      supabaseAdmin
        .from("churn_findings")
        .select("*")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .eq("status", "open")
        .order("created_at", { ascending: false }),
      // Same purpose as onboarding's firstFinding query — whether an audit
      // has EVER run for this app (and when), independent of the
      // (status = 'open') list above, so the empty state can still say
      // "Your first audit ran on [date]" once every finding is resolved.
      supabaseAdmin
        .from("churn_findings")
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
        <h1 className="text-2xl font-semibold tracking-tight">{app.name || "Retention"}</h1>
        <p className="text-sm text-muted-foreground">Churn Prevention Audit</p>
      </div>

      <AppRetentionView
        appId={id}
        initialFindings={(openFindings ?? []) as ChurnFinding[]}
        planTier={(workspace?.plan_tier ?? "free") as PlanTier}
        agentCreditsUsedThisWeek={app.agent_credits_used_this_week}
        agentCreditsResetAt={app.agent_credits_reset_at}
        lastAgentActionAt={app.last_agent_action_at}
        firstAuditCompletedAt={firstFinding?.created_at ?? null}
      />
    </div>
  );
}
