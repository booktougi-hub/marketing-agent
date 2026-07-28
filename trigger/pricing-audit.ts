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
const MAX_PRICING_PAGES_TO_SCRAPE = 2;
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
  // successful parse — see trigger/onboarding-audit.ts and siblings for
  // why a strict `.max(MAX_FINDINGS)` here is the wrong place to enforce
  // that limit.
  findings: z.array(findingSchema).max(20),
});

// STEP — pricing page discovery from the homepage's own markdown. Same
// regex-link-scan as the sibling audits, this one narrowed to pricing/
// plans specifically (not the broader billing/account set churn-audit
// uses — this audit cares about the tier-comparison page itself, not the
// account-management side of billing).
const PRICING_LINK_KEYWORDS = ["pricing", "plans", "price"];

function findPricingLinks(markdown: string, baseUrl: string): string[] {
  const linkPattern = /\[([^\]]*)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/gi;
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of markdown.matchAll(linkPattern)) {
    const linkText = match[1].toLowerCase();
    const rawUrl = match[2];
    const isRelevant = PRICING_LINK_KEYWORDS.some(
      (kw) => linkText.includes(kw) || rawUrl.toLowerCase().includes(kw)
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

  return urls.slice(0, MAX_PRICING_PAGES_TO_SCRAPE);
}

interface CompetitorPricingRow {
  competitor_name: string | null;
  pricing_notes: string | null;
  positioning_notes: string | null;
}

// Fourth of the "Audits" family, alongside trigger/onboarding-audit.ts,
// trigger/churn-audit.ts, and trigger/cro-audit.ts — same structural
// pattern, reasoning framework swapped for .claude/skills/pricing/SKILL.md.
// Distinct from the other three in what it reads: real competitor pricing
// already gathered by trigger/competitor-research.ts during onboarding
// (see SCHEMA.md's competitor_research table), not just this app's own
// DNA/settings/scrape. This audits the END USER'S app's pricing — the
// revenue-growth half of this tool's purpose, not the awareness half the
// other three audits (and most of the rest of the codebase) focus on.
const SYSTEM_PROMPT = `You are an expert in SaaS pricing and monetization strategy, auditing a specific software product's pricing and packaging. You are working alone, with no human available to ask clarifying questions — reach a firm conclusion from the data given, or say plainly what's missing.

=== CORE FRAMEWORK (apply this reasoning, do not just restate it) ===

1. THE THREE PRICING AXES — Packaging (what's included at each tier and how tiers differ), Pricing Metric (what is actually charged for — per user, per usage, flat fee — and whether it scales with the value the customer receives), and Price Point (the actual dollar amounts, judged against perceived value). Weakness in any one of these three is worth flagging distinctly — a product can have a fine price point but a broken value metric, or vice versa.
2. VALUE-BASED PRICING — price should sit between the next-best alternative (the floor for differentiation) and the customer's perceived value (the ceiling), not be derived from cost-to-serve. When real competitor pricing is available, use it as the actual floor/anchor for this comparison — not a guess.
3. VALUE METRIC FIT — ask "as a customer uses more of [whatever they're charged for], do they get more value?" A metric that doesn't scale with value (or is easy to game) is a real structural pricing problem, not a copy issue.
4. GOOD-BETTER-BEST TIER STRUCTURE — Good (entry, core features, limited usage), Better (the recommended anchor tier, full features, reasonable limits), Best (everything, 2-3x Better's price). Tiers should differentiate via feature gating, usage limits, support level, or access (API/SSO/custom branding) — not be vague or overlapping.
5. PRICING PSYCHOLOGY — anchoring (show the higher-priced option first/prominently), the decoy effect (the middle tier should read as obviously the best value), charm pricing ($49 vs $50, for value-focused positioning) vs. round pricing ($50 vs $49, for premium positioning). Judge whether the product's actual pricing presentation uses any of this deliberately or leaves value/anchoring to chance.
6. PRICING PAGE BEST PRACTICES (if a pricing page was scraped) — clear tier comparison table, a visually recommended/highlighted tier, an annual discount callout (typically 17-20% off), FAQ addressing pricing objections, trust signals near the CTA.
7. SIGNALS IT'S TIME TO RAISE PRICES — a known_signup_conversion_rate above ~40% or a known_churn_rate below ~3% monthly are classic signals prices may be underpriced relative to perceived value; conversely, a churn rate driven by price objections points the other way. Only reason about this when real numbers were actually given — never invent a conversion or churn rate.

=== OUTPUT FORMAT ===

For each issue: Finding → Impact → Recommendation → Priority. Concretely:
- "issue_description" = the specific Finding + its Impact, grounded in a real, specific detail — this product's actual DNA pricing text, actual scraped pricing-page content, an actual competitor's actual pricing/positioning from the data given, or an actual known_signup_conversion_rate/known_churn_rate value.
- "suggested_fix" = the Recommendation — concrete and actionable (name an actual tier, price point, or feature to add/change/clarify), not vague advice like "reconsider your pricing."
- "severity" = the Priority: "high" (a structural gap — e.g. no visible pricing at all for a product that should have it, a price point wildly out of line with verified competitor pricing, a value metric that doesn't scale with value at all), "medium" (a real, specific gap — e.g. unclear tier differentiation, no annual discount, missing a tier competitors have), "low" (psychology/presentation polish).
- "finding_type" = a short snake_case label (e.g. "pricing_tier_gap_vs_competitors", "unclear_tier_differentiation", "price_audience_mismatch", "weak_tier_anchoring", "no_pricing_page").

=== DATA YOU ARE GIVEN ===

You'll receive this product's DNA (name, tagline, problem, features, target audience, pricing, tone), any founder-provided additional context, real competitor pricing/positioning notes already gathered for this specific app's actual named competitors (when any exist), any Conversion & Retention numbers the founder has filled in — known_signup_conversion_rate and known_churn_rate are the most directly relevant here — and, if reachable, real scraped content from the homepage and (if a pricing/plans link was discoverable from it) the pricing page itself.

=== RULES ===

- Every finding must cite a specific, real detail from what you were actually given — do not invent a competitor's price, a tier name, or a conversion/churn number that wasn't provided.
- Competitor pricing comparison is only as strong as the data given — if no competitor pricing_notes exist for this app, say so in "confidence_note" and reason from the pricing skill's general frameworks (value-based pricing, tier structure, value metric fit) against this product's own DNA and target audience instead, rather than inventing a competitive comparison.
- A genuinely free product with no pricing model at all has real, valid things to say (e.g. is a future paid tier signaled anywhere? does the target audience in DNA suggest willingness to pay that isn't being captured?) but should not be audited as if a tier structure exists when one doesn't.
- Return at most ${MAX_FINDINGS} findings, ranked most important first. If there is genuinely nothing specific and grounded to say, return an empty findings array rather than inventing generic ones — this is a real, valid outcome, not a failure.

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "confidence_note": string | null,
  "findings": [{ "finding_type": string, "severity": "high" | "medium" | "low", "issue_description": string, "suggested_fix": string }]
}`;

export const pricingAudit = schemaTask({
  id: "pricing-audit",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;
    logger.info("pricing-audit: run started", { app_id, workspace_id });

    try {
      const [{ data: app, error: appError }, { data: competitorRows, error: competitorError }] =
        await Promise.all([
          supabaseAdmin
            .from("apps")
            .select("dna, additional_context, source_url, app_settings")
            .eq("id", app_id)
            .eq("workspace_id", workspace_id)
            .single(),
          supabaseAdmin
            .from("competitor_research")
            .select("competitor_name, pricing_notes, positioning_notes")
            .eq("app_id", app_id)
            .eq("workspace_id", workspace_id),
        ]);

      if (appError) {
        throw new Error(`Failed to load app record: ${appError.message}`);
      }
      if (competitorError) {
        throw new Error(`Failed to load competitor research: ${competitorError.message}`);
      }

      if (!app.dna) {
        logger.warn(`pricing-audit: app ${app_id} has no DNA yet, skipping`, { app_id });
        return { app_id, savedCount: 0 };
      }

      const dna = app.dna as AppDna;
      const competitors = (competitorRows ?? []) as CompetitorPricingRow[];
      const conversionRetention = parseConversionRetention(
        (app.app_settings as Record<string, unknown> | null)?.conversion_retention
      );
      const hasConversionData = hasAnyConversionRetentionData(conversionRetention);

      logger.info(
        `pricing-audit: ${competitors.length} competitor(s) with pricing data for app ${app_id}, Conversion & Retention settings ${hasConversionData ? "provided" : "not provided"}`,
        { app_id, competitorCount: competitors.length, conversionRetention }
      );

      let homepageMarkdown = "";
      const scrapedPricingPages: { url: string; markdown: string }[] = [];

      try {
        const firecrawl = createFirecrawlClient();
        const homepage = await firecrawl.scrapeUrl(app.source_url, {
          formats: ["markdown"],
          timeout: SCRAPE_TIMEOUT_MS,
        });
        if ("markdown" in homepage && homepage.markdown) {
          homepageMarkdown = homepage.markdown;
          logger.info(`pricing-audit: homepage scraped for app ${app_id}`, {
            app_id,
            length: homepageMarkdown.length,
          });

          const candidateLinks = findPricingLinks(homepageMarkdown, app.source_url);
          logger.info(
            `pricing-audit: found ${candidateLinks.length} pricing-adjacent link(s) on the homepage for app ${app_id}`,
            { app_id, candidateLinks }
          );

          for (const url of candidateLinks) {
            try {
              const scraped = await firecrawl.scrapeUrl(url, {
                formats: ["markdown"],
                timeout: SCRAPE_TIMEOUT_MS,
              });
              if ("markdown" in scraped && scraped.markdown && scraped.markdown.trim().length > 40) {
                scrapedPricingPages.push({ url, markdown: scraped.markdown });
                logger.info(`pricing-audit: scraped pricing page for app ${app_id}: ${url}`, {
                  app_id,
                  url,
                });
              }
            } catch (err) {
              logger.warn(`pricing-audit: failed to scrape pricing page "${url}" for app ${app_id}`, {
                app_id,
                url,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      } catch (err) {
        logger.warn(`pricing-audit: homepage scrape failed for app ${app_id} — continuing on DNA + competitor data alone`, {
          app_id,
          source_url: app.source_url,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const competitorBlock =
        competitors.length > 0
          ? `=== REAL COMPETITOR PRICING/POSITIONING (already gathered for this app's actual competitors) ===\n${competitors
              .map(
                (c) =>
                  `- ${c.competitor_name ?? "Unknown"}: pricing — ${c.pricing_notes ?? "not captured"}; positioning — ${c.positioning_notes ?? "not captured"}`
              )
              .join("\n")}`
          : `=== COMPETITOR PRICING ===\nNo competitor research data exists for this app yet.`;

      const settingsBlock = hasConversionData
        ? `=== CONVERSION & RETENTION (founder-provided) ===\n${JSON.stringify(conversionRetention, null, 2)}`
        : `=== CONVERSION & RETENTION ===\nNot provided by the founder yet.`;

      const pricingPageBlock =
        scrapedPricingPages.length > 0
          ? `\n\n=== SCRAPED PRICING PAGE(S) ===\n${scrapedPricingPages
              .map((p) => `[${p.url}]\n${p.markdown.slice(0, 3000)}`)
              .join("\n\n---\n\n")}`
          : homepageMarkdown
            ? `\n\n=== SCRAPED HOMEPAGE (no dedicated pricing page found) ===\n${homepageMarkdown.slice(0, 3000)}`
            : `\n\n=== SITE CONTENT ===\nThe site was not reachable/scrapable this run.`;

      const userMessage = `=== PRODUCT DNA ===\n${JSON.stringify(dna, null, 2)}\n\n${
        app.additional_context ? `=== ADDITIONAL FOUNDER CONTEXT ===\n${app.additional_context}\n\n` : ""
      }${competitorBlock}\n\n${settingsBlock}${pricingPageBlock}`;

      logger.info("pricing-audit: calling Claude", {
        app_id,
        has_pricing_page: scrapedPricingPages.length > 0,
        has_competitor_data: competitors.length > 0,
        has_conversion_data: hasConversionData,
      });

      const anthropic = createAnthropicClient();
      const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
        anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          // SYSTEM_PROMPT is fully static (no per-app interpolation) and
          // identical across every app a scan touches — caching it means a
          // monthly-pricing-scan.ts batch run only pays the full system-
          // prompt cost once per ~5min window, not once per app.
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
        logger.warn("pricing-audit: failed to parse Claude's response", {
          app_id,
          raw_response: responseText.slice(0, 2000),
          error: err instanceof Error ? err.message : String(err),
        });
        throw new Error(ErrorMessages.external.CLAUDE_FAILED);
      }

      if (parsed.confidence_note) {
        logger.info(`pricing-audit: low-confidence run for app ${app_id} — ${parsed.confidence_note}`, {
          app_id,
          confidence_note: parsed.confidence_note,
        });
      }

      if (parsed.findings.length === 0) {
        logger.info(`pricing-audit: no groundable findings for app ${app_id}`, { app_id });
        return { app_id, savedCount: 0, confidence_note: parsed.confidence_note };
      }

      const findingsToSave = parsed.findings.slice(0, MAX_FINDINGS);
      if (parsed.findings.length > MAX_FINDINGS) {
        logger.info(
          `pricing-audit: Claude returned ${parsed.findings.length} findings for app ${app_id}, saving the top ${MAX_FINDINGS}`,
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

      const { error: insertError } = await supabaseAdmin.from("pricing_findings").insert(rows);
      if (insertError) {
        throw new Error(`Failed to save pricing findings: ${insertError.message}`);
      }

      logger.info(`pricing-audit: saved ${rows.length} finding(s) for app ${app_id}`, {
        app_id,
        savedCount: rows.length,
      });

      return { app_id, savedCount: rows.length, confidence_note: parsed.confidence_note };
    } catch (err) {
      await handleJobError(err, {
        appId: app_id,
        workspaceId: workspace_id,
        jobName: "pricing-audit",
        updateAppStatus: false,
      });
      throw err;
    }
  },
});
