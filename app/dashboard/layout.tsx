import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { AppContextProvider, type DashboardApp } from "@/components/dashboard/AppContext";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { supabaseAdmin } from "@/lib/supabase-server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  let apps: DashboardApp[] = [];
  if (workspaceId) {
    const { data } = await supabaseAdmin
      .from("apps")
      .select("id, name, source_url, status")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    apps = data ?? [];
  }

  return (
    <AppContextProvider apps={apps}>
      <DashboardShell userEmail={user.email ?? null}>{children}</DashboardShell>
    </AppContextProvider>
  );
}
