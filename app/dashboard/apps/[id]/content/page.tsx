import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { AppContentGate } from "@/components/apps/app-content-gate";
import type { ContentWithAnalytics } from "@/components/apps/app-content-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { timed } from "@/lib/perf-log";
import type { AppDna, AppStatus, StrategyContentPillar, StrategyPersona } from "@/types";

const LOADING_OR_PENDING_STATUSES = new Set<AppStatus>([
  "pending",
  "extracting",
  "strategy_pending",
  "awaiting_approval",
]);

export default async function AppContentPage({
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
  } = await timed("content/page:getUser", () => supabase.auth.getUser());

  if (!user) {
    redirect("/auth/login");
  }

  const { data: membership } = await timed("content/page:workspace_members", () =>
    supabaseAdmin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .single()
  );

  const workspaceId = membership?.workspace_id as string | undefined;

  if (!workspaceId) {
    notFound();
  }

  const { data: app } = await timed("content/page:app_row", () =>
    supabaseAdmin
      .from("apps")
      .select("id, name, source_url, status, dna, error_message")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single()
  );

  if (!app) {
    notFound();
  }

  const status = app.status as AppStatus;

  let draftStrategy: {
    id: string;
    personas: StrategyPersona[];
    content_pillars: StrategyContentPillar[];
    tone: string;
    channels: string[];
  } | null = null;
  if (LOADING_OR_PENDING_STATUSES.has(status)) {
    const { data } = await timed("content/page:draft_strategy", () =>
      supabaseAdmin
        .from("strategies")
        .select("id, personas, content_pillars, tone, channels")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    );
    draftStrategy = data;
  }

  const [{ data: contentRows }, { data: analyticsRows }] = await timed(
    "content/page:content+analytics",
    () =>
      Promise.all([
        supabaseAdmin
          .from("content")
          .select("*")
          .eq("app_id", id)
          .eq("workspace_id", workspaceId)
          .in("status", ["draft", "scheduled", "published"]),
        supabaseAdmin
          .from("analytics")
          .select("content_id, impressions, clicks, likes, fetched_at")
          .eq("app_id", id)
          .eq("workspace_id", workspaceId)
          .order("fetched_at", { ascending: false }),
      ])
  );

  const analyticsByContentId = new Map<
    string,
    { impressions: number; clicks: number; likes: number }
  >();
  for (const row of analyticsRows ?? []) {
    if (!analyticsByContentId.has(row.content_id)) {
      analyticsByContentId.set(row.content_id, {
        impressions: row.impressions,
        clicks: row.clicks,
        likes: row.likes,
      });
    }
  }

  const content: ContentWithAnalytics[] = (contentRows ?? []).map((row) => ({
    ...row,
    analytics: analyticsByContentId.get(row.id) ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {app.name || app.source_url}
        </h1>
        <p className="text-sm text-muted-foreground">Content</p>
      </div>

      <AppContentGate
        appId={id}
        workspaceId={workspaceId}
        initialStatus={status}
        initialDna={app.dna as AppDna | null}
        initialStrategy={draftStrategy}
        initialErrorMessage={app.error_message}
        initialContent={content}
      />
    </div>
  );
}
