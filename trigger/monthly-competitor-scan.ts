import { logger, schedules, tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";

// Competitor Gap Analysis runs monthly, not weekly, since competitor
// pricing/positioning/reviews don't shift week to week the way trending
// topics and user complaints do — see trigger/competitor-gap-analysis.ts.
// Mirrors trigger/weekly-research-scan.ts's pattern, just on its own cron
// and its own job.
export const monthlyCompetitorScan = schedules.task({
  id: "monthly-competitor-scan",
  cron: { pattern: "0 23 1 * *", timezone: "UTC" }, // 1st of the month, 11pm UTC
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
      logger.info(`monthly-competitor-scan: scanning ${activeApps.length} apps`);

      for (const app of activeApps) {
        await tasks.trigger("competitor-gap-analysis", {
          app_id: app.id,
          workspace_id: app.workspace_id,
        });
      }

      logger.info(`monthly-competitor-scan: triggered analysis for ${activeApps.length} apps`);
      return { appsScanned: activeApps.length };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "monthly-competitor-scan failed unexpectedly.";
      logger.error("monthly-competitor-scan failed", { error: message });
      throw err;
    }
  },
});
