import { logger, schedules, tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { appRunTag } from "@/lib/jobHealthRegistry";
import type { diagnosisRefreshCheck } from "@/trigger/diagnosis-refresh-check";

// diagnosis-refresh-check's cadence is a 90-day rolling window per app
// (apps.last_diagnosis_refresh_at), not a fixed calendar day the way the
// other monthly-*-scan.ts files are — so this checks daily (mirroring
// trigger/content-regeneration-check.ts's daily-threshold pattern) rather
// than firing unconditionally for every app once a month.
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export const quarterlyDiagnosisRefreshScan = schedules.task({
  id: "quarterly-diagnosis-refresh-scan",
  cron: { pattern: "0 6 * * *", timezone: "UTC" }, // once daily, 06:00 UTC
  run: async () => {
    try {
      const cutoff = new Date(Date.now() - NINETY_DAYS_MS).toISOString();

      const { data: apps, error } = await supabaseAdmin
        .from("apps")
        .select("id, workspace_id, last_diagnosis_refresh_at")
        .eq("status", "active")
        .eq("diagnosis_status", "acknowledged")
        .neq("diagnosis_refresh_status", "proposal_ready")
        .not("diagnosis", "is", null)
        .or(`last_diagnosis_refresh_at.is.null,last_diagnosis_refresh_at.lt.${cutoff}`);

      if (error) {
        throw new Error(`Failed to load apps due for a diagnosis refresh check: ${error.message}`);
      }

      const dueApps = apps ?? [];
      logger.info(`quarterly-diagnosis-refresh-scan: ${dueApps.length} app(s) due`);

      for (const app of dueApps) {
        await tasks.trigger<typeof diagnosisRefreshCheck>(
          "diagnosis-refresh-check",
          { app_id: app.id, workspace_id: app.workspace_id },
          { tags: [appRunTag(app.id)] }
        );
      }

      logger.info(`quarterly-diagnosis-refresh-scan: triggered check for ${dueApps.length} app(s)`);
      return { appsChecked: dueApps.length };
    } catch (err) {
      await handleJobError(err, { jobName: "quarterly-diagnosis-refresh-scan" });
      throw err;
    }
  },
});
