import { logger, runs, schedules } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { ALREADY_HANDLED_STATUSES, NEVER_RAN_STATUSES } from "@/lib/triggerRunStatus";
import { AGENT_ACTION_COST, type AgentActionCooldowns, type AgentActionType } from "@/lib/agentCredits";
import type { PendingRunTask } from "@/types";

// brand_info_extraction and dna_reextraction both charge their agent-action
// credit and start that action's cooldown (apps.agent_action_cooldowns)
// BEFORE the job actually runs (see app/api/apps/[id]/agent-action/
// route.ts) — there's no rollback path if the run then never executes.
// Without this, a founder who hits a stuck run (exactly what happened here:
// a run expired with no worker ever claiming it) is left both down a
// credit and cooldown-blocked from retrying for up to 6 hours, on top of
// the run itself having failed through no fault of theirs. Called only
// from the two flagging blocks below, right after they confirm a run
// genuinely never ran. Clears only this specific actionType's cooldown
// entry (per-action-type as of 2026-07-29) — no risk of clobbering an
// unrelated action's cooldown the way a single shared timestamp could.
async function refundAgentActionCredit(appId: string, workspaceId: string, actionType: AgentActionType) {
  const { data: app } = await supabaseAdmin
    .from("apps")
    .select("agent_credits_used_this_week, agent_action_cooldowns")
    .eq("id", appId)
    .eq("workspace_id", workspaceId)
    .single();

  if (!app) return;

  const refunded = Math.max(0, (app.agent_credits_used_this_week ?? 0) - AGENT_ACTION_COST[actionType]);
  const cooldowns = { ...((app.agent_action_cooldowns ?? {}) as AgentActionCooldowns) };
  delete cooldowns[actionType];

  await supabaseAdmin
    .from("apps")
    .update({ agent_credits_used_this_week: refunded, agent_action_cooldowns: cooldowns })
    .eq("id", appId)
    .eq("workspace_id", workspaceId);
}

