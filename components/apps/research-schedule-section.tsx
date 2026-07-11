"use client";

import { useEffect, useState } from "react";
import { Clock, Mail, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getNextMonthlyOccurrence,
  getNextWeeklyOccurrence,
  MONTHLY_AUTOMATIONS,
  WEEKLY_AUTOMATIONS,
} from "@/lib/schedule";
import { PLATFORM_LABEL } from "@/lib/platform";
import type { AppStatus, ContentPlatform } from "@/types";

function formatUTC(date: Date) {
  return (
    date.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}

function AutomationRow({
  icon: Icon,
  label,
  description,
  nextRun,
  paused,
}: {
  icon: typeof Clock;
  label: string;
  description: string;
  nextRun: Date;
  paused?: string;
}) {
  const [localTime, setLocalTime] = useState<string | null>(null);

  // Deferred to a client-only effect so the server-rendered markup (which
  // has no reliable notion of the visitor's timezone) never mismatches the
  // client's first paint — same guard used by ThemeToggle for the same reason.
  useEffect(() => {
    setLocalTime(
      nextRun.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    );
  }, [nextRun]);

  return (
    <div className="flex items-start gap-3 border-b py-4 last:border-b-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
        {paused ? (
          <Badge variant="outline" className="mt-1 w-fit">
            {paused}
          </Badge>
        ) : (
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Next run: {formatUTC(nextRun)}
            {localTime && <> ({localTime} your time)</>}
          </p>
        )}
      </div>
    </div>
  );
}

export function ResearchScheduleSection({
  appStatus,
  nextScheduledContent,
}: {
  appStatus: AppStatus;
  nextScheduledContent: { scheduledAt: string; platform: ContentPlatform } | null;
}) {
  const isActive = appStatus === "active";
  const scan = WEEKLY_AUTOMATIONS.find((a) => a.id === "weekly-research-scan")!;
  const reset = WEEKLY_AUTOMATIONS.find((a) => a.id === "weekly-research-reset")!;
  const competitorScan = MONTHLY_AUTOMATIONS.find((a) => a.id === "monthly-competitor-scan")!;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Research Schedule</CardTitle>
        <CardDescription>
          When the research agent and content pipeline next update automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        <AutomationRow
          icon={Search}
          label="Research & Opportunities Scan"
          description="Refreshes Topic Research, Problem Discovery, Opportunities, and Competitor Gap findings."
          nextRun={getNextWeeklyOccurrence(scan)}
          paused={!isActive ? "Paused until this app is Active" : undefined}
        />
        <AutomationRow
          icon={RefreshCw}
          label='"Run Research Now" allowance reset'
          description="Your weekly manual-run allowance resets automatically."
          nextRun={getNextWeeklyOccurrence(reset)}
        />
        <AutomationRow
          icon={Search}
          label={competitorScan.label}
          description={competitorScan.description}
          nextRun={getNextMonthlyOccurrence(competitorScan)}
          paused={!isActive ? "Paused until this app is Active" : undefined}
        />
        <div className="flex items-start gap-3 border-b py-4 last:border-b-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Clock className="h-4 w-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-sm font-medium">Next content publish</p>
            <p className="text-sm text-muted-foreground">
              The next scheduled post from your content calendar.
            </p>
            {nextScheduledContent ? (
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {PLATFORM_LABEL[nextScheduledContent.platform]} —{" "}
                {formatUTC(new Date(nextScheduledContent.scheduledAt))}
              </p>
            ) : (
              <Badge variant="outline" className="mt-1 w-fit">
                No posts currently scheduled
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-start gap-3 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Mail className="h-4 w-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-sm font-medium">Outreach</p>
            <p className="text-sm text-muted-foreground">
              Cold email prospects aren&apos;t sent automatically yet — review and send
              them manually from the Outreach tab.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
