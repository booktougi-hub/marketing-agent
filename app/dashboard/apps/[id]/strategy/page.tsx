import { notFound, redirect } from "next/navigation";
import { AppStrategyView } from "@/components/apps/app-strategy-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getWorkspaceContext } from "@/lib/workspace-context";
import { timed } from "@/lib/perf-log";
import type { AppDna, AppStatus, Strategy } from "@/types";

export default async function AppStrategyPage({
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

  // `strategy` only needs `id`/`workspaceId`, not `app` — merged into the
  // same Promise.all instead of being awaited after it.
  const [{ data: app }, { data: strategy }] = await timed("strategy/page:app+strategy", () =>
    Promise.all([
      supabaseAdmin
        .from("apps")
        .select("id, name, source_url, status, dna")
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .single(),
      supabaseAdmin
        .from("strategies")
        .select("*")
        .eq("app_id", id)
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
  );

  if (!app) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {app.name || app.source_url}
        </h1>
        <p className="text-sm text-muted-foreground">Strategy</p>
      </div>

      <AppStrategyView
        appId={id}
        appStatus={app.status as AppStatus}
        dna={app.dna as AppDna | null}
        strategy={strategy as Strategy | null}
      />
    </div>
  );
}
