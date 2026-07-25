// TODO(brand-identity): once brand_information (SCHEMA.md) is populated for
// an app, feed its key_stats and tone_descriptors into the GEO content-
// quality checks below (generateSEOFindings / the GEO dimension evaluators)
// — key_stats are real, sourced proof points GEO checks can cite as
// evidence of authority, and tone_descriptors help judge voice consistency
// findings. Not wired in yet — extraction + Settings UI only so far (see
// trigger/brand-info-extraction.ts).
import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";
import { buildDiscoveryQueries, PRODUCT_TYPE_LABEL } from "@/lib/discovery-query-builder";
import { extractKeyPhrase } from "@/lib/research-job";
import { scrapePage, evaluateRetrievabilityChecks, evaluateOffPageChecks } from "@/lib/seo/evaluate";
import { computeSEOScore, toDimScores, generateSEOFindings } from "@/lib/seo/scoring";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { ExternalServiceError } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import type { AppDna, ProductType, SeoGeoCheckResultMap } from "@/types";

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_COMPETITOR_SCRAPES = 3;

// SCORING.md's SEO evaluation track — rule-based only, no LLM call needed.
// GEO track is deferred (see PHASES.md Notes Log) — this job only writes
// track='seo' rows for now, but the schema (seo_geo_scores/seo_geo_findings)
// already supports 'geo' so adding that track later doesn't need a second
// migration.
export const seoGeoAudit = schemaTask({
  id: "seo-geo-audit",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;
    logger.info("seo-geo-audit: run started", { app_id, workspace_id });

    try {
      const { data: app, error: appError } = await supabaseAdmin
        .from("apps")
        .select("dna, product_type, additional_context, source_url")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appError) {
        throw new Error(`Failed to load app record: ${appError.message}`);
      }

      if (!app.dna) {
        logger.warn(`seo-geo-audit: app ${app_id} has no DNA yet, skipping`, { app_id });
        return { app_id, skipped: true as const };
      }

      const dna = app.dna as AppDna;
      const productType = (app.product_type as ProductType) ?? "other";
      const pageUrl = app.source_url;

      const scraped = await scrapePage(pageUrl);
      if (!scraped) {
        // Distinct from the "no DNA yet" skip above — this is a real
        // failure (Firecrawl error, timeout, insufficient credits on the
        // account, etc.), not an expected/legitimate no-op. Throwing here
        // (instead of silently returning) is what makes this run show as
        // FAILED in Trigger.dev and in the System Health panel — a prior
        // version of this job returned skipped:true for scrape failures
        // too, which meant a founder's manual "Run Now" click could spend
        // an agent credit and produce literally no visible result or error.
        throw new ExternalServiceError(ErrorMessages.external.FIRECRAWL_FAILED, "firecrawl");
      }

      const [{ data: competitorRows }, { count: communityPresenceCount }, { data: priorScoreRow }] =
        await Promise.all([
          supabaseAdmin
            .from("competitor_research")
            .select("competitor_url")
            .eq("app_id", app_id)
            .eq("workspace_id", workspace_id)
            .not("competitor_url", "is", null)
            .limit(MAX_COMPETITOR_SCRAPES),
          supabaseAdmin
            .from("research_findings")
            .select("id", { count: "exact", head: true })
            .eq("app_id", app_id)
            .eq("workspace_id", workspace_id)
            .eq("stream", "forum_opportunities")
            .eq("status", "active"),
          supabaseAdmin
            .from("seo_geo_scores")
            .select("check_results, run_at")
            .eq("app_id", app_id)
            .eq("workspace_id", workspace_id)
            .eq("track", "seo")
            .lt("run_at", new Date(Date.now() - NINETY_DAYS_MS).toISOString())
            .order("run_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

      const competitorMarkdowns: string[] = [];
      if (competitorRows && competitorRows.length > 0) {
        const firecrawl = createFirecrawlClient();
        const scrapes = await Promise.all(
          competitorRows.map(async (row) => {
            if (!row.competitor_url) return null;
            try {
              const result = await firecrawl.scrapeUrl(row.competitor_url, {
                formats: ["markdown"],
                timeout: SCRAPE_TIMEOUT_MS,
              });
              return "markdown" in result ? result.markdown ?? null : null;
            } catch {
              return null;
            }
          })
        );
        for (const md of scrapes) {
          if (md) competitorMarkdowns.push(md);
        }
      }

      const priorMentionCount =
        (priorScoreRow?.check_results as SeoGeoCheckResultMap | undefined)?.["seo.offpage.mention_count"]?.value
          ? ((priorScoreRow!.check_results as SeoGeoCheckResultMap)["seo.offpage.mention_count"].value as { mentionCount?: number }).mentionCount ?? null
          : null;

      const targetQuery = buildDiscoveryQueries(dna, productType, app.additional_context)[0]?.query ?? null;
      const primaryKeyword =
        extractKeyPhrase(dna.tagline, 4) || extractKeyPhrase(dna.problem, 4) || dna.name || "";

      const evalInput = {
        pageUrl,
        scraped,
        brandName: dna.name || PRODUCT_TYPE_LABEL[productType],
        primaryKeyword,
        targetQuery,
        competitorMarkdowns,
        priorMentionCount,
        communityPresenceCount: communityPresenceCount ?? 0,
      };

      const [retrievabilityResults, offPageResults] = await Promise.all([
        evaluateRetrievabilityChecks(evalInput),
        evaluateOffPageChecks(evalInput),
      ]);

      const checkResults: SeoGeoCheckResultMap = { ...retrievabilityResults, ...offPageResults };
      const score = computeSEOScore(checkResults);
      const findings = generateSEOFindings(checkResults);

      const { error: scoreInsertError } = await supabaseAdmin.from("seo_geo_scores").insert({
        app_id,
        workspace_id,
        page_url: pageUrl,
        track: "seo",
        score: score.composite,
        dim_scores: toDimScores(score),
        check_results: checkResults,
      });

      if (scoreInsertError) {
        throw new Error(`Failed to save SEO score: ${scoreInsertError.message}`);
      }

      if (findings.length > 0) {
        const { error: findingsInsertError } = await supabaseAdmin.from("seo_geo_findings").insert(
          findings.map((f) => ({
            app_id,
            workspace_id,
            page_url: pageUrl,
            track: "seo" as const,
            check_id: f.check_id,
            dimension: f.dimension,
            evidence_tier: f.evidence_tier,
            expected_gain: f.expected_gain,
            title: f.title,
            explanation: f.explanation,
            confidence_label: f.confidence_label,
            remediation: f.remediation,
            status: "open" as const,
          }))
        );

        if (findingsInsertError) {
          throw new Error(`Failed to save SEO findings: ${findingsInsertError.message}`);
        }
      }

      logger.info(`seo-geo-audit: app ${app_id} scored ${score.composite} (retrievability ${score.retrievability}, off-page ${score.off_page}), ${findings.length} finding(s)`, {
        app_id,
        score,
        findingCount: findings.length,
      });

      return { app_id, score: score.composite, findingCount: findings.length };
    } catch (err) {
      await handleJobError(err, { appId: app_id, workspaceId: workspace_id, jobName: "seo-geo-audit", updateAppStatus: false });
      throw err;
    }
  },
});
