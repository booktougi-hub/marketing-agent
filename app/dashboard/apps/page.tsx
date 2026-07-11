import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AppIcon } from "@/components/apps/app-icon";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { App, AppStatus } from "@/types";

const STATUS_LABELS: Record<AppStatus, string> = {
  pending: "Pending",
  extracting: "Extracting app DNA...",
  strategy_pending: "Generating marketing strategy...",
  awaiting_approval: "Awaiting your approval",
  active: "Active",
  paused: "Paused",
  error: "Error",
  deleted: "Deleted",
};

export default async function AppsPage() {
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

  let apps: App[] = [];
  if (workspaceId) {
    const { data } = await supabaseAdmin
      .from("apps")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    apps = data ?? [];
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your Apps</h1>
        <Link href="/dashboard/apps/new" className={buttonVariants()}>
          <Plus />
          Add App
        </Link>
      </div>

      {apps.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <p className="max-w-sm text-sm text-muted-foreground">
              No apps yet. Add your first app to start marketing
              automatically.
            </p>
            <Link href="/dashboard/apps/new" className={buttonVariants()}>
              Add your first app
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => (
            <Link key={app.id} href={`/dashboard/apps/${app.id}/content`}>
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <AppIcon
                      name={app.name || app.source_url}
                      iconUrl={app.icon_url}
                      className="h-9 w-9"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {app.name || app.source_url}
                      </p>
                      {app.name && (
                        <p className="truncate text-xs text-muted-foreground">
                          {app.source_url}
                        </p>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant={app.status === "error" ? "destructive" : "secondary"}
                    className="w-fit"
                  >
                    {STATUS_LABELS[app.status]}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
