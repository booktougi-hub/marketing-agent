"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/time";

type JobHealthStatus = "ok" | "overdue" | "failed" | "never_run";

interface JobHealthResult {
  jobName: string;
  label: string;
  status: JobHealthStatus;
  lastRunAt: string | null;
  nextExpectedAt: string | null;
}

interface HealthResponse {
  jobs: JobHealthResult[];
  overallStatus: "all_ok" | "attention_needed";
}

// Same color-mix-over-CSS-var badge pattern as AuditFindingCard's severity
// badges (components/apps/audit-finding-card.tsx), so status colors read
// consistently with the rest of the app rather than introducing a second
// palette.
const STATUS_COLOR_VAR: Record<JobHealthStatus, string> = {
  ok: "var(--chart-2)",
  overdue: "var(--chart-3)",
  failed: "var(--destructive)",
  never_run: "var(--muted-foreground)",
};

// A filled dot for anything that has run at least once, a hollow ring for
// never_run — mirrors the filled/dashed-outline distinction used elsewhere
// for "real" vs. "not yet" state (e.g. PlatformChannelIdentity vs.
// PlatformInfluencerCandidateCard's avatar treatments).
function StatusDot({ status }: { status: JobHealthStatus }) {
  const color = STATUS_COLOR_VAR[status];
  if (status === "never_run") {
    return <span className="size-2.5 shrink-0 rounded-full border-2" style={{ borderColor: color }} />;
  }
  return <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

function statusRowText(job: JobHealthResult): string {
  if (job.status === "never_run") return "Never run yet";
  if (job.status === "failed") return "Failed";
  if (job.lastRunAt) return `Last run: ${formatTimeAgo(job.lastRunAt)}`;
  return "Never run yet";
}

function chunkPairs<T>(items: T[]): T[][] {
  const pairs: T[][] = [];
  for (let i = 0; i < items.length; i += 2) pairs.push(items.slice(i, i + 2));
  return pairs;
}

export function AppSystemHealthCard({ appId }: { appId: string }) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [userToggled, setUserToggled] = useState(false);
  const [retryingJob, setRetryingJob] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function loadHealth() {
    try {
      const res = await fetch(`/api/apps/${appId}/health`);
      if (!res.ok) throw new Error("Failed to load system health");
      const json = (await res.json()) as HealthResponse;
      setData(json);
      setError(null);
      // Auto-expand when something needs attention, but never fight a
      // manual toggle the founder already made this session.
      if (!userToggled) setExpanded(json.overallStatus === "attention_needed");
    } catch {
      setError("Could not load system health.");
    }
  }

  useEffect(() => {
    loadHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  async function handleRetry(jobName: string) {
    setRetryingJob(jobName);
    setRetryError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/retry-job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobName }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setRetryError(json?.error ?? "Failed to retry.");
        return;
      }
      // The retried run typically shows up as "in progress" (counted as
      // "ok") within a second or two of triggering — re-fetch once, shortly
      // after, so the row updates without the founder needing to reload.
      await loadHealth();
    } catch {
      setRetryError("Failed to retry.");
    } finally {
      setRetryingJob(null);
    }
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">{error}</CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking system health…
        </CardContent>
      </Card>
    );
  }

  const isAllOk = data.overallStatus === "all_ok";
  const badgeColor = STATUS_COLOR_VAR[isAllOk ? "ok" : "overdue"];

  return (
    <Card>
      <CardHeader
        className="flex flex-row items-center justify-between gap-2 space-y-0 cursor-pointer select-none"
        onClick={() => {
          setUserToggled(true);
          setExpanded((v) => !v);
        }}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight">System Health</span>
          <Badge
            variant="outline"
            className="gap-1 text-[10px] font-semibold tracking-wider uppercase"
            style={{
              borderColor: badgeColor,
              color: badgeColor,
              backgroundColor: `color-mix(in oklch, ${badgeColor} 8%, transparent)`,
            }}
          >
            {isAllOk ? "All systems OK" : "Needs attention"}
          </Badge>
        </div>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </CardHeader>

      {expanded && (
        <CardContent className="flex flex-col pt-0">
          {chunkPairs(data.jobs).map((pair, rowIndex) => (
            <div key={pair[0].jobName} className={cn(rowIndex > 0 && "border-t")}>
              <div className="flex flex-col divide-y sm:flex-row sm:divide-x sm:divide-y-0">
                {pair.map((job) => (
                  <div
                    key={job.jobName}
                    className="flex flex-1 flex-col gap-1.5 py-3.5 sm:px-6 first:sm:pl-0 last:sm:pr-0"
                  >
                    <div className="flex items-center gap-2.5">
                      <StatusDot status={job.status} />
                      <span className="text-sm font-semibold">{job.label}</span>
                    </div>
                    <span
                      className={cn(
                        "pl-5 font-mono text-[11px] tracking-wide text-muted-foreground uppercase",
                        job.status === "never_run" && "italic"
                      )}
                    >
                      {statusRowText(job)}
                    </span>
                    {job.status === "failed" && (
                      <div className="pl-5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={retryingJob !== null}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRetry(job.jobName);
                          }}
                        >
                          {retryingJob === job.jobName && <Loader2 className="animate-spin" />}
                          Retry
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {retryError && <p className="pt-2 text-xs text-destructive">{retryError}</p>}
        </CardContent>
      )}
    </Card>
  );
}
