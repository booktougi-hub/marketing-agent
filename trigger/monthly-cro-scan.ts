import { logger, schedules, tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { appRunTag } from "@/lib/jobHealthRegistry";
import type { croAudit } from "@/trigger/cro-audit";

// Third and last of the "Audits" family's monthly scans, alongside
// trigger/monthly-onboarding-scan.ts and trigger/monthly-churn-scan.ts —
// same pattern, its own cron and its own job. See lib/schedule.ts
// MONTHLY_AUTOMATIONS for the UI-facing "next run" copy, which must stay
// in sync with this cron pattern. See PHASES.md Notes Log (2026-07-22)
// for why this exists.
export const monthlyCroScan = schedules.task({
  id: "monthly-cro-scan",
  cron: { pattern: "0 20 1 * *", timezone: "UTC" }, // 1st of the month, 8pm UTC
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
      logger.info(`monthly-cro-scan: scanning ${activeApps.length} app(s)`);

      for (const app of activeApps) {
        await tasks.trigger<typeof croAudit>(
          "cro-audit",
          { app_id: app.id, workspace_id: app.workspace_id },
          { tags: [appRunTag(app.id)] }
        );
      }

      logger.info(`monthly-cro-scan: triggered audit for ${activeApps.length} app(s)`);
      return { appsScanned: activeApps.length };
    } catch (err) {
      await handleJobError(err, { jobName: "monthly-cro-scan" });
      throw err;
    }
  },
});
