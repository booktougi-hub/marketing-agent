"use client";

import { useEffect, useState } from "react";

// How long a "waiting on a background job" spinner is shown at face value
// before we assume something went wrong and offer a way out. Real jobs
// finish well under this in the normal case; long enough to not flash for
// legitimately slow (but healthy) runs, short enough that a genuinely stuck
// state — the run's worker never claimed it, the safety-net cron that
// would otherwise flag it hasn't run either — doesn't leave the founder
// staring at an indefinite spinner with no escape. See
// lib/pipelineRetry.ts and trigger/job-watchdog.ts for the real incident
// this was built in response to: a run that expired before any worker ever
// claimed it, in production data, with the founder unable to do anything
// but wait.
const DEFAULT_STALE_MS = 90_000;

// True once `ms` have elapsed since this hook first mounted — resets only
// on remount, not on re-render, so it measures "how long has the user
// actually been looking at this spinner," not wall-clock since some
// server-recorded start time (most of these processing states don't track
// one).
export function useIsStale(ms: number = DEFAULT_STALE_MS): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStale(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return stale;
}
