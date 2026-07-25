import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { callExternalService } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";
import { hasAnyConversionRetentionData, parseConversionRetention } from "@/lib/app-settings";
import type { AppDna } from "@/types";

const CLAUDE_MODEL = "claude-sonnet-5";
const MAX_SIGNUP_PAGES_TO_SCRAPE = 3;
const MAX_FINDINGS = 8;

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

const findingSchema = z.object({
  finding_type: z.string().min(1),
  severity: z.enum(["high", "medium", "low"]),
  issue_description: z.string().min(1),
  suggested_fix: z.string().min(1),
});

const auditResponseSchema = z.object({
  // Non-null whenever the audit is leaning on DNA alone (no Conversion &
  // Retention settings, no scrapable signup flow) — logged, never invented
  // into a fake finding. Per spec step 5: say so explicitly rather than
  // padding the findings array with generic filler.
  confidence_note: z.string().nullable(),
  // Generous ceiling here on purpose — the prompt already asks for "at
  // most MAX_FINDINGS", but a strict `.max(MAX_FINDINGS)` here would throw
  // (indistinguishable from a genuinely malformed response) on a run where
  // Claude has real, specific findings but overshoots the count slightly.
  // The actual MAX_FINDINGS cap is enforced by slicing after a successful
  // parse instead, so an over-generous but valid response degrades to
  // "extra findings dropped," not "whole run failed."
  findings: z.array(findingSchema).max(20),
});

// STEP 2 — signup/onboarding-adjacent page discovery from the homepage's
// own markdown. Same regex-link-scan approach as
// competitor-research.ts's findPricingLink, generalized to a keyword list
// and multiple matches instead of one.
const SIGNUP_LINK_KEYWORDS = [
  "sign up",
  "signup",
  "get started",
  "start free",
  "free trial",
  "start your trial",
  "create account",
  "create an account",
  "register",
  "pricing",
];

function findRelevantLinks(markdown: string, baseUrl: string): string[] {
  const linkPattern = /\[([^\]]*)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/gi;
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of markdown.matchAll(linkPattern)) {
    const linkText = match[1].toLowerCase();
    const rawUrl = match[2];
    const isRelevant = SIGNUP_LINK_KEYWORDS.some(
      (kw) => linkText.includes(kw) || rawUrl.toLowerCase().includes(kw.replace(/\s+/g, "-"))
    );
    if (!isRelevant) continue;

    try {
      const resolved = new URL(rawUrl, baseUrl).toString();
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      urls.push(resolved);
    } catch {
      // Malformed link — skip rather than fail the whole scrape.
    }
  }

  return urls.slice(0, MAX_SIGNUP_PAGES_TO_SCRAPE);
}

