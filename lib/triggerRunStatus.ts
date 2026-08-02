import "server-only";

// Shared by trigger/job-watchdog.ts (the periodic sweep) and
// lib/pipelineRetry.ts (an on-demand check the moment a founder clicks
// Retry, so recovery doesn't depend on the watchdog's cron actually having
// run — see that file's own comment on why that matters: the watchdog is
// itself a Trigger.dev scheduled task, so an environment with no active
// worker can't run it either, and a run stuck in these statuses would
// otherwise never get flagged).

// A run in one of these statuses never actually executed the task's own
// code — canceled, hit its queue TTL with no worker ever claiming it,
// crashed, or a system failure — so the task's own catch-block error
// handling never got a chance to run.
export const NEVER_RAN_STATUSES = new Set([
  "CANCELED",
  "EXPIRED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "TIMED_OUT",
]);

// FAILED/COMPLETED mean the task's own code already ran to completion (its
// own catch block or success path already updated whatever status/error
// columns it owns) — seeing one of these during a stale-state check just
// means that update didn't stick for some reason, safe to tidy up without
// re-deriving anything.
export const ALREADY_HANDLED_STATUSES = new Set(["COMPLETED", "FAILED"]);
