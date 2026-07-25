import { logger, runs, schedules } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import type { PendingRunTask } from "@/types";

// Every pipeline task (dna-extraction, strategy-generation,
// content-generation) already sets apps.status = 'error' in its own catch
// block — but that only helps if the task process actually starts. A run
// that's CANCELED (worker killed mid-flight), EXPIRED (TTL reached with no
// worker ever claiming it), CRASHED, or SYSTEM_FAILURE'd never executes
// that catch block at all, so the apps row would otherwise sit in whatever
// in-progress state it was in forever. This checks every app with a
// still-tracked pending_run_id against Trigger.dev's actual run status and
// closes that gap.
const NEVER_RAN_STATUSES = new Set([
  "CANCELED",
  "EXPIRED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "TIMED_OUT",
]);

// FAILED/COMPLETED mean the task's own code already ran to completion (its
// own catch block or success path already set status/error_message and
// cleared these columns) — seeing them here just means that clear didn't
// happen for some reason, so tidy up without touching status.
const ALREADY_HANDLED_STATUSES = new Set(["COMPLETED", "FAILED"]);

const TASK_LABEL: Record<PendingRunTask, string> = {
  "dna-extraction": "DNA extraction",
  "competitor-research": "Competitor research",
  "diagnosis": "Growth diagnosis",
  "strategy-generation": "Strategy generation",
  "content-generation": "Content generation",
  "icp-inference": "ICP inference",
  "outreach-preview": "Outreach preview",
};

export const jobWatchdog = schedules.task({
  id: "job-watchdog",
  cron: { pattern: "*/5 * * * *", timezone: "UTC" },
  run: async () => {
    const { data: apps, error } = await supabaseAdmin
      .from("apps")
      .select("id, workspace_id, pending_run_id, pending_run_task")
      .not("pending_run_id", "is", null)
      .is("deleted_at", null);

    if (error) {
      throw new Error(`Failed to load apps with pending runs: ${error.message}`);
    }

    const candidates = apps ?? [];
    logger.info(`job-watchdog: checking ${candidates.length} pending run(s)`);

    let flagged = 0;
    let cleared = 0;

    for (const app of candidates) {
      const runId = app.pending_run_id;
      if (!runId) continue;

      try {
        const run = await runs.retrieve(runId);

        if (NEVER_RAN_STATUSES.has(run.status)) {
          const task = (app.pending_run_task as PendingRunTask | null) ?? "background job";
          const label = TASK_LABEL[task as PendingRunTask] ?? task;

          const { error: updateError } = await supabaseAdmin
            .from("apps")
            .update({
              status: "error",
              error_message: `${label} did not complete (${run.status}) — it may have been interrupted. Try again.`,
              pending_run_id: null,
              pending_run_task: null,
            })
            .eq("id", app.id)
            .eq("workspace_id", app.workspace_id)
            .eq("pending_run_id", runId);

          if (updateError) {
            logger.error("job-watchdog: failed to flag stuck app", {
              app_id: app.id,
              error: updateError.message,
            });
            continue;
          }

          flagged++;
          logger.warn("job-watchdog: flagged stuck app", {
            app_id: app.id,
            task: app.pending_run_task,
            run_status: run.status,
            run_id: runId,
          });
        } else if (ALREADY_HANDLED_STATUSES.has(run.status)) {
          // Safety net only — the task's own code should have already
          // cleared these on this exact path. Guarded by pending_run_id so
          // this can't clobber a newer run that's since superseded it.
          const { error: updateError } = await supabaseAdmin
            .from("apps")
            .update({ pending_run_id: null, pending_run_task: null })
            .eq("id", app.id)
            .eq("workspace_id", app.workspace_id)
            .eq("pending_run_id", runId);

          if (!updateError) cleared++;
        }
        // Otherwise (QUEUED/DEQUEUED/EXECUTING/WAITING/DELAYED/PENDING_VERSION)
        // — genuinely still in progress, leave it alone.
      } catch (err) {
        // Doesn't flip apps.status — a failed run-status lookup here is a
        // job-watchdog-internal problem, not evidence the tracked pipeline
        // job itself failed. Only used for consistent logging/Sentry
        // reporting, same as every other job's catch block.
        await handleJobError(err, {
          appId: app.id,
          workspaceId: app.workspace_id,
          jobName: "job-watchdog",
          updateAppStatus: false,
        });
      }
    }

    logger.info("job-watchdog: finished", {
      checked: candidates.length,
      flagged,
      cleared,
    });

    return { checked: candidates.length, flagged, cleared };
  },
});
