import { logger, schedules } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";

// Safety net for the per-app 7-day reset check in
// /api/apps/[id]/research/trigger — that check only fires the next time an
// app's manual research trigger is actually called, so an app that never
// gets manually triggered again could keep a stale count indefinitely.
// This forces every active app back in sync every Monday regardless of
// individual usage.
export const weeklyResearchReset = schedules.task({
  id: "weekly-research-reset",
  cron: { pattern: "0 0 * * 1", timezone: "UTC" },
  run: async () => {
    try {
      const { data: updated, error } = await supabaseAdmin
        .from("apps")
        .update({
          manual_research_count_this_week: 0,
          manual_research_reset_at: new Date().toISOString(),
        })
        .eq("status", "active")
        .select("id");

      if (error) {
        throw new Error(`Failed to reset manual research counts: ${error.message}`);
      }

      const resetCount = updated?.length ?? 0;
      logger.info(`Reset manual research counts for ${resetCount} apps`);

      return { resetCount };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "weekly-research-reset failed unexpectedly.";
      logger.error("weekly-research-reset failed", { error: message });
      throw err;
    }
  },
});
