// Fixed list of jobs shown on the per-app System Health panel
// (components/apps/app-system-health-card.tsx, read by
// app/api/apps/[id]/health/route.ts). Every jobName below is a real
// Trigger.dev task id confirmed against trigger/index.ts and the task
// definitions themselves — never guessed.
//
// Excluded from this registry (checked against trigger/ and found not to
// exist as real, working tasks):
// - "publisher" — PHASES.md Week 4 Day 3 spec's cron publisher job was
//   never built. There is no trigger/publisher.ts; the only trace of it is
//   a comment in trigger/content-generation.ts noting "No publisher job
//   auto-publishes any platform yet." Including it here would show a
//   permanently "never_run" row for a job that can't run, which is
//   misleading rather than informative.
// - "forum-opportunity-scan" — this exists, just under a different real
//   name: trigger/forum-opportunity-finder.ts (task id
//   "forum-opportunity-finder"). Included below under its real id.

import "server-only";
import { runs } from "@trigger.dev/sdk";
import type { ResearchDay } from "@/types";

export const APP_RUN_TAG_PREFIX = "app_";

// Every call site that triggers one of this registry's jobs must tag the
// run with this so the health API can filter Trigger.dev's run history by
// app_id — the runs.list API can filter by `tag` and `taskIdentifier` but
// has no way to filter by payload contents.
export function appRunTag(appId: string): string {
  return `${APP_RUN_TAG_PREFIX}${appId}`;
}

// Terminal-but-not-successful run statuses — treated as "failed" regardless
// of which specific way the run didn't complete (crashed, timed out,
// canceled, never claimed before its TTL, ...). Mirrors
// trigger/job-watchdog.ts's NEVER_RAN_STATUSES + explicit FAILED. Shared by
// app/api/apps/[id]/health/route.ts (to render a job's status) and
// app/api/apps/[id]/retry-job/route.ts (to confirm there's actually
// something to retry before spending a real trigger call on it).
export const FAILED_RUN_STATUSES = new Set([
  "FAILED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "TIMED_OUT",
  "CANCELED",
  "EXPIRED",
]);

// Whether the most recent run of `jobName` for this app is currently in a
// failed state — used to gate the free "Retry" action on the System Health
// panel so it can't be used to bypass the agent-action credit system for an
// arbitrary re-run of a job that hasn't actually failed.
export async function isJobCurrentlyFailed(jobName: string, appId: string): Promise<boolean> {
  try {
    const page = await runs.list({ taskIdentifier: jobName, tag: appRunTag(appId), limit: 5 });
    let latest: { status: string; createdAt: Date } | null = null;
    for (const run of page.data) {
      if (!latest || run.createdAt.getTime() > latest.createdAt.getTime()) {
        latest = { status: run.status, createdAt: run.createdAt };
      }
    }
    return !!latest && FAILED_RUN_STATUSES.has(latest.status);
  } catch {
    return false;
  }
}

export type JobHealthCadence =
  // No fixed schedule of its own — content-generation is re-triggered by
  // trigger/content-regeneration-check.ts's daily threshold check, which
  // keeps it to a "~7-8 day batches" rhythm per that file's own comment.
  // Overdue is judged against a flat window from the last run instead of an
  // exact occurrence.
  | { kind: "flat_window"; label: string; windowDays: number }
  // Runs once per week at this specific app's own
  // preferred_research_day/preferred_research_hour (trigger/weekly-research-scan.ts).
  | { kind: "weekly_per_app"; label: string }
  // Runs on a fixed UTC day-of-month/hour for every active app — see the
  // matching entry in lib/schedule.ts's MONTHLY_AUTOMATIONS.
  | { kind: "monthly_fixed"; label: string; automationId: string }
  // Only ever triggered once per app (as part of the diagnosis-first
  // onboarding pipeline) — no cadence to be overdue against.
  | { kind: "one_time"; label: string };

export interface JobHealthDefinition {
  jobName: string;
  label: string;
  cadence: JobHealthCadence;
}

export const JOB_HEALTH_REGISTRY: JobHealthDefinition[] = [
  {
    jobName: "content-generation",
    label: "Content generation",
    cadence: { kind: "flat_window", label: "Weekly", windowDays: 9 },
  },
  {
    jobName: "topic-research",
    label: "Topic research",
    cadence: { kind: "weekly_per_app", label: "Weekly" },
  },
  {
    jobName: "problem-discovery",
    label: "Problem discovery",
    cadence: { kind: "weekly_per_app", label: "Weekly" },
  },
  {
    jobName: "forum-opportunity-finder",
    label: "Opportunity scan",
    cadence: { kind: "weekly_per_app", label: "Weekly" },
  },
  {
    jobName: "competitor-gap-analysis",
    label: "Competitor analysis",
    cadence: { kind: "monthly_fixed", label: "Monthly", automationId: "monthly-competitor-scan" },
  },
  {
    jobName: "onboarding-audit",
    label: "Onboarding audit",
    cadence: { kind: "monthly_fixed", label: "Monthly", automationId: "monthly-onboarding-scan" },
  },
  {
    jobName: "churn-audit",
    label: "Retention audit",
    cadence: { kind: "monthly_fixed", label: "Monthly", automationId: "monthly-churn-scan" },
  },
  {
    jobName: "cro-audit",
    label: "Conversion audit",
    cadence: { kind: "monthly_fixed", label: "Monthly", automationId: "monthly-cro-scan" },
  },
  {
    jobName: "pricing-audit",
    label: "Pricing audit",
    cadence: { kind: "monthly_fixed", label: "Monthly", automationId: "monthly-pricing-scan" },
  },
  {
    jobName: "diagnosis",
    label: "Strategy diagnosis",
    cadence: { kind: "one_time", label: "One-time" },
  },
  {
    // Fixed weekly cron for every active app (trigger/weekly-seo-scan.ts,
    // every Sunday), not tied to a per-app preferred day/hour the way the
    // research streams are — flat_window, same treatment as
    // content-generation above.
    jobName: "seo-geo-audit",
    label: "SEO audit",
    cadence: { kind: "flat_window", label: "Weekly", windowDays: 9 },
  },
];

export interface JobHealthApp {
  preferred_research_day: ResearchDay;
  preferred_research_hour: number;
}
