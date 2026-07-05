import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import {
  AppContentView,
  type ContentWithAnalytics,
} from "@/components/apps/app-content-view";
import { supabaseAdmin } from "@/lib/supabase-server";

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
    .select("id, name, source_url")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!app) {
    notFound();
  }

  const [{ data: contentRows }, { data: analyticsRows }] = await Promise.all([
    supabaseAdmin
      .from("content")
      .select("*")
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .in("status", ["scheduled", "published"]),
    supabaseAdmin
      .from("analytics")
      .select("content_id, impressions, clicks, likes, fetched_at")
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .order("fetched_at", { ascending: false }),
  ]);

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

      <AppContentView appId={id} initialContent={content} />
    </div>
  );
}
