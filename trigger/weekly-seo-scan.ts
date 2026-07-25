import { logger, schedules, tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { appRunTag } from "@/lib/jobHealthRegistry";
import type { seoGeoAudit } from "@/trigger/seo-geo-audit";

// SCORING.md: "weekly Trigger.dev job seo-geo-audit.ts" for existing site
// pages. Mirrors trigger/monthly-competitor-scan.ts's pattern — its own
// cron, its own job, free for every active app (only a manual re-trigger
// via the agent-action credit system costs a credit, same as the other
// four audits).
export const weeklySeoScan = schedules.task({
  id: "weekly-seo-scan",
  cron: { pattern: "0 18 * * 0", timezone: "UTC" }, // every Sunday, 6pm UTC
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
      logger.info(`weekly-seo-scan: scanning ${activeApps.length} app(s)`);

      for (const app of activeApps) {
        await tasks.trigger<typeof seoGeoAudit>(
          "seo-geo-audit",
          { app_id: app.id, workspace_id: app.workspace_id },
          { tags: [appRunTag(app.id)] }
        );
      }

      logger.info(`weekly-seo-scan: triggered audit for ${activeApps.length} app(s)`);
      return { appsScanned: activeApps.length };
    } catch (err) {
      await handleJobError(err, { jobName: "weekly-seo-scan" });
      throw err;
    }
  },
});
