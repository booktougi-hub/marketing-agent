import { logger, schedules, tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { appRunTag } from "@/lib/jobHealthRegistry";
import type { contentGeneration } from "@/trigger/content-generation";

// PHASES.md Notes Log (2026-07-14): the spec for this redesign referred to
// "the existing content-regeneration-check daily job" — no such job existed
// anywhere in this codebase (grepped trigger/ and found nothing). Built
// fresh here with the target threshold (5) directly, since there was no
// prior "10" value to migrate from.
//
// Runs daily, checks every active/unpaused app's remaining scheduled
// content, and re-triggers content-generation once it drops below the
// threshold — this is what turns content-generation's ~7-8-day batches
// (see trigger/content-generation.ts) into an actual weekly rhythm instead
// of a one-time run.
const REGENERATION_THRESHOLD = 5;

export const contentRegenerationCheck = schedules.task({
  id: "content-regeneration-check",
  cron: { pattern: "0 8 * * *", timezone: "UTC" }, // once daily, 08:00 UTC
  run: async () => {
    try {
      const { data: apps, error } = await supabaseAdmin
        .from("apps")
        .select("id, workspace_id")
        .eq("status", "active")
        .eq("is_paused", false);

      if (error) {
        throw new Error(`Failed to load active apps: ${error.message}`);
      }

      const candidates = apps ?? [];
      logger.info(`content-regeneration-check: checking ${candidates.length} active app(s)`);

      let triggered = 0;
      const nowIso = new Date().toISOString();

      for (const app of candidates) {
        const { count, error: countError } = await supabaseAdmin
          .from("content")
          .select("id", { count: "exact", head: true })
          .eq("app_id", app.id)
          .eq("workspace_id", app.workspace_id)
          .eq("status", "scheduled")
          .gt("scheduled_at", nowIso);

        if (countError) {
          logger.warn(`content-regeneration-check: failed to count remaining posts for app ${app.id}: ${countError.message}`, {
            app_id: app.id,
          });
          continue;
        }

        const remaining = count ?? 0;
        if (remaining >= REGENERATION_THRESHOLD) continue;

        logger.info(`content-regeneration-check: app ${app.id} has ${remaining} scheduled post(s) remaining (< ${REGENERATION_THRESHOLD}), triggering content-generation`, {
          app_id: app.id,
          remaining,
        });

        try {
          const handle = await tasks.trigger<typeof contentGeneration>(
            "content-generation",
            { app_id: app.id, workspace_id: app.workspace_id },
            { tags: [appRunTag(app.id)] }
          );
          await supabaseAdmin
            .from("apps")
            .update({ pending_run_id: handle.id, pending_run_task: "content-generation" })
            .eq("id", app.id)
            .eq("workspace_id", app.workspace_id);
          triggered++;
        } catch (err) {
          logger.error(`content-regeneration-check: failed to trigger content-generation for app ${app.id}`, {
            app_id: app.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.info(`content-regeneration-check: triggered content-generation for ${triggered}/${candidates.length} app(s)`);
      return { checked: candidates.length, triggered };
    } catch (err) {
      await handleJobError(err, { jobName: "content-regeneration-check" });
      throw err;
    }
  },
});
