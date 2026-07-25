import { logger, schedules, tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { appRunTag } from "@/lib/jobHealthRegistry";
import { RESEARCH_DAYS } from "@/types";

// This is the "next automatic scan runs [preferred day/hour]" the Research
// and Opportunities empty states promise. Runs the three weekly research
// jobs — Topic Research, Problem Discovery, and Forum Opportunity Finder —
// for every active app whose preferred_research_day/preferred_research_hour
// (both UTC) matches right now. Competitor Gap Analysis runs separately,
// monthly — see trigger/monthly-competitor-scan.ts.
//
// Restructured from a single fixed "Sunday 11pm UTC fires every app at
// once" cron to an hourly cron that checks each app's own preference,
// since Settings now lets each app pick its own day+hour
// (components/apps/research-schedule-section.tsx). Day+hour is a fixed
// weekly slot, so each app still matches exactly once per week — just at
// its own chosen time instead of one platform-wide time for everyone.
export const weeklyResearchScan = schedules.task({
  id: "weekly-research-scan",
  cron: { pattern: "0 * * * *", timezone: "UTC" }, // every hour, on the hour
  run: async () => {
    try {
      const now = new Date();
      const currentDay = RESEARCH_DAYS[now.getUTCDay()];
      const currentHour = now.getUTCHours();

      const { data: apps, error } = await supabaseAdmin
        .from("apps")
        .select("id, workspace_id")
        .eq("status", "active")
        .eq("preferred_research_day", currentDay)
        .eq("preferred_research_hour", currentHour);

      if (error) {
        throw new Error(`Failed to load active apps: ${error.message}`);
      }

      const matchingApps = apps ?? [];
      logger.info(
        `weekly-research-scan: ${matchingApps.length} app(s) match ${currentDay} ${currentHour}:00 UTC`
      );

      for (const app of matchingApps) {
        const dated = { app_id: app.id, workspace_id: app.workspace_id };
        const tagOptions = { tags: [appRunTag(app.id)] };
        await Promise.all([
          tasks.trigger("topic-research", { ...dated, triggered_manually: false }, tagOptions),
          tasks.trigger("problem-discovery", { ...dated, triggered_manually: false }, tagOptions),
          tasks.trigger("forum-opportunity-finder", dated, tagOptions),
        ]);
      }

      logger.info(`weekly-research-scan: triggered research for ${matchingApps.length} apps`);
      return { appsScanned: matchingApps.length };
    } catch (err) {
      await handleJobError(err, { jobName: "weekly-research-scan" });
      throw err;
    }
  },
});
