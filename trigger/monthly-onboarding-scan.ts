import { logger, schedules, tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { appRunTag } from "@/lib/jobHealthRegistry";
import type { onboardingAudit } from "@/trigger/onboarding-audit";

// Onboarding Audit runs monthly, not weekly — activation friction (unlike
// trending topics/complaints) doesn't shift week to week. Mirrors
// trigger/monthly-competitor-scan.ts's pattern, its own cron and its own
// job. See lib/schedule.ts MONTHLY_AUTOMATIONS for the UI-facing "next run"
// copy, which must stay in sync with this cron pattern. See PHASES.md
// Notes Log (2026-07-22) for why this exists.
export const monthlyOnboardingScan = schedules.task({
  id: "monthly-onboarding-scan",
  cron: { pattern: "0 22 1 * *", timezone: "UTC" }, // 1st of the month, 10pm UTC
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
      logger.info(`monthly-onboarding-scan: scanning ${activeApps.length} app(s)`);

      for (const app of activeApps) {
        await tasks.trigger<typeof onboardingAudit>(
          "onboarding-audit",
          { app_id: app.id, workspace_id: app.workspace_id },
          { tags: [appRunTag(app.id)] }
        );
      }

      logger.info(`monthly-onboarding-scan: triggered audit for ${activeApps.length} app(s)`);
      return { appsScanned: activeApps.length };
    } catch (err) {
      await handleJobError(err, { jobName: "monthly-onboarding-scan" });
      throw err;
    }
  },
});
