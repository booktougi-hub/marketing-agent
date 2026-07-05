import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { AppOutreachView } from "@/components/apps/app-outreach-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { ColdEmailProspect, EmailInteraction } from "@/types";

export default async function AppOutreachPage({
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

  const [{ data: prospectRows }, { data: interactionRows }] = await Promise.all([
    supabaseAdmin
      .from("cold_email_prospects")
      .select("*")
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("email_interactions")
      .select("*")
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
  ]);

  const prospects: ColdEmailProspect[] = prospectRows ?? [];
  const interactions: EmailInteraction[] = interactionRows ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {app.name || app.source_url}
        </h1>
        <p className="text-sm text-muted-foreground">Outreach</p>
      </div>

      <AppOutreachView
        appId={id}
        initialProspects={prospects}
        initialInteractions={interactions}
      />
    </div>
  );
}
