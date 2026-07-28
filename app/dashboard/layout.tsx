import { redirect } from "next/navigation";
import { AppContextProvider, type DashboardApp } from "@/components/dashboard/AppContext";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getWorkspaceContext } from "@/lib/workspace-context";
import { timed } from "@/lib/perf-log";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getWorkspaceContext();

  if (!context) {
    redirect("/auth/login");
  }

  const { workspaceId } = context;

  let apps: DashboardApp[] = [];
  if (workspaceId) {
    const { data } = await timed("layout:apps_list", () =>
      supabaseAdmin
        .from("apps")
        .select("id, name, source_url, icon_url, status")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
    );
    apps = data ?? [];
  }

  return (
    <AppContextProvider apps={apps}>
      <DashboardShell userEmail={context.user.email}>{children}</DashboardShell>
    </AppContextProvider>
  );
}
