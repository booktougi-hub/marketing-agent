import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { AppProductInformationView } from "@/components/apps/app-product-information-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { timed } from "@/lib/perf-log";
import type { AppDna, AppStatus, ProductType } from "@/types";

export default async function AppProductInformationPage({
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
  } = await timed("product-information/page:getUser", () => supabase.auth.getUser());

  if (!user) {
    redirect("/auth/login");
  }

  const { data: membership } = await timed("product-information/page:workspace_members", () =>
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
