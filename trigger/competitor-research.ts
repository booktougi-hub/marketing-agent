import { logger, schemaTask, tasks } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { discoverAndSummarizeCompetitors } from "@/lib/competitor-discovery";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { appRunTag } from "@/lib/jobHealthRegistry";
import type { diagnosis as diagnosisTask } from "@/trigger/diagnosis";
import type { AppDna, ProductType } from "@/types";

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

export const competitorResearch = schemaTask({
  id: "competitor-research",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;
    logger.info("competitor-research: run started", { app_id, workspace_id });

    try {
      const { data: app, error: appError } = await supabaseAdmin
        .from("apps")
        .select("dna, product_type, additional_context")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appError) {
        throw new Error(`Failed to load app record: ${appError.message}`);
      }

      if (!app.dna) {
        logger.warn(`competitor-research: app ${app_id} has no DNA yet, skipping`, { app_id });
        return { app_id, savedCount: 0 };
      }

      const dna = app.dna as AppDna;
      const productType = (app.product_type as ProductType) ?? "other";

      const competitors = await discoverAndSummarizeCompetitors(
        dna,
        productType,
        app.additional_context,
        app_id
      );

      // Every branch below — including "found nothing usable" — must still
      // reach the diagnosis trigger at the end. This job sits in the middle
      // of the required onboarding chain (dna-extraction -> this ->
      // diagnosis -> ... -> strategy-generation); returning early without
      // triggering diagnosis would leave the app stuck in
      // 'competitor_research_pending' forever. A genuinely novel product
      // with zero real competitors is a legitimate outcome, not a failure —
      // diagnosis.ts reasons from DNA alone when competitor_research is empty.
      let savedCount = 0;

      if (competitors.length === 0) {
        logger.warn(`competitor-research: no usable competitor data found for app ${app_id} — proceeding to diagnosis without competitor context`, { app_id });
      } else {
        const { error: insertError } = await supabaseAdmin.from("competitor_research").insert(
          competitors.map((c) => ({
            app_id,
            workspace_id,
            competitor_name: c.name,
            competitor_url: c.url,
            scraped_summary: c.scraped_summary,
            pricing_notes: c.pricing_notes,
            positioning_notes: c.positioning_notes,
          }))
        );
        if (insertError) {
          throw new Error(`Failed to save competitor research: ${insertError.message}`);
        }
        savedCount = competitors.length;
      }

      logger.info(`competitor-research: saved ${savedCount} competitor(s) for app ${app_id}, triggering diagnosis`, {
        app_id,
        savedCount,
      });

      const diagnosisHandle = await tasks.trigger<typeof diagnosisTask>(
        "diagnosis",
        { app_id, workspace_id },
        { tags: [appRunTag(app_id)] }
      );

      // Hands pending_run tracking off to diagnosis — job-watchdog.ts should
      // watch that run next, not this now-completed one.
      await supabaseAdmin
        .from("apps")
        .update({ status: "diagnosis_pending", pending_run_id: diagnosisHandle.id, pending_run_task: "diagnosis" })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      return { app_id, savedCount };
    } catch (err) {
      await handleJobError(err, {
        appId: app_id,
        workspaceId: workspace_id,
        jobName: "competitor-research",
      });
      throw err;
    }
  },
});
