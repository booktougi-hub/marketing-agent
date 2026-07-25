import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { AppSettingsView } from "@/components/apps/app-settings-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { parseConversionRetention, parsePublishingSchedule } from "@/lib/app-settings";
import type { AppStatus, PlanTier, ResearchDay } from "@/types";

export default async function AppSettingsPage({
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

  const [{ data: app }, { data: workspace }, { data: devtoCredential }, { data: nextContent }] =
    await Promise.all([
      supabaseAdmin
        .from("apps")
        .select(
          "id, name, source_url, product_type, additional_context, url_changed_at, reanalysis_credits_used, reanalysis_credits_reset_at, app_settings, is_paused, status, agent_credits_used_this_week, agent_credits_reset_at, preferred_research_day, preferred_research_hour"
        )
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .single(),
      supabaseAdmin.from("workspaces").select("plan_tier").eq("id", workspaceId).single(),
      supabaseAdmin
        .from("platform_credentials")
        .select("is_active")
        .eq("workspace_id", workspaceId)
        .eq("platform", "devto")
        .maybeSingle(),
      supabaseAdmin
        .from("content")
        .select("scheduled_at, platform")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .eq("status", "scheduled")
        .order("scheduled_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  if (!app) {
    notFound();
  }

  return (
    <AppSettingsView
      appId={app.id}
      appName={app.name}
      sourceUrl={app.source_url}
      productType={app.product_type}
      additionalContext={app.additional_context}
      urlChangedAt={app.url_changed_at}
      planTier={(workspace?.plan_tier ?? "free") as PlanTier}
      reanalysisCreditsUsed={app.reanalysis_credits_used}
      reanalysisCreditsResetAt={app.reanalysis_credits_reset_at}
      publishingSchedule={parsePublishingSchedule(
        (app.app_settings as Record<string, unknown> | null)?.publishing_schedule
      )}
      conversionRetention={parseConversionRetention(
        (app.app_settings as Record<string, unknown> | null)?.conversion_retention
      )}
      devtoConnected={!!devtoCredential?.is_active}
      isPaused={app.is_paused}
      appStatus={app.status as AppStatus}
      nextScheduledContent={
        nextContent?.scheduled_at
          ? { scheduledAt: nextContent.scheduled_at, platform: nextContent.platform }
          : null
      }
      agentCreditsUsedThisWeek={app.agent_credits_used_this_week}
      agentCreditsResetAt={app.agent_credits_reset_at}
      preferredResearchDay={app.preferred_research_day as ResearchDay}
      preferredResearchHour={app.preferred_research_hour}
    />
  );
}
