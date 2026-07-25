import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { runs } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors/AppError";
import {
  JOB_HEALTH_REGISTRY,
  FAILED_RUN_STATUSES,
  appRunTag,
  type JobHealthDefinition,
} from "@/lib/jobHealthRegistry";
import {
  MONTHLY_AUTOMATIONS,
  getNextMonthlyOccurrence,
  getPreviousMonthlyOccurrence,
  getPreviousResearchOccurrence,
} from "@/lib/schedule";
import type { ResearchDay } from "@/types";

export type JobHealthStatus = "ok" | "overdue" | "failed" | "never_run";

export interface JobHealthResult {
  jobName: string;
  label: string;
  status: JobHealthStatus;
  lastRunAt: string | null;
  nextExpectedAt: string | null;
}

// A run still in flight isn't overdue or failed — it's evidence the job is
// actively working, so it counts as "ok".
const IN_PROGRESS_RUN_STATUSES = new Set([
  "PENDING_VERSION",
  "QUEUED",
  "DEQUEUED",
  "EXECUTING",
  "WAITING",
  "DELAYED",
]);

// Grace window added on top of a job's last expected scheduled slot before
// flagging it overdue — cron jobs and queue delays mean "just passed the
// expected time" shouldn't immediately read as broken.
const OCCURRENCE_GRACE_MS = 6 * 60 * 60 * 1000;

async function getLatestRunForApp(jobName: string, appId: string) {
  const page = await runs.list({
    taskIdentifier: jobName,
    tag: appRunTag(appId),
    limit: 5,
  });

  let latest: { status: string; createdAt: Date } | null = null;
  for (const run of page.data) {
    if (!latest || run.createdAt.getTime() > latest.createdAt.getTime()) {
      latest = { status: run.status, createdAt: run.createdAt };
    }
  }
  return latest;
}

function resolveStatusForCompletedRun(
  job: JobHealthDefinition,
  lastRunAt: Date,
  researchDay: ResearchDay,
  researchHour: number,
  now: Date
): { status: JobHealthStatus; nextExpectedAt: Date | null } {
  // Assigned to a local `const` (rather than repeatedly narrowing
  // `job.cadence`) so TypeScript's discriminant narrowing survives into the
  // `.find()` closure below — narrowing a `const` local carries into nested
  // closures, narrowing a property access on a parameter does not.
  const cadence = job.cadence;

  if (cadence.kind === "one_time") {
    return { status: "ok", nextExpectedAt: null };
  }

  if (cadence.kind === "flat_window") {
    const windowMs = cadence.windowDays * 24 * 60 * 60 * 1000;
    const nextExpectedAt = new Date(lastRunAt.getTime() + windowMs);
    return {
      status: now.getTime() > nextExpectedAt.getTime() ? "overdue" : "ok",
      nextExpectedAt,
    };
  }

  if (cadence.kind === "weekly_per_app") {
    const previousOccurrence = getPreviousResearchOccurrence(researchDay, researchHour, now);
    const nextExpectedAt = new Date(previousOccurrence.getTime() + 7 * 24 * 60 * 60 * 1000);
    const overdue =
      lastRunAt.getTime() < previousOccurrence.getTime() &&
      now.getTime() > previousOccurrence.getTime() + OCCURRENCE_GRACE_MS;
    return { status: overdue ? "overdue" : "ok", nextExpectedAt };
  }

  // monthly_fixed
  const automation = MONTHLY_AUTOMATIONS.find((a) => a.id === cadence.automationId);
  if (!automation) {
    return { status: "ok", nextExpectedAt: null };
  }
  const previousOccurrence = getPreviousMonthlyOccurrence(automation, now);
  const nextExpectedAt = getNextMonthlyOccurrence(automation, now);
  const overdue =
    lastRunAt.getTime() < previousOccurrence.getTime() &&
    now.getTime() > previousOccurrence.getTime() + OCCURRENCE_GRACE_MS;
  return { status: overdue ? "overdue" : "ok", nextExpectedAt };
}

async function resolveJobHealth(
  job: JobHealthDefinition,
  appId: string,
  researchDay: ResearchDay,
  researchHour: number,
  now: Date
): Promise<JobHealthResult> {
  const base = { jobName: job.jobName, label: job.label };

  let latest: { status: string; createdAt: Date } | null = null;
  try {
    latest = await getLatestRunForApp(job.jobName, appId);
  } catch {
    // A Trigger.dev lookup failure shouldn't take down the whole panel or
    // claim a status we couldn't actually verify.
    return { ...base, status: "never_run", lastRunAt: null, nextExpectedAt: null };
  }

  if (!latest) {
    return { ...base, status: "never_run", lastRunAt: null, nextExpectedAt: null };
  }

  const lastRunAt = latest.createdAt.toISOString();

  if (FAILED_RUN_STATUSES.has(latest.status)) {
    return { ...base, status: "failed", lastRunAt, nextExpectedAt: null };
  }

  if (IN_PROGRESS_RUN_STATUSES.has(latest.status)) {
    return { ...base, status: "ok", lastRunAt, nextExpectedAt: null };
  }

  const { status, nextExpectedAt } = resolveStatusForCompletedRun(
    job,
    latest.createdAt,
    researchDay,
    researchHour,
    now
  );
  return { ...base, status, lastRunAt, nextExpectedAt: nextExpectedAt?.toISOString() ?? null };
}

export const GET = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
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
          // Route Handlers reading via GET don't need to refresh cookies.
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new UnauthorizedError(ErrorMessages.auth.UNAUTHORIZED);
  }

  const { data: membership } = await supabaseAdmin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  const workspaceId = membership?.workspace_id as string | undefined;

  if (!workspaceId) {
    throw new ForbiddenError(ErrorMessages.auth.NO_WORKSPACE, "NO_WORKSPACE");
  }

  const { data: app } = await supabaseAdmin
    .from("apps")
    .select("id, preferred_research_day, preferred_research_hour")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!app) {
    throw new ForbiddenError(ErrorMessages.apps.NOT_FOUND_IN_WORKSPACE, "FORBIDDEN");
  }

  const researchDay = (app.preferred_research_day ?? "sunday") as ResearchDay;
  const researchHour = app.preferred_research_hour ?? 23;
  const now = new Date();

  const jobs = await Promise.all(
    JOB_HEALTH_REGISTRY.map((job) => resolveJobHealth(job, id, researchDay, researchHour, now))
  );

  const overallStatus = jobs.every((j) => j.status === "ok" || j.status === "never_run")
    ? "all_ok"
    : "attention_needed";

  return NextResponse.json({ jobs, overallStatus });
});
