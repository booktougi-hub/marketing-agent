import { notFound, redirect } from "next/navigation";
import { AppProductInformationView } from "@/components/apps/app-product-information-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getWorkspaceContext } from "@/lib/workspace-context";
import { timed } from "@/lib/perf-log";
import type {
  AppDna,
  AppStatus,
  CompetitorProfileStatus,
  CompetitorResearch,
  DnaExtractionSource,
  DnaReextractionStatus,
  PlanTier,
  ProductType,
} from "@/types";

export default async function AppProductInformationPage({
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

  const [{ data: app }, { data: workspace }, { data: competitors }] = await Promise.all([
    timed("product-information/page:app_row", () =>
      supabaseAdmin
        .from("apps")
        .select(
          "id, name, source_url, product_type, status, dna, dna_extraction_source, dna_reextraction_status, dna_reextraction_error, agent_credits_used_this_week, agent_credits_reset_at, competitor_profile_status, competitor_profile_error, competitor_profile_last_generated_at"
        )
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .single()
    ),
    timed("product-information/page:workspace_row", () =>
      supabaseAdmin.from("workspaces").select("plan_tier").eq("id", workspaceId).single()
    ),
    timed("product-information/page:competitor_research", () =>
      supabaseAdmin
        .from("competitor_research")
        .select("*")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true })
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
        <p className="text-sm text-muted-foreground">Product Information</p>
      </div>

      <AppProductInformationView
        appId={app.id}
        planTier={(workspace?.plan_tier ?? "free") as PlanTier}
        agentCreditsUsedThisWeek={app.agent_credits_used_this_week}
        agentCreditsResetAt={app.agent_credits_reset_at}
        sourceUrl={app.source_url}
        productType={app.product_type as ProductType}
        status={app.status as AppStatus}
        dna={app.dna as AppDna | null}
        dnaExtractionSource={app.dna_extraction_source as DnaExtractionSource | null}
        dnaReextractionStatus={app.dna_reextraction_status as DnaReextractionStatus}
        dnaReextractionError={app.dna_reextraction_error}
        competitors={(competitors ?? []) as CompetitorResearch[]}
        competitorProfileStatus={app.competitor_profile_status as CompetitorProfileStatus}
        competitorProfileError={app.competitor_profile_error}
        competitorProfileLastGeneratedAt={app.competitor_profile_last_generated_at}
      />
    </div>
  );
}
