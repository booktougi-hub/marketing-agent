import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WeeklyActivityChart, type WeeklyActivityDatum } from "@/components/dashboard/WeeklyActivityChart";
import { supabaseAdmin } from "@/lib/supabase-server";
import { formatTimeAgo } from "@/lib/time";
import { OPPORTUNITY_PLATFORM_LABEL, parseForumOpportunity } from "@/lib/opportunity";
import type { ContentPlatform } from "@/types";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface PublishedPostRow {
  platform: ContentPlatform;
  body: string;
  published_at: string;
}

interface OpportunityRow {
  id: string;
  findings: unknown;
  created_at: string;
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function AppOverviewPage({
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

  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

  const [
    publishedThisWeekCount,
    scheduledCount,
    opportunitiesThisWeekCount,
    coldEmailsThisMonthCount,
    weeklyPublishedRows,
    recentActivityRows,
    topOpportunityRows,
  ] = await Promise.all([
    supabaseAdmin
      .from("content")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("app_id", id)
      .eq("status", "published")
      .gte("published_at", sevenDaysAgo),
    supabaseAdmin
      .from("content")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("app_id", id)
      .eq("status", "scheduled"),
    supabaseAdmin
      .from("research_findings")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("app_id", id)
      .eq("stream", "forum_opportunities")
      .gte("created_at", sevenDaysAgo),
    supabaseAdmin
      .from("email_interactions")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("app_id", id)
      .gte("sent_at", thirtyDaysAgo),
    supabaseAdmin
      .from("content")
      .select("platform, body, published_at")
      .eq("workspace_id", workspaceId)
      .eq("app_id", id)
      .eq("status", "published")
      .gte("published_at", sevenDaysAgo),
    supabaseAdmin
      .from("content")
      .select("platform, body, published_at")
      .eq("workspace_id", workspaceId)
      .eq("app_id", id)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("research_findings")
      .select("id, findings, created_at")
      .eq("workspace_id", workspaceId)
      .eq("app_id", id)
      .eq("stream", "forum_opportunities")
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  // ---- Weekly activity chart: bucket published posts into the trailing 7
  // UTC days, labeled by weekday, so the chart never depends on server tz.
  const days = Array.from({ length: 7 }, (_, i) => {
    const offset = 6 - i;
    const now = new Date();
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset)
    );
    return {
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    };
  });
  const dayIndexByKey = new Map(days.map((d, idx) => [d.key, idx]));

  const publishedRows = (weeklyPublishedRows.data ?? []) as PublishedPostRow[];
  const platformsPresent = Array.from(
    new Set(publishedRows.map((row) => row.platform))
  );

  const chartData: WeeklyActivityDatum[] = days.map(({ label }) => {
    const row: WeeklyActivityDatum = { day: label };
    for (const platform of platformsPresent) row[platform] = 0;
    return row;
  });

  for (const post of publishedRows) {
    const key = new Date(post.published_at).toISOString().slice(0, 10);
    const dayIndex = dayIndexByKey.get(key);
    if (dayIndex === undefined) continue;
    chartData[dayIndex][post.platform] =
      (chartData[dayIndex][post.platform] as number) + 1;
  }

  const recentActivity = (recentActivityRows.data ?? []) as PublishedPostRow[];
  const topOpportunities = (topOpportunityRows.data ?? []) as OpportunityRow[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {app.name || app.source_url}
        </h1>
        <p className="text-sm text-muted-foreground">Overview</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Posts published this week"
          value={publishedThisWeekCount.count ?? 0}
        />
        <MetricCard label="Posts scheduled" value={scheduledCount.count ?? 0} />
        <MetricCard
          label="Opportunities found this week"
          value={opportunitiesThisWeekCount.count ?? 0}
        />
        <MetricCard
          label="Cold emails sent this month"
          value={coldEmailsThisMonthCount.count ?? 0}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Weekly activity</CardTitle>
        </CardHeader>
        <CardContent>
          <WeeklyActivityChart data={chartData} platforms={platformsPresent} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet</p>
            ) : (
              recentActivity.map((post, index) => (
                <div
                  key={`${post.published_at}-${index}`}
                  className="flex items-start justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <Badge variant="outline" className="mt-0.5 shrink-0 capitalize">
                      {post.platform}
                    </Badge>
                    <p className="truncate text-sm">
                      {post.body.slice(0, 60)}
                      {post.body.length > 60 ? "…" : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatTimeAgo(post.published_at)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle>This week&apos;s opportunities</CardTitle>
            <Link
              href={`/dashboard/apps/${id}/opportunities`}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              View all
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {topOpportunities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Researching opportunities for your app...
              </p>
            ) : (
              topOpportunities.map((finding) => {
                const { platform, title } = parseForumOpportunity(finding.findings);
                return (
                  <div
                    key={finding.id}
                    className="flex items-start gap-2 border-b pb-3 last:border-b-0 last:pb-0"
                  >
                    <Badge variant="outline" className="mt-0.5 shrink-0">
                      {platform ? OPPORTUNITY_PLATFORM_LABEL[platform] : "Unknown"}
                    </Badge>
                    <p className="truncate text-sm">{title ?? "Untitled opportunity"}</p>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
