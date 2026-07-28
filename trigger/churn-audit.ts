import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { callExternalService } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";
import { hasAnyConversionRetentionData, parseConversionRetention } from "@/lib/app-settings";
import { MODELS } from "@/lib/ai/models";
import type { AppDna } from "@/types";

const CLAUDE_MODEL: string = MODELS.STANDARD;
const MAX_BILLING_PAGES_TO_SCRAPE = 3;
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
  confidence_note: z.string().nullable(),
  // Generous parse ceiling, trimmed to MAX_FINDINGS in code after a
  // successful parse — same fix trigger/onboarding-audit.ts needed after a
  // strict `.max(MAX_FINDINGS)` here turned "Claude found 9 real issues"
  // into an indistinguishable-from-malformed parse failure.
  findings: z.array(findingSchema).max(20),
});

// STEP — pricing/billing/cancel-adjacent page discovery from the
// homepage's own markdown, same regex-link-scan as onboarding-audit.ts's
// findRelevantLinks, generalized to this audit's own keyword set.
const BILLING_LINK_KEYWORDS = [
  "pricing",
  "plans",
  "billing",
  "subscription",
  "account",
  "cancel",
  "upgrade",
  "downgrade",
  "manage plan",
];

function findRelevantLinks(markdown: string, baseUrl: string): string[] {
  const linkPattern = /\[([^\]]*)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/gi;
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of markdown.matchAll(linkPattern)) {
    const linkText = match[1].toLowerCase();
    const rawUrl = match[2];
    const isRelevant = BILLING_LINK_KEYWORDS.some(
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

  return urls.slice(0, MAX_BILLING_PAGES_TO_SCRAPE);
}

// Second of the "Audits" family, alongside trigger/onboarding-audit.ts —
// same structural pattern (see that file's comments for the full
// rationale), reasoning framework swapped for .claude/skills/
// churn-prevention/SKILL.md instead, adapted the same way for autonomous,
// single-pass execution (that skill's "Before Starting" section assumes an
// interactive intake conversation; here every question it would ask
// becomes either real data or an explicit confidence_note gap).
const SYSTEM_PROMPT = `You are an expert in SaaS retention and churn prevention, auditing a specific software product's cancellation flow, save-offer strategy, and payment-failure recovery. You are working alone, with no human available to ask clarifying questions — reach a firm conclusion from the data given, or say plainly what's missing.

=== CORE FRAMEWORK (apply this reasoning, do not just restate it) ===

1. CANCEL FLOW STRUCTURE — the ideal flow is Trigger → Exit Survey → Dynamic Save Offer → Confirmation → Post-Cancel. Judge what's inferable about this product's actual flow (or its absence) against that structure. No cancel flow at all (instant cancel) is a real, common, costly gap — even a simple survey + one offer typically saves 10-15% of cancellations.
2. SAVE OFFERS MUST MATCH THE CANCEL REASON — a blanket discount doesn't help someone who isn't using the product (they need a pause, not a price cut); someone who can't afford it needs a discount or downgrade, not a feature roadmap. If a product's pricing/plan structure gives no route to a downgrade, a pause, or a lower tier, that's a real gap regardless of whether any cancel-flow copy was seen.
3. DISCOUNT DEPTH — 20-30% off for 2-3 months is the effective range; 50%+ discounts train customers to cancel-and-return for deals. If pricing signals suggest heavy/frequent discounting (e.g. permanent "launch pricing," stacked coupons), flag it.
4. INVOLUNTARY CHURN (failed payments) — often 30-50% of total churn and the easiest to fix, but frequently ignored entirely. The full stack is Pre-dunning (card expiry alerts, backup payment method) → Smart retry (soft declines retried 3-5x over 7-10 days; hard declines are not retried) → Dunning emails (typically 4, escalating over ~10 days) → Grace period → Hard cancel. A subscription billing product that mentions Stripe/billing/subscriptions in its DNA but gives no signal of any retry/dunning strategy is a real, specific gap to flag — most billing providers (Stripe, Chargebee, Paddle, Recurly) have this built in, so the more notable finding is often "no evidence this was configured/considered," not "needs custom retry logic built from scratch."
5. PAYWALL FRICTION — upgrade prompts that block value entirely (a hard wall with no preview, trial, or clear value-per-tier explanation) drive churn. Judge whether the pricing/plan structure as described gives a user a clear, ungated reason to stay on a paid tier vs. feeling walled off.
6. COMMON MISTAKES TO CHECK FOR — hidden/hard-to-find cancellation (many jurisdictions now require easy self-serve cancellation — the FTC's Click-to-Cancel rule in the US), guilt-trip cancellation copy, no post-cancel reactivation path, pauses offered with no time limit (pauses beyond ~3 months rarely reactivate).

=== OUTPUT FORMAT ===

For each issue: Finding → Impact → Recommendation → Priority. Concretely:
- "issue_description" = the specific Finding + its Impact, grounded in a real, specific detail about THIS product (its actual pricing text, its actual plan tiers, its actual billing-related copy, or an actual known_churn_rate/trial_length_days/has_free_tier value given) — never a generic statement that could apply to any SaaS product.
- "suggested_fix" = the Recommendation — concrete and actionable (e.g. "add a pause option capped at 3 months to the cancel flow" not "improve retention").
- "severity" = the Priority: "high" (a major, common leak — e.g. no save offer at all, no dunning on a paid subscription product), "medium" (a real but narrower gap), "low" (polish/best-practice).
- "finding_type" = a short snake_case label (e.g. "no_cancel_flow_save_offer", "no_dunning_retry_implied", "paywall_friction", "missing_pause_option", "hidden_cancellation", "no_post_cancel_path").

=== DATA YOU ARE GIVEN ===

You'll receive this product's DNA (name, tagline, problem, features, target audience, pricing, tone), any founder-provided additional context, any Conversion & Retention numbers the founder has filled in — known_churn_rate is the most directly relevant here, but trial_length_days and has_free_tier also shape what a healthy cancel/downgrade path should look like — and, if reachable, real scraped content from the homepage and any pricing/billing/account/cancel pages discovered from it.

=== RULES ===

- Every finding must cite a specific, real detail from what you were actually given — do not invent a churn rate, a specific cancel-flow UI, or dunning behavior that wasn't described or shown.
- A product with no visible billing/subscription model at all (e.g. genuinely free, no accounts) has little to say about cancel flows or dunning — reason about what genuinely applies to THIS product's actual model, don't force a SaaS-billing framework onto a free tool.
- Set "confidence_note" to a short explanation whenever something that would have sharpened the audit is missing (e.g. no known_churn_rate provided, no pricing/account page reachable). Set it to null only when you had real settings data or scraped pricing/billing content to work from.
- Return at most ${MAX_FINDINGS} findings, ranked most important first. If there is genuinely nothing specific and grounded to say (e.g. no billing model exists), return an empty findings array rather than inventing generic ones — this is a real, valid outcome, not a failure.

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "confidence_note": string | null,
  "findings": [{ "finding_type": string, "severity": "high" | "medium" | "low", "issue_description": string, "suggested_fix": string }]
}`;

export const churnAudit = schemaTask({
  id: "churn-audit",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;
    logger.info("churn-audit: run started", { app_id, workspace_id });

    try {
      const { data: app, error: appError } = await supabaseAdmin
        .from("apps")
        .select("dna, additional_context, source_url, app_settings")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appError) {
        throw new Error(`Failed to load app record: ${appError.message}`);
      }

      if (!app.dna) {
        logger.warn(`churn-audit: app ${app_id} has no DNA yet, skipping`, { app_id });
        return { app_id, savedCount: 0 };
      }

      const dna = app.dna as AppDna;
      const conversionRetention = parseConversionRetention(
        (app.app_settings as Record<string, unknown> | null)?.conversion_retention
      );
      const hasConversionData = hasAnyConversionRetentionData(conversionRetention);

      logger.info(
        `churn-audit: Conversion & Retention settings ${hasConversionData ? "provided" : "not provided"} for app ${app_id}`,
        { app_id, conversionRetention }
      );

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
          logger.info(`churn-audit: homepage scraped for app ${app_id}`, {
            app_id,
            length: homepageMarkdown.length,
          });

          const candidateLinks = findRelevantLinks(homepageMarkdown, app.source_url);
          logger.info(
            `churn-audit: found ${candidateLinks.length} pricing/billing-adjacent link(s) on the homepage for app ${app_id}`,
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
                logger.info(`churn-audit: scraped billing-adjacent page for app ${app_id}: ${url}`, {
                  app_id,
                  url,
                });
              }
            } catch (err) {
              logger.warn(`churn-audit: failed to scrape billing-adjacent page "${url}" for app ${app_id}`, {
                app_id,
                url,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      } catch (err) {
        logger.warn(`churn-audit: homepage scrape failed for app ${app_id} — continuing on DNA + settings alone`, {
          app_id,
          source_url: app.source_url,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const settingsBlock = hasConversionData
        ? `=== CONVERSION & RETENTION (founder-provided) ===\n${JSON.stringify(conversionRetention, null, 2)}`
        : `=== CONVERSION & RETENTION ===\nNot provided by the founder yet.`;

      const scrapedBlock =
        scrapedPages.length > 0
          ? `\n\n=== SCRAPED PRICING/BILLING/ACCOUNT PAGES ===\n${scrapedPages
              .map((p) => `[${p.url}]\n${p.markdown.slice(0, 3000)}`)
              .join("\n\n---\n\n")}`
          : homepageMarkdown
            ? `\n\n=== SCRAPED HOMEPAGE (no pricing/billing links found on it) ===\n${homepageMarkdown.slice(0, 3000)}`
            : `\n\n=== SITE CONTENT ===\nThe site was not reachable/scrapable this run.`;

      const userMessage = `=== PRODUCT DNA ===\n${JSON.stringify(dna, null, 2)}\n\n${
        app.additional_context ? `=== ADDITIONAL FOUNDER CONTEXT ===\n${app.additional_context}\n\n` : ""
      }${settingsBlock}${scrapedBlock}`;

      logger.info("churn-audit: calling Claude", {
        app_id,
        has_scraped_pages: scrapedPages.length,
        has_conversion_data: hasConversionData,
      });

      const anthropic = createAnthropicClient();
      const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
        anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          // SYSTEM_PROMPT is fully static — caching it means a batch scan
          // across many apps only pays the full prompt cost once per
          // ~5min window, not once per app.
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
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
        logger.warn("churn-audit: failed to parse Claude's response", {
          app_id,
          raw_response: responseText.slice(0, 2000),
          error: err instanceof Error ? err.message : String(err),
        });
        throw new Error(ErrorMessages.external.CLAUDE_FAILED);
      }

      if (parsed.confidence_note) {
        logger.info(`churn-audit: low-confidence run for app ${app_id} — ${parsed.confidence_note}`, {
          app_id,
          confidence_note: parsed.confidence_note,
        });
      }

      if (parsed.findings.length === 0) {
        logger.info(`churn-audit: no groundable findings for app ${app_id}`, { app_id });
        return { app_id, savedCount: 0, confidence_note: parsed.confidence_note };
      }

      const findingsToSave = parsed.findings.slice(0, MAX_FINDINGS);
      if (parsed.findings.length > MAX_FINDINGS) {
        logger.info(
          `churn-audit: Claude returned ${parsed.findings.length} findings for app ${app_id}, saving the top ${MAX_FINDINGS}`,
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

      const { error: insertError } = await supabaseAdmin.from("churn_findings").insert(rows);
      if (insertError) {
        throw new Error(`Failed to save churn findings: ${insertError.message}`);
      }

      logger.info(`churn-audit: saved ${rows.length} finding(s) for app ${app_id}`, {
        app_id,
        savedCount: rows.length,
      });

      return { app_id, savedCount: rows.length, confidence_note: parsed.confidence_note };
    } catch (err) {
      await handleJobError(err, {
        appId: app_id,
        workspaceId: workspace_id,
        jobName: "churn-audit",
        updateAppStatus: false,
      });
      throw err;
    }
  },
});
