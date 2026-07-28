import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";
import { buildDiscoveryQueries, PRODUCT_TYPE_LABEL } from "@/lib/discovery-query-builder";
import { extractKeyPhrase } from "@/lib/research-job";
import { scrapePage, evaluateRetrievabilityChecks, evaluateOffPageChecks } from "@/lib/seo/evaluate";
import { computeSEOScore, toDimScores, generateSEOFindings } from "@/lib/seo/scoring";
import { evaluateGeoLlmChecks, evaluateGeoRuleChecks } from "@/lib/geo/evaluate";
import { computeGEOScore, toDimScores as toGeoDimScores, generateGEOFindings } from "@/lib/geo/scoring";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { ExternalServiceError } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import type { AppDna, BrandKeyStat, ProductType, SeoGeoCheckResultMap } from "@/types";

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_COMPETITOR_SCRAPES = 3;

// SCORING.md's SEO + GEO evaluation tracks, one engine / one job / one
// scrape per SCORING.md's architecture diagram — SEO is rule-based only,
// GEO mixes rule-based structure/freshness checks with a single LLM call
// for content-quality + the harder structure checks (see lib/geo/evaluate.ts).
// Both tracks write their own seo_geo_scores/seo_geo_findings rows
// (track='seo' / track='geo'), never blended into one score.
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

      const [{ data: competitorRows }, { count: communityPresenceCount }, { data: priorScoreRow }, { data: brandInfo }] =
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
          // Feeds the GEO content-quality checks below — key_stats are real,
          // sourced proof points the LLM can recognize as satisfying
          // geo.content.statistics, and tone_descriptors help it judge
          // fluency/voice. Not every app has run brand-info-extraction yet,
          // so this is nullable and folded in only when present.
          supabaseAdmin
            .from("brand_information")
            .select("key_stats, tone_descriptors")
            .eq("app_id", app_id)
            .eq("workspace_id", workspace_id)
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

      // additional_context first (founder's own free-text notes, including
      // any prior audit feedback — see the seo-findings feedback route),
      // then brand_information's real proof points and voice descriptors
      // when that extraction has run. Either or both may be absent; the GEO
      // prompt works fine with none of this, it just judges from the page
      // content alone in that case.
      const keyStats = (brandInfo?.key_stats as BrandKeyStat[] | null) ?? [];
      const geoContextParts = [
        app.additional_context,
        keyStats.length > 0
          ? `Known real stats/proof points for this product (cite these, don't invent others): ${keyStats.map((s) => `${s.label}: ${s.value}`).join("; ")}`
          : null,
        brandInfo?.tone_descriptors && brandInfo.tone_descriptors.length > 0
          ? `Intended brand voice: ${brandInfo.tone_descriptors.join(", ")}`
          : null,
      ].filter((part): part is string => !!part);
      const geoContext = geoContextParts.length > 0 ? geoContextParts.join("\n\n") : null;

      const [retrievabilityResults, offPageResults, geoLlmResults] = await Promise.all([
        evaluateRetrievabilityChecks(evalInput),
        evaluateOffPageChecks(evalInput),
        evaluateGeoLlmChecks(scraped, geoContext),
      ]);
      const geoRuleResults = evaluateGeoRuleChecks({ scraped, primaryKeyword, competitorMarkdowns });

      const checkResults: SeoGeoCheckResultMap = { ...retrievabilityResults, ...offPageResults };
      const score = computeSEOScore(checkResults);
      const findings = generateSEOFindings(checkResults);

      const geoCheckResults: SeoGeoCheckResultMap = { ...geoLlmResults, ...geoRuleResults };
      const geoScore = computeGEOScore(geoCheckResults);
      const geoFindings = generateGEOFindings(geoCheckResults);

      const { error: scoreInsertError } = await supabaseAdmin.from("seo_geo_scores").insert([
        {
          app_id,
          workspace_id,
          page_url: pageUrl,
          track: "seo",
          score: score.composite,
          dim_scores: toDimScores(score),
          check_results: checkResults,
        },
        {
          app_id,
          workspace_id,
          page_url: pageUrl,
          track: "geo",
          score: geoScore.composite,
          dim_scores: toGeoDimScores(geoScore),
          check_results: geoCheckResults,
        },
      ]);

      if (scoreInsertError) {
        throw new Error(`Failed to save SEO/GEO scores: ${scoreInsertError.message}`);
      }

      const findingRows = [
        ...findings.map((f) => ({
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
        })),
        ...geoFindings.map((f) => ({
          app_id,
          workspace_id,
          page_url: pageUrl,
          track: "geo" as const,
          check_id: f.check_id,
          dimension: f.dimension,
          evidence_tier: f.evidence_tier,
          expected_gain: f.expected_gain,
          title: f.title,
          explanation: f.explanation,
          confidence_label: f.confidence_label,
          remediation: f.remediation,
          status: "open" as const,
        })),
      ];

      if (findingRows.length > 0) {
        const { error: findingsInsertError } = await supabaseAdmin.from("seo_geo_findings").insert(findingRows);

        if (findingsInsertError) {
          throw new Error(`Failed to save SEO/GEO findings: ${findingsInsertError.message}`);
        }
      }

      logger.info(
        `seo-geo-audit: app ${app_id} — SEO ${score.composite} (retrievability ${score.retrievability}, off-page ${score.off_page}), GEO ${geoScore.composite} (content ${geoScore.content_quality}, structure ${geoScore.structure}, freshness ${geoScore.freshness}), ${findings.length + geoFindings.length} finding(s) total`,
        { app_id, score, geoScore, findingCount: findings.length + geoFindings.length }
      );

      return {
        app_id,
        score: score.composite,
        geoScore: geoScore.composite,
        findingCount: findings.length + geoFindings.length,
      };
    } catch (err) {
      await handleJobError(err, { appId: app_id, workspaceId: workspace_id, jobName: "seo-geo-audit", updateAppStatus: false });
      throw err;
    }
  },
});