// Diagnosis-first pipeline redesign (PHASES.md, 2026-07-14) added
// `diagnosis.bottleneck === "activation"` as a real output, but nothing
// downstream acted on it — this job is what closes that gap (PHASES.md
// Notes Log, 2026-07-22). Adapted from .claude/skills/onboarding/SKILL.md
// for autonomous, single-pass execution: that skill assumes an interactive
// back-and-forth ("Task-Specific Questions") before recommending anything;
// here there is no human to ask, so every question it would normally ask
// becomes either a fact pulled from real data (DNA, Conversion & Retention
// settings, a scraped signup page) or an explicit gap noted in
// confidence_note — never a guess dressed up as a finding.
const SYSTEM_PROMPT = `You are an expert in user onboarding and activation, auditing a specific software product's post-signup activation flow. You are working alone, with no human available to ask clarifying questions — reach a firm conclusion from the data given, or say plainly what's missing.

=== CORE FRAMEWORK (apply this reasoning, do not just restate it) ===

1. TIME-TO-VALUE IS EVERYTHING — every step between signup and the product's core value is friction. Identify what this specific product's real "aha moment" would be (the action that most plausibly correlates with retention for this category — e.g. a project tool's aha moment is creating a first project + inviting a teammate; an analytics tool's is installing tracking and seeing a first real report), and judge distance-to-value against that, not a generic checklist.
2. ONE GOAL PER SESSION — the first session should drive toward one successful outcome, not showcase every feature at once.
3. DO, DON'T SHOW — interactive/hands-on beats a passive tour or tutorial.
4. PROGRESS CREATES MOTIVATION — visible advancement, especially for multi-step setups (checklists work best at 3-7 items, ordered by value, with a visible completion state).
5. EMPTY STATES ARE ONBOARDING OPPORTUNITIES, not dead ends — a blank dashboard/list should explain what it's for and offer one clear first action.
6. COMMON PATTERNS BY PRODUCT TYPE — weigh the product's category (developer tool, mobile app, web app, SaaS, browser extension) into what "good" onboarding looks like for that category specifically.

=== OUTPUT FORMAT ===

For each issue: Finding → Impact → Recommendation → Priority. Concretely:
- "issue_description" = the specific Finding + its Impact, grounded in a real, specific detail about THIS product (its actual features, its actual pricing model, its actual target audience, or something actually seen on its actual signup/pricing page) — never a generic statement that could apply to any SaaS product.
- "suggested_fix" = the Recommendation — concrete and actionable, naming what to actually build or change, not vague advice like "improve onboarding."
- "severity" = the Priority: "high" (blocks or badly delays reaching the aha moment), "medium" (real friction but not the primary blocker), "low" (polish, would help but isn't urgent).
- "finding_type" = a short snake_case label categorizing the issue (e.g. "time_to_value", "missing_checklist", "buried_signup_cta", "empty_state_dead_end", "unclear_aha_moment", "too_many_steps").

=== DATA YOU ARE GIVEN ===

You'll receive this product's DNA (name, tagline, problem, features, target audience, pricing, tone), any founder-provided additional context, any Conversion & Retention numbers the founder has filled in (trial length, free tier, onboarding step count, known signup/activation/churn rates — any of these may be missing), and — if it was reachable — real scraped content from the homepage and any signup/get-started/pricing pages discovered from it.

=== RULES ===

- Every finding must cite a specific, real detail from what you were actually given (a feature name, the actual pricing text, an actual phrase from a scraped page, an actual Conversion & Retention number) — do not invent metrics, page contents, or flow steps that weren't provided.
- If Conversion & Retention settings are missing and no signup page was scrapable, you can still reason usefully from the DNA alone (problem, features, audience, pricing, tone are always real signal) — do so, but keep findings to what's actually inferable from that, and do not claim to know the current step count or conversion numbers.
- Set "confidence_note" to a short explanation whenever you're missing something that would have sharpened the audit (e.g. "No Conversion & Retention settings provided and the signup page wasn't reachable — findings below are based on DNA and homepage content only"). Set it to null only when you had real settings data or a scraped signup flow to work from.
- Return at most ${MAX_FINDINGS} findings, ranked most important first. If there is genuinely nothing specific and grounded to say, return an empty findings array rather than inventing generic ones — this is a real, valid outcome for a very new or very simple product, not a failure.

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "confidence_note": string | null,
  "findings": [{ "finding_type": string, "severity": "high" | "medium" | "low", "issue_description": string, "suggested_fix": string }]
}`;

