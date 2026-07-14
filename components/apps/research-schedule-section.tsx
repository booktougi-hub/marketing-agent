"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, Loader2, Mail, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { parseApiError } from "@/lib/errors/parseApiError";
import {
  getNextMonthlyOccurrence,
  getNextResearchOccurrence,
  MONTHLY_AUTOMATIONS,
  researchDayHourLocalToUtc,
  researchDayHourUtcToLocal,
} from "@/lib/schedule";
import {
  AGENT_ACTION_COST,
  AGENT_ACTION_LABEL,
  getRemainingCredits,
  UNLIMITED_AGENT_CREDIT_PLANS,
} from "@/lib/agentCredits";
import { PLATFORM_LABEL } from "@/lib/platform";
import { RESEARCH_DAYS } from "@/types";
import type { AppStatus, ContentPlatform, PlanTier, ResearchDay } from "@/types";

const DAY_LABEL: Record<ResearchDay, string> = {
  sunday: "Sunday",
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
};

const DAY_OPTIONS = RESEARCH_DAYS.map((day) => ({ value: day, label: DAY_LABEL[day] }));

function hourLabel(hour: number) {
  if (hour === 0) return "12:00 AM";
  if (hour < 12) return `${hour}:00 AM`;
  if (hour === 12) return "12:00 PM";
  return `${hour - 12}:00 PM`;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: hourLabel(hour),
}));

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
  appId,
  appStatus,
  nextScheduledContent,
  planTier,
  agentCreditsUsedThisWeek,
  agentCreditsResetAt,
  initialPreferredResearchDay,
  initialPreferredResearchHour,
}: {
  appId: string;
  appStatus: AppStatus;
  nextScheduledContent: { scheduledAt: string; platform: ContentPlatform } | null;
  planTier: PlanTier;
  agentCreditsUsedThisWeek: number;
  agentCreditsResetAt: string | null;
  initialPreferredResearchDay: ResearchDay;
  initialPreferredResearchHour: number;
}) {
  const router = useRouter();
  const isActive = appStatus === "active";
  const competitorScan = MONTHLY_AUTOMATIONS.find((a) => a.id === "monthly-competitor-scan")!;

  // The day/hour selectors edit in the visitor's own local time but the
  // columns are stored in UTC — converted once on mount (client-only, since
  // the conversion depends on the browser's timezone and would otherwise
  // mismatch the server-rendered markup) rather than on every render.
  const [localDay, setLocalDay] = useState<ResearchDay | null>(null);
  const [localHour, setLocalHour] = useState<number | null>(null);

  useEffect(() => {
    const local = researchDayHourUtcToLocal(initialPreferredResearchDay, initialPreferredResearchHour);
    setLocalDay(local.day);
    setLocalHour(local.hour);
  }, [initialPreferredResearchDay, initialPreferredResearchHour]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  async function handleSaveTiming() {
    if (localDay === null || localHour === null) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const utc = researchDayHourLocalToUtc(localDay, localHour);
      const res = await fetch(`/api/apps/${appId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferred_research_day: utc.day,
          preferred_research_hour: utc.hour,
        }),
      });
      if (!res.ok) {
        const { message } = await parseApiError(res);
        setSaveError(message);
        return;
      }
      setSaveSuccess(true);
      toast.success("Research timing updated");
      router.refresh();
    } catch {
      setSaveError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  const creditFields = {
    agent_credits_used_this_week: agentCreditsUsedThisWeek,
    agent_credits_reset_at: agentCreditsResetAt,
  };
  const { remaining, allowance, resetsAt } = getRemainingCredits(creditFields, planTier);
  const isUnlimited = UNLIMITED_AGENT_CREDIT_PLANS.has(planTier);

  const nextWeeklyResearchRun = getNextResearchOccurrence(
    initialPreferredResearchDay,
    initialPreferredResearchHour
  );

  return (
    <div className="flex flex-col gap-6">
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
            description="Refreshes Topic Research, Problem Discovery, and Opportunities findings."
            nextRun={nextWeeklyResearchRun}
            paused={!isActive ? "Paused until this app is Active" : undefined}
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

      <Card>
        <CardHeader>
          <CardTitle>Weekly Research Timing</CardTitle>
          <CardDescription>
            Which day and hour the weekly Research &amp; Opportunities Scan runs for this app.
            The weekly cadence itself is fixed — only the day and hour are configurable.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="research-day">Day</Label>
              <Select
                items={DAY_OPTIONS}
                value={localDay}
                onValueChange={(value) => setLocalDay(value)}
              >
                <SelectTrigger id="research-day" className="w-full">
                  <SelectValue placeholder="Loading…" />
                </SelectTrigger>
                <SelectContent>
                  {DAY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="research-hour">Hour (your time)</Label>
              <Select
                items={HOUR_OPTIONS}
                value={localHour}
                onValueChange={(value) => setLocalHour(value)}
              >
                <SelectTrigger id="research-hour" className="w-full">
                  <SelectValue placeholder="Loading…" />
                </SelectTrigger>
                <SelectContent>
                  {HOUR_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {saveError && <ErrorMessage message={saveError} />}
          {saveSuccess && <p className="text-sm text-muted-foreground">Saved.</p>}

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleSaveTiming}
              disabled={saving || localDay === null || localHour === null}
            >
              {saving && <Loader2 className="animate-spin" />}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent Action Credits</CardTitle>
          <CardDescription>
            Manual runs of the research agent outside its automatic schedule, shared across all
            action types.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm font-medium">
              {isUnlimited
                ? "Unlimited agent credits this week"
                : `${remaining} of ${allowance} agent credits remaining this week`}
            </p>
          </div>
          <div className="flex flex-col gap-1.5 rounded-md border p-3 text-sm text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>{AGENT_ACTION_LABEL.topic_and_problem_research}</span>
              <span className="font-mono text-xs">
                {AGENT_ACTION_COST.topic_and_problem_research} credit
                {AGENT_ACTION_COST.topic_and_problem_research === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>{AGENT_ACTION_LABEL.forum_opportunity_scan}</span>
              <span className="font-mono text-xs">
                {AGENT_ACTION_COST.forum_opportunity_scan} credit
                {AGENT_ACTION_COST.forum_opportunity_scan === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>{AGENT_ACTION_LABEL.competitor_gap_analysis}</span>
              <span className="font-mono text-xs">
                {AGENT_ACTION_COST.competitor_gap_analysis} credit
                {AGENT_ACTION_COST.competitor_gap_analysis === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            Resets: {formatUTC(resetsAt)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
