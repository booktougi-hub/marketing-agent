import { logger, schedules } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";

// Safety net for the per-app 7-day reset check in
// /api/apps/[id]/agent-action — that check only fires the next time an
// app's agent-action route is actually called, so an app that never gets
// manually triggered again could keep a stale count indefinitely. This
// forces every active app's Agent Action Credit pool back in sync every
// Monday regardless of individual usage.
export const weeklyResearchReset = schedules.task({
  id: "weekly-research-reset",
  cron: { pattern: "0 0 * * 1", timezone: "UTC" },
  run: async () => {
    try {
      const { data: updated, error } = await supabaseAdmin
        .from("apps")
        .update({
          agent_credits_used_this_week: 0,
          agent_credits_reset_at: new Date().toISOString(),
        })
        .eq("status", "active")
        .select("id");

      if (error) {
        throw new Error(`Failed to reset agent action credits: ${error.message}`);
      }

      const resetCount = updated?.length ?? 0;
      logger.info(`Reset agent action credits for ${resetCount} apps`);

      return { resetCount };
    } catch (err) {
      await handleJobError(err, { jobName: "weekly-research-reset" });
      throw err;
    }
  },
});
