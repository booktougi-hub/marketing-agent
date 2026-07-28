import { notFound, redirect } from "next/navigation";
import { AppServicesView } from "@/components/apps/app-services-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getWorkspaceContext } from "@/lib/workspace-context";

export default async function AppServicesPage({
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

  const { data: app } = await supabaseAdmin
    .from("apps")
    .select("id, name, source_url")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!app) {
    notFound();
  }

  return <AppServicesView appId={app.id} appName={app.name || app.source_url} />;
}