// Every pipeline task (dna-extraction, strategy-generation,
// content-generation) already sets apps.status = 'error' in its own catch
// block — but that only helps if the task process actually starts. A run
// that's CANCELED (worker killed mid-flight), EXPIRED (TTL reached with no
// worker ever claiming it), CRASHED, or SYSTEM_FAILURE'd never executes
// that catch block at all, so the apps row would otherwise sit in whatever
// in-progress state it was in forever. This checks every app with a
// still-tracked pending_run_id against Trigger.dev's actual run status and
// closes that gap. A second, parallel scan further down does the exact same
// thing for brand_information.pending_run_id — brand-info-extraction is a
// side/enrichment job that was never covered here even though it's exactly
// as exposed to this failure mode (see that scan's own comment).
//
// IMPORTANT caveat this whole file is exposed to: this is itself a
// Trigger.dev scheduled task, so it only ever runs if a worker is actually
// online to execute cron ticks. In an environment with no active worker
// (dev server stopped, nothing deployed), this sweep never runs at all —
// which is exactly what let a real dna-reextraction run sit at
// dna_reextraction_status: 'processing' with an already-EXPIRED run behind
// it, indefinitely, in production data. lib/pipelineRetry.ts's retry path
// now does its own on-demand version of this same check so a founder
// clicking Retry isn't dependent on this cron having run — this sweep is a
// backstop for stuck states nobody happens to click retry on, not the only
// line of defense anymore.
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

    // Same gap, different table: brand-info-extraction is a side/enrichment
    // job (see its own header comment), not one of the three pipeline jobs
    // apps.pending_run_id already covers, so it tracks its own in-flight run
    // on brand_information.pending_run_id instead. A run that expires/
    // crashes/gets canceled before that job's own catch block runs would
    // otherwise leave extraction_status stuck at "processing" forever, with
    // the Brand Information page spinning indefinitely and no way for the
    // founder to retry (both the first-analyze and re-analyze routes refuse
    // to start a second run while extraction_status === "processing").
    const { data: brandRows, error: brandError } = await supabaseAdmin
      .from("brand_information")
      .select("id, app_id, workspace_id, pending_run_id")
      .not("pending_run_id", "is", null);

    if (brandError) {
      throw new Error(`Failed to load brand_information rows with a pending run: ${brandError.message}`);
    }

    const brandCandidates = brandRows ?? [];
    logger.info(`job-watchdog: checking ${brandCandidates.length} pending brand-info-extraction run(s)`);

    let brandFlagged = 0;
    let brandCleared = 0;

    for (const row of brandCandidates) {
      const runId = row.pending_run_id;
      if (!runId) continue;

      try {
        const run = await runs.retrieve(runId);

        if (NEVER_RAN_STATUSES.has(run.status)) {
          const { error: updateError } = await supabaseAdmin
            .from("brand_information")
            .update({
              extraction_status: "error",
              extraction_error: `Brand analysis did not complete (${run.status}) — it may have been interrupted. Try again.`,
              pending_run_id: null,
            })
            .eq("id", row.id)
            .eq("workspace_id", row.workspace_id)
            .eq("pending_run_id", runId);

          if (updateError) {
            logger.error("job-watchdog: failed to flag stuck brand_information row", {
              app_id: row.app_id,
              error: updateError.message,
            });
            continue;
          }

          await refundAgentActionCredit(row.app_id, row.workspace_id, "brand_info_extraction");

          brandFlagged++;
          logger.warn("job-watchdog: flagged stuck brand_information row", {
            app_id: row.app_id,
            run_status: run.status,
            run_id: runId,
          });
        } else if (ALREADY_HANDLED_STATUSES.has(run.status)) {
          // Safety net only, same reasoning as the apps loop above.
          const { error: updateError } = await supabaseAdmin
            .from("brand_information")
            .update({ pending_run_id: null })
            .eq("id", row.id)
            .eq("workspace_id", row.workspace_id)
            .eq("pending_run_id", runId);

          if (!updateError) brandCleared++;
        }
      } catch (err) {
        await handleJobError(err, {
          appId: row.app_id,
          workspaceId: row.workspace_id,
          jobName: "job-watchdog",
          updateAppStatus: false,
        });
      }
    }

    logger.info("job-watchdog: finished (brand_information)", {
      checked: brandCandidates.length,
      flagged: brandFlagged,
      cleared: brandCleared,
    });

    // Same gap, third table/column pair: trigger/dna-reextraction.ts is the
    // narrow, non-pipeline "Re-analyze" on the Product Information page —
    // like brand-info-extraction, it tracks its own in-flight run on
    // apps.dna_reextraction_pending_run_id instead of apps.pending_run_id,
    // since it must never interfere with a real pipeline run's tracking on
    // that column. A run that expires/crashes/gets canceled before that
    // job's own catch block runs would otherwise leave
    // dna_reextraction_status stuck at "processing" forever, with the
    // Product Information page spinning indefinitely and the agent-action
    // route refusing to start a second run.
    const { data: dnaReextractionRows, error: dnaReextractionError } = await supabaseAdmin
      .from("apps")
      .select("id, workspace_id, dna_reextraction_pending_run_id")
      .not("dna_reextraction_pending_run_id", "is", null)
      .is("deleted_at", null);

    if (dnaReextractionError) {
      throw new Error(
        `Failed to load apps with a pending dna-reextraction run: ${dnaReextractionError.message}`
      );
    }

    const dnaReextractionCandidates = dnaReextractionRows ?? [];
    logger.info(`job-watchdog: checking ${dnaReextractionCandidates.length} pending dna-reextraction run(s)`);

    let dnaReextractionFlagged = 0;
    let dnaReextractionCleared = 0;

    for (const row of dnaReextractionCandidates) {
      const runId = row.dna_reextraction_pending_run_id;
      if (!runId) continue;

      try {
        const run = await runs.retrieve(runId);

        if (NEVER_RAN_STATUSES.has(run.status)) {
          const { error: updateError } = await supabaseAdmin
            .from("apps")
            .update({
              dna_reextraction_status: "error",
              dna_reextraction_error: `Product information analysis did not complete (${run.status}) — it may have been interrupted. Try again.`,
              dna_reextraction_pending_run_id: null,
            })
            .eq("id", row.id)
            .eq("workspace_id", row.workspace_id)
            .eq("dna_reextraction_pending_run_id", runId);

          if (updateError) {
            logger.error("job-watchdog: failed to flag stuck dna-reextraction app", {
              app_id: row.id,
              error: updateError.message,
            });
            continue;
          }

          await refundAgentActionCredit(row.id, row.workspace_id, "dna_reextraction");

          dnaReextractionFlagged++;
          logger.warn("job-watchdog: flagged stuck dna-reextraction app", {
            app_id: row.id,
            run_status: run.status,
            run_id: runId,
          });
        } else if (ALREADY_HANDLED_STATUSES.has(run.status)) {
          const { error: updateError } = await supabaseAdmin
            .from("apps")
            .update({ dna_reextraction_pending_run_id: null })
            .eq("id", row.id)
            .eq("workspace_id", row.workspace_id)
            .eq("dna_reextraction_pending_run_id", runId);

          if (!updateError) dnaReextractionCleared++;
        }
      } catch (err) {
        await handleJobError(err, {
          appId: row.id,
          workspaceId: row.workspace_id,
          jobName: "job-watchdog",
          updateAppStatus: false,
        });
      }
    }

    logger.info("job-watchdog: finished (dna-reextraction)", {
      checked: dnaReextractionCandidates.length,
      flagged: dnaReextractionFlagged,
      cleared: dnaReextractionCleared,
    });

    // Same gap, fourth table/column pair: trigger/competitor-profile-
    // research.ts is the narrow, on-demand "Research Competitors" action on
    // Product Information's Competitor Information section — tracks its own
    // in-flight run on apps.competitor_profile_pending_run_id, same reasons
    // as dna-reextraction above.
    const { data: competitorProfileRows, error: competitorProfileError } = await supabaseAdmin
      .from("apps")
      .select("id, workspace_id, competitor_profile_pending_run_id")
      .not("competitor_profile_pending_run_id", "is", null)
      .is("deleted_at", null);

    if (competitorProfileError) {
      throw new Error(
        `Failed to load apps with a pending competitor-profile-research run: ${competitorProfileError.message}`
      );
    }

    const competitorProfileCandidates = competitorProfileRows ?? [];
    logger.info(
      `job-watchdog: checking ${competitorProfileCandidates.length} pending competitor-profile-research run(s)`
    );

    let competitorProfileFlagged = 0;
    let competitorProfileCleared = 0;

    for (const row of competitorProfileCandidates) {
      const runId = row.competitor_profile_pending_run_id;
      if (!runId) continue;

      try {
        const run = await runs.retrieve(runId);

        if (NEVER_RAN_STATUSES.has(run.status)) {
          const { error: updateError } = await supabaseAdmin
            .from("apps")
            .update({
              competitor_profile_status: "error",
              competitor_profile_error: `Competitor research did not complete (${run.status}) — it may have been interrupted. Try again.`,
              competitor_profile_pending_run_id: null,
            })
            .eq("id", row.id)
            .eq("workspace_id", row.workspace_id)
            .eq("competitor_profile_pending_run_id", runId);

          if (updateError) {
            logger.error("job-watchdog: failed to flag stuck competitor-profile-research app", {
              app_id: row.id,
              error: updateError.message,
            });
            continue;
          }

          await refundAgentActionCredit(row.id, row.workspace_id, "competitor_profile_research");

          competitorProfileFlagged++;
          logger.warn("job-watchdog: flagged stuck competitor-profile-research app", {
            app_id: row.id,
            run_status: run.status,
            run_id: runId,
          });
        } else if (ALREADY_HANDLED_STATUSES.has(run.status)) {
          const { error: updateError } = await supabaseAdmin
            .from("apps")
            .update({ competitor_profile_pending_run_id: null })
            .eq("id", row.id)
            .eq("workspace_id", row.workspace_id)
            .eq("competitor_profile_pending_run_id", runId);

          if (!updateError) competitorProfileCleared++;
        }
      } catch (err) {
        await handleJobError(err, {
          appId: row.id,
          workspaceId: row.workspace_id,
          jobName: "job-watchdog",
          updateAppStatus: false,
        });
      }
    }

    logger.info("job-watchdog: finished (competitor-profile-research)", {
      checked: competitorProfileCandidates.length,
      flagged: competitorProfileFlagged,
      cleared: competitorProfileCleared,
    });

    return {
      checked: candidates.length,
      flagged,
      cleared,
      brandInfoChecked: brandCandidates.length,
      brandInfoFlagged: brandFlagged,
      brandInfoCleared: brandCleared,
      dnaReextractionChecked: dnaReextractionCandidates.length,
      dnaReextractionFlagged,
      dnaReextractionCleared,
      competitorProfileChecked: competitorProfileCandidates.length,
      competitorProfileFlagged,
      competitorProfileCleared,
    };
  },
});
