import { notFound, redirect } from "next/navigation";
import { BrandIdentitySection } from "@/components/apps/brand-identity-section";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getWorkspaceContext } from "@/lib/workspace-context";
import { timed } from "@/lib/perf-log";
import type { BrandInformation, PlanTier } from "@/types";

export default async function AppBrandInformationPage({
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

  const [{ data: app }, { data: workspace }, { data: brandInformation }] = await Promise.all([
    timed("brand-information/page:app_row", () =>
      supabaseAdmin
        .from("apps")
        .select("id, name, source_url, agent_credits_used_this_week, agent_credits_reset_at")
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .single()
    ),
    timed("brand-information/page:workspace_row", () =>
      supabaseAdmin.from("workspaces").select("plan_tier").eq("id", workspaceId).single()
    ),
    timed("brand-information/page:brand_information", () =>
      supabaseAdmin
        .from("brand_information")
        .select("*")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .maybeSingle()
    ),
  ]);

  if (!app) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {app.name || app.source_url}
        </h1>
        <p className="text-sm text-muted-foreground">Brand Information</p>
      </div>

      <BrandIdentitySection
        appId={app.id}
        planTier={(workspace?.plan_tier ?? "free") as PlanTier}
        agentCreditsUsedThisWeek={app.agent_credits_used_this_week}
        agentCreditsResetAt={app.agent_credits_reset_at}
        initialBrandInformation={brandInformation as BrandInformation | null}
      />
    </div>
  );
}
