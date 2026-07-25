import { logger, schedules, tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { appRunTag } from "@/lib/jobHealthRegistry";
import type { pricingAudit } from "@/trigger/pricing-audit";

// Fourth of the "Audits" family's monthly scans, alongside
// trigger/monthly-onboarding-scan.ts, trigger/monthly-churn-scan.ts, and
// trigger/monthly-cro-scan.ts — same pattern, its own cron and its own
// job. See lib/schedule.ts MONTHLY_AUTOMATIONS for the UI-facing "next
// run" copy, which must stay in sync with this cron pattern. See
// PHASES.md Notes Log (2026-07-22) for why this exists.
export const monthlyPricingScan = schedules.task({
  id: "monthly-pricing-scan",
  cron: { pattern: "0 19 1 * *", timezone: "UTC" }, // 1st of the month, 7pm UTC
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
      logger.info(`monthly-pricing-scan: scanning ${activeApps.length} app(s)`);

      for (const app of activeApps) {
        await tasks.trigger<typeof pricingAudit>(
          "pricing-audit",
          { app_id: app.id, workspace_id: app.workspace_id },
          { tags: [appRunTag(app.id)] }
        );
      }

      logger.info(`monthly-pricing-scan: triggered audit for ${activeApps.length} app(s)`);
      return { appsScanned: activeApps.length };
    } catch (err) {
      await handleJobError(err, { jobName: "monthly-pricing-scan" });
      throw err;
    }
  },
});
