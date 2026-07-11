import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import {
  AppOpportunitiesView,
  type OpportunityFinding,
} from "@/components/apps/app-opportunities-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { timed } from "@/lib/perf-log";

export default async function AppOpportunitiesPage({
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
  } = await timed("opportunities/page:getUser", () => supabase.auth.getUser());

  if (!user) {
    redirect("/auth/login");
  }

  const { data: membership } = await timed("opportunities/page:workspace_members", () =>
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

  const { data: app } = await timed("opportunities/page:app_row", () =>
    supabaseAdmin
      .from("apps")
      .select("id, name, source_url")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single()
  );

  if (!app) {
    notFound();
  }

  const { data: findingRows } = await timed("opportunities/page:research_findings", () =>
    supabaseAdmin
      .from("research_findings")
      .select("id, findings, status, created_at")
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .eq("stream", "forum_opportunities")
      .order("created_at", { ascending: false })
  );

  const findings: OpportunityFinding[] = findingRows ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {app.name || app.source_url}
        </h1>
        <p className="text-sm text-muted-foreground">Opportunities</p>
      </div>

      <AppOpportunitiesView appId={id} initialFindings={findings} />
    </div>
  );
}
