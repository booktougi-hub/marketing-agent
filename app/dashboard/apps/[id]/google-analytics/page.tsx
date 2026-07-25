import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { AppGoogleAnalyticsView } from "@/components/apps/app-google-analytics-view";
import { supabaseAdmin } from "@/lib/supabase-server";

// No real Google Analytics integration exists yet — needs a "Sign in with
// Google" OAuth flow (GA4 Data API read scope, one connection per app, same
// shape as the existing Twitter/LinkedIn platform_credentials pattern),
// which in turn requires a Google Cloud OAuth client that doesn't exist in
// this project yet (see PHASES.md Notes Log). AppGoogleAnalyticsView
// renders illustrative demo data with a clear "Demo data" banner instead of
// a bare placeholder, so this preview shows what the real dashboard will
// look like once that OAuth flow is built.
export default async function AppGoogleAnalyticsPage({
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
        <h1 className="text-2xl font-semibold tracking-tight">{app.name || "Google Analytics"}</h1>
        <p className="text-sm text-muted-foreground">Google Analytics</p>
      </div>

      <AppGoogleAnalyticsView />
    </div>
  );
}
