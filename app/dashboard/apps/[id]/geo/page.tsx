import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { AppGeoView } from "@/components/apps/app-geo-view";
import { supabaseAdmin } from "@/lib/supabase-server";

// GEO scoring itself isn't built yet (SCORING.md's second evaluation track:
// content quality/structure/freshness signals for AI-engine citation,
// LLM-judged — sequenced after the SEO track, see PHASES.md Notes Log), so
// AppGeoView renders illustrative demo data with a clear "Demo data" banner
// rather than a real audit. The schema (seo_geo_scores/seo_geo_findings)
// already supports track='geo' rows, so this becomes a real data fetch
// later, not a schema change.
export default async function AppGeoPage({
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

  const { data: app } = await supabaseAdmin
    .from("apps")
    .select("id, name")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!app) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{app.name || "GEO"}</h1>
        <p className="text-sm text-muted-foreground">Generative Engine Optimization</p>
      </div>

      <AppGeoView />
    </div>
  );
}
