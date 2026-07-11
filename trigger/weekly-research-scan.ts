import { logger, schedules, tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";

// This is the "next automatic scan runs Sunday night" the Research and
// Opportunities empty states already promise. Runs the three weekly research
// jobs for every active app, independent of the first-approval kickoff and
// any manual triggers. Competitor Gap Analysis runs separately, monthly —
// see trigger/monthly-competitor-scan.ts.
export const weeklyResearchScan = schedules.task({
  id: "weekly-research-scan",
  cron: { pattern: "0 23 * * 0", timezone: "UTC" }, // Sunday 11pm UTC
  run: async () => {
    try {
      const { data: apps, error } = await supabaseAdmin
        .from("apps")
        .select("id, workspace_id")
        .eq("status", "active");

      if (error) {
        throw new Error(`Failed to load active apps: ${error.message}`);
      }

      const activeApps = apps ?? [];
      logger.info(`weekly-research-scan: scanning ${activeApps.length} apps`);

      for (const app of activeApps) {
        const dated = { app_id: app.id, workspace_id: app.workspace_id };
        await Promise.all([
          tasks.trigger("topic-research", { ...dated, triggered_manually: false }),
          tasks.trigger("problem-discovery", { ...dated, triggered_manually: false }),
          tasks.trigger("forum-opportunity-finder", dated),
        ]);
      }

      logger.info(`weekly-research-scan: triggered research for ${activeApps.length} apps`);
      return { appsScanned: activeApps.length };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "weekly-research-scan failed unexpectedly.";
      logger.error("weekly-research-scan failed", { error: message });
      throw err;
    }
  },
});
