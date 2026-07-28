import { notFound, redirect } from "next/navigation";
import { AppProductInformationView } from "@/components/apps/app-product-information-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getWorkspaceContext } from "@/lib/workspace-context";
import { timed } from "@/lib/perf-log";
import type { AppDna, AppStatus, ProductType } from "@/types";

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

  const { data: app } = await timed("product-information/page:app_row", () =>
    supabaseAdmin
      .from("apps")
      .select("id, name, source_url, product_type, status, dna")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single()
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
        <p className="text-sm text-muted-foreground">Product Information</p>
      </div>

      <AppProductInformationView
        sourceUrl={app.source_url}
        productType={app.product_type as ProductType}
        status={app.status as AppStatus}
        dna={app.dna as AppDna | null}
      />
    </div>
  );
}
