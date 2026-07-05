import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { AppDetailView } from "@/components/apps/app-detail-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { AppDna, AppStatus, StrategyContentPillar, StrategyPersona } from "@/types";

export default async function AppDetailPage({
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
    .select("id, name, source_url, status, dna")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!app) {
    notFound();
  }

  const status = app.status as AppStatus;

  let strategy: {
    id: string;
    personas: StrategyPersona[];
    content_pillars: StrategyContentPillar[];
    tone: string;
    channels: string[];
  } | null = null;

  if (status === "awaiting_approval" || status === "active") {
    const { data } = await supabaseAdmin
      .from("strategies")
      .select("id, personas, content_pillars, tone, channels")
      .eq("app_id", app.id)
      .eq("workspace_id", workspaceId)
      .in("status", ["draft", "active"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    strategy = data;
  }

  return (
    <AppDetailView
      appId={app.id}
      workspaceId={workspaceId}
      initialName={app.name}
      sourceUrl={app.source_url}
      initialStatus={status}
      initialDna={app.dna as AppDna | null}
      initialStrategy={strategy}
    />
  );
}
