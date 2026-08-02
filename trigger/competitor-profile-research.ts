import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { discoverAndSummarizeCompetitors } from "@/lib/competitor-discovery";
import { researchCompetitorProfile } from "@/lib/competitor-profile-core";
import type { AppDna, ProductType } from "@/types";

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

// The narrow, on-demand "Research Competitors" job behind Product
// Information's Competitor Information section — triggered only via the
// credit-gated "competitor_profile_research" agent action. Deepens the
// competitor_research rows trigger/competitor-research.ts already created
// automatically during onboarding (seeded from dna.competitors — see that
// job) rather than re-discovering competitors from scratch on every run;
// only falls back to fresh discovery if this app genuinely has no
// competitor_research rows yet. Never touches apps.status/pending_run_id —
// same non-pipeline pattern as trigger/dna-reextraction.ts and
// trigger/brand-info-extraction.ts, tracked instead via its own
// competitor_profile_status/error/pending_run_id columns.
export const competitorProfileResearch = schemaTask({
  id: "competitor-profile-research",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;

    logger.info("competitor-profile-research: run started", { app_id, workspace_id });

    try {
      const { data: app, error: appError } = await supabaseAdmin
        .from("apps")
        .select("dna, product_type, additional_context")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appError || !app?.dna) {
        throw new Error(`App ${app_id} has no DNA yet — product information must be analyzed first.`);
      }

      const dna = app.dna as AppDna;

      const { data: existingRows, error: existingRowsError } = await supabaseAdmin
        .from("competitor_research")
        .select("id, competitor_name, competitor_url")
        .eq("app_id", app_id)
        .eq("workspace_id", workspace_id);

      if (existingRowsError) {
        throw new Error(`Failed to load existing competitor_research rows: ${existingRowsError.message}`);
      }

      let candidates = (existingRows ?? []).filter(
        (row): row is { id: string; competitor_name: string; competitor_url: string } =>
          !!row.competitor_name && !!row.competitor_url
      );

      // No competitors known yet (app predates the automatic onboarding
      // discovery, or that run found nothing) — try fresh discovery once,
      // seeded the same way onboarding does: dna.competitors first, SerpAPI
      // as a fallback. Insert baseline rows so there's something to update
      // below, mirroring trigger/competitor-research.ts's own insert shape.
      if (candidates.length === 0) {
        logger.info("competitor-profile-research: no existing competitor_research rows, running fresh discovery", {
          app_id,
        });
        const discovered = await discoverAndSummarizeCompetitors(
          dna,
          (app.product_type as ProductType) ?? "other",
          app.additional_context,
          app_id
        );

        if (discovered.length === 0) {
          logger.warn("competitor-profile-research: fresh discovery found no usable competitors", { app_id });
        } else {
          const { data: inserted, error: insertError } = await supabaseAdmin
            .from("competitor_research")
            .insert(
              discovered.map((c) => ({
                app_id,
                workspace_id,
                competitor_name: c.name,
                competitor_url: c.url,
                scraped_summary: c.scraped_summary,
                pricing_notes: c.pricing_notes,
                positioning_notes: c.positioning_notes,
              }))
            )
            .select("id, competitor_name, competitor_url");

          if (insertError) {
            throw new Error(`Failed to save freshly discovered competitors: ${insertError.message}`);
          }
          candidates = (inserted ?? []).filter(
            (row): row is { id: string; competitor_name: string; competitor_url: string } =>
              !!row.competitor_name && !!row.competitor_url
          );
        }
      }

      if (candidates.length === 0) {
        // Not an error — a genuinely novel product with no discoverable
        // competitors is a legitimate outcome, same stance
        // trigger/competitor-research.ts takes.
        await supabaseAdmin
          .from("apps")
          .update({
            competitor_profile_status: "complete",
            competitor_profile_error: null,
            competitor_profile_pending_run_id: null,
            competitor_profile_last_generated_at: new Date().toISOString(),
          })
          .eq("id", app_id)
          .eq("workspace_id", workspace_id);

        logger.info("competitor-profile-research: no competitors to profile, finishing", { app_id });
        return { app_id, profiledCount: 0 };
      }

      logger.info(`competitor-profile-research: profiling ${candidates.length} competitor(s)`, {
        app_id,
        competitors: candidates.map((c) => c.competitor_name),
      });

      const results = await Promise.allSettled(
        candidates.map((candidate) =>
          researchCompetitorProfile({
            competitorName: candidate.competitor_name,
            competitorUrl: candidate.competitor_url,
            ourDna: dna,
            jobName: "competitor-profile-research",
          }).then((profile) => ({ candidate, profile }))
        )
      );

      let profiledCount = 0;
      const nowIso = new Date().toISOString();

      for (const result of results) {
        if (result.status !== "fulfilled" || !result.value.profile) {
          if (result.status === "rejected") {
            logger.warn("competitor-profile-research: profiling failed for one competitor, continuing", {
              app_id,
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            });
          }
          continue;
        }

        const { candidate, profile } = result.value;
        const { error: updateError } = await supabaseAdmin
          .from("competitor_research")
          .update({ ...profile, profile_generated_at: nowIso })
          .eq("id", candidate.id)
          .eq("workspace_id", workspace_id);

        if (updateError) {
          logger.error("competitor-profile-research: failed to save profile for competitor", {
            app_id,
            competitor_id: candidate.id,
            error: updateError.message,
          });
          continue;
        }
        profiledCount++;
      }

      await supabaseAdmin
        .from("apps")
        .update({
          competitor_profile_status: "complete",
          competitor_profile_error: null,
          competitor_profile_pending_run_id: null,
          competitor_profile_last_generated_at: nowIso,
        })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      logger.info(`competitor-profile-research: saved ${profiledCount}/${candidates.length} profile(s)`, {
        app_id,
      });

      return { app_id, profiledCount };
    } catch (err) {
      // Side/enrichment job, not one of the three pipeline-blocking jobs —
      // never touches apps.status. Its own competitor_profile_status/
      // competitor_profile_error columns play that role for this narrow
      // job instead (see SCHEMA.md).
      await handleJobError(err, {
        appId: app_id,
        workspaceId: workspace_id,
        jobName: "competitor-profile-research",
        updateAppStatus: false,
      });

      const message = err instanceof Error ? err.message : ErrorMessages.generic.UNKNOWN;
      await supabaseAdmin
        .from("apps")
        .update({
          competitor_profile_status: "error",
          competitor_profile_error: message,
          competitor_profile_pending_run_id: null,
        })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      throw err;
    }
  },
});
