import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DemoDataBanner } from "@/components/apps/demo-data-banner";
import { GaSessionsChart } from "@/components/apps/ga-sessions-chart";
import {
  DEMO_GA_SUMMARY,
  DEMO_GA_DAILY_SESSIONS,
  DEMO_GA_TOP_PAGES,
  DEMO_GA_TRAFFIC_SOURCES,
} from "@/lib/demoData/googleAnalyticsDemoData";

function DeltaBadge({ pct }: { pct: number }) {
  const positive = pct >= 0;
  const Icon = positive ? ArrowUp : ArrowDown;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-medium"
      style={{ color: positive ? "var(--chart-2)" : "var(--destructive)" }}
    >
      <Icon className="size-3" />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function MetricCard({ label, value, delta }: { label: string; value: string; delta?: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-baseline gap-2">
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
        {delta !== undefined && <DeltaBadge pct={delta} />}
      </CardContent>
    </Card>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// No Google Analytics integration exists yet — needs a "Sign in with
// Google" OAuth flow (GA4 Data API read scope) and a Google Cloud OAuth
// client this project doesn't have (see PHASES.md Notes Log). This is a
// UI/data-shape preview using illustrative numbers, always shown with a
// DemoDataBanner. Swapping to real data later means replacing the
// lib/demoData/googleAnalyticsDemoData.ts imports with a real GA4 API
// response shaped the same way — no component changes needed.
export function AppGoogleAnalyticsView() {
  const summary = DEMO_GA_SUMMARY;

  return (
    <div className="flex flex-col gap-4">
      <DemoDataBanner message="Google Analytics isn't connected yet — showing example data so you can see what your real traffic dashboard will look like." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Users (28 days)" value={summary.users.toLocaleString()} delta={summary.usersDeltaPct} />
        <MetricCard label="Sessions (28 days)" value={summary.sessions.toLocaleString()} delta={summary.sessionsDeltaPct} />
        <MetricCard label="Pageviews (28 days)" value={summary.pageviews.toLocaleString()} />
        <MetricCard label="Avg. engagement time" value={formatDuration(summary.avgEngagementTimeSeconds)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sessions, last 7 days</CardTitle>
        </CardHeader>
        <CardContent>
          <GaSessionsChart data={DEMO_GA_DAILY_SESSIONS} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top pages</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {DEMO_GA_TOP_PAGES.map((page) => (
              <div key={page.path} className="flex items-center justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0">
                <span className="truncate font-mono text-sm">{page.path}</span>
                <div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
                  <span>{page.views.toLocaleString()} views</span>
                  <span>{formatDuration(page.avgEngagementTimeSeconds)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Traffic sources</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {DEMO_GA_TRAFFIC_SOURCES.map((source) => (
              <div key={source.source} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span>{source.source}</span>
                  <span className="text-muted-foreground">{source.sessions.toLocaleString()} sessions</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.round(source.share * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
