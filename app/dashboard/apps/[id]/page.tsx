import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { AppStatus } from "@/types";

const LOADING_STATUSES = new Set<AppStatus>(["extracting", "strategy_pending"]);

const STATUS_LABELS: Record<AppStatus, string> = {
  pending: "Pending",
  extracting: "Extracting app DNA...",
  strategy_pending: "Generating marketing strategy...",
  awaiting_approval: "Awaiting your approval",
  active: "Active",
  paused: "Paused",
  error: "Error",
};

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
    .select("id, name, source_url, status")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!app) {
    notFound();
  }

  const status = app.status as AppStatus;
  const isLoading = LOADING_STATUSES.has(status);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{app.name || app.source_url}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          {isLoading ? (
            <>
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {STATUS_LABELS[status]}
              </p>
            </>
          ) : (
            <Badge variant={status === "error" ? "destructive" : "secondary"}>
              {STATUS_LABELS[status]}
            </Badge>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