export const onboardingAudit = schemaTask({
  id: "onboarding-audit",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;
    logger.info("onboarding-audit: run started", { app_id, workspace_id });

    try {
      const { data: app, error: appError } = await supabaseAdmin
        .from("apps")
        .select("dna, additional_context, source_url, app_settings, diagnosis")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appError) {
        throw new Error(`Failed to load app record: ${appError.message}`);
      }

      if (!app.dna) {
        logger.warn(`onboarding-audit: app ${app_id} has no DNA yet, skipping`, { app_id });
        return { app_id, savedCount: 0 };
      }

      const dna = app.dna as AppDna;
      const conversionRetention = parseConversionRetention(
        (app.app_settings as Record<string, unknown> | null)?.conversion_retention
      );
      const hasConversionData = hasAnyConversionRetentionData(conversionRetention);

      logger.info(
        `onboarding-audit: Conversion & Retention settings ${hasConversionData ? "provided" : "not provided"} for app ${app_id}`,
        { app_id, conversionRetention }
      );

      // STEP 2 — scrape the homepage, then any signup/get-started/pricing
      // pages discoverable from it. A failure at either stage is never
      // fatal — the audit still runs on DNA + settings alone, just with a
      // confidence_note explaining the gap (see SYSTEM_PROMPT).
      let homepageMarkdown = "";
      const scrapedPages: { url: string; markdown: string }[] = [];

      try {
        const firecrawl = createFirecrawlClient();
        const homepage = await firecrawl.scrapeUrl(app.source_url, {
          formats: ["markdown"],
          timeout: SCRAPE_TIMEOUT_MS,
        });
        if ("markdown" in homepage && homepage.markdown) {
          homepageMarkdown = homepage.markdown;
          logger.info(`onboarding-audit: homepage scraped for app ${app_id}`, {
            app_id,
            length: homepageMarkdown.length,
          });

          const candidateLinks = findRelevantLinks(homepageMarkdown, app.source_url);
          logger.info(
            `onboarding-audit: found ${candidateLinks.length} signup/onboarding-adjacent link(s) on the homepage for app ${app_id}`,
            { app_id, candidateLinks }
          );

          for (const url of candidateLinks) {
            try {
              const scraped = await firecrawl.scrapeUrl(url, {
                formats: ["markdown"],
                timeout: SCRAPE_TIMEOUT_MS,
              });
              if ("markdown" in scraped && scraped.markdown && scraped.markdown.trim().length > 40) {
                scrapedPages.push({ url, markdown: scraped.markdown });
                logger.info(`onboarding-audit: scraped signup-adjacent page for app ${app_id}: ${url}`, {
                  app_id,
                  url,
                });
              }
            } catch (err) {
              logger.warn(`onboarding-audit: failed to scrape signup-adjacent page "${url}" for app ${app_id}`, {
                app_id,
                url,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      } catch (err) {
        logger.warn(`onboarding-audit: homepage scrape failed for app ${app_id} — continuing on DNA + settings alone`, {
          app_id,
          source_url: app.source_url,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // STEP 3 — build the prompt from everything actually available.
      const settingsBlock = hasConversionData
        ? `=== CONVERSION & RETENTION (founder-provided) ===\n${JSON.stringify(conversionRetention, null, 2)}`
        : `=== CONVERSION & RETENTION ===\nNot provided by the founder yet.`;

      const scrapedBlock =
        scrapedPages.length > 0
          ? `\n\n=== SCRAPED SIGNUP/ONBOARDING-ADJACENT PAGES ===\n${scrapedPages
              .map((p) => `[${p.url}]\n${p.markdown.slice(0, 3000)}`)
              .join("\n\n---\n\n")}`
          : homepageMarkdown
            ? `\n\n=== SCRAPED HOMEPAGE (no signup/pricing links found on it) ===\n${homepageMarkdown.slice(0, 3000)}`
            : `\n\n=== SITE CONTENT ===\nThe site was not reachable/scrapable this run.`;

      const userMessage = `=== PRODUCT DNA ===\n${JSON.stringify(dna, null, 2)}\n\n${
        app.additional_context ? `=== ADDITIONAL FOUNDER CONTEXT ===\n${app.additional_context}\n\n` : ""
      }${settingsBlock}${scrapedBlock}`;

      logger.info("onboarding-audit: calling Claude", {
        app_id,
        has_scraped_pages: scrapedPages.length,
        has_conversion_data: hasConversionData,
      });

      const anthropic = createAnthropicClient();
      const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
        anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        })
      );

      let responseText = "";
      for (const block of message.content) {
        if (block.type === "text") responseText += block.text;
      }
      responseText = responseText
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "");

      let parsed: z.infer<typeof auditResponseSchema>;
      try {
        parsed = auditResponseSchema.parse(JSON.parse(responseText));
      } catch (err) {
        logger.warn("onboarding-audit: failed to parse Claude's response", {
          app_id,
          raw_response: responseText.slice(0, 2000),
          error: err instanceof Error ? err.message : String(err),
        });
        throw new Error(ErrorMessages.external.CLAUDE_FAILED);
      }

      // STEP 5 — the explicit "say so" case: logged, never turned into a
      // fabricated row in onboarding_findings.
      if (parsed.confidence_note) {
        logger.info(`onboarding-audit: low-confidence run for app ${app_id} — ${parsed.confidence_note}`, {
          app_id,
          confidence_note: parsed.confidence_note,
        });
      }

      if (parsed.findings.length === 0) {
        logger.info(`onboarding-audit: no groundable findings for app ${app_id}`, { app_id });
        return { app_id, savedCount: 0, confidence_note: parsed.confidence_note };
      }

      const findingsToSave = parsed.findings.slice(0, MAX_FINDINGS);
      if (parsed.findings.length > MAX_FINDINGS) {
        logger.info(
          `onboarding-audit: Claude returned ${parsed.findings.length} findings for app ${app_id}, saving the top ${MAX_FINDINGS}`,
          { app_id, returned: parsed.findings.length, saved: MAX_FINDINGS }
        );
      }

      const rows = findingsToSave.map((f) => ({
        app_id,
        workspace_id,
        finding_type: f.finding_type,
        severity: f.severity,
        issue_description: f.issue_description,
        suggested_fix: f.suggested_fix,
        status: "open" as const,
      }));

      const { error: insertError } = await supabaseAdmin.from("onboarding_findings").insert(rows);
      if (insertError) {
        throw new Error(`Failed to save onboarding findings: ${insertError.message}`);
      }

      logger.info(`onboarding-audit: saved ${rows.length} finding(s) for app ${app_id}`, {
        app_id,
        savedCount: rows.length,
      });

      return { app_id, savedCount: rows.length, confidence_note: parsed.confidence_note };
    } catch (err) {
      await handleJobError(err, {
        appId: app_id,
        workspaceId: workspace_id,
        jobName: "onboarding-audit",
        updateAppStatus: false,
      });
      throw err;
    }
  },
});
