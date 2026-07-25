import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { callExternalService } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { createFirecrawlClient, SCRAPE_TIMEOUT_MS } from "@/lib/firecrawl-client";
import type { AppDna } from "@/types";

const CLAUDE_MODEL = "claude-sonnet-5";
const MAX_SIGNUP_PAGES_TO_SCRAPE = 2;
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
  // successful parse — see trigger/onboarding-audit.ts and
  // trigger/churn-audit.ts for why a strict `.max(MAX_FINDINGS)` here is
  // the wrong place to enforce that limit.
  findings: z.array(findingSchema).max(20),
});

// STEP — signup/registration page discovery from the homepage's own
// markdown. Same regex-link-scan as onboarding-audit.ts's
// findRelevantLinks (this audit needs the same destination — the signup
// page — for a different reason: judging its own form/field friction, not
// whether it was findable from an activation-flow angle).
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
  "join",
];

function findSignupLinks(markdown: string, baseUrl: string): string[] {
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

// Third and last of the "Audits" family, alongside
// trigger/onboarding-audit.ts and trigger/churn-audit.ts — same
// structural pattern (see those files' comments for the full rationale),
// reasoning framework swapped for .claude/skills/cro/SKILL.md +
// .claude/skills/signup/SKILL.md combined, adapted the same way for
// autonomous, single-pass execution. Unlike the other two, this audits the
// app's OWN landing page and signup flow — the destination all the
// content this whole tool generates actually drives traffic to, never
// previously checked by anything in this codebase.
const SYSTEM_PROMPT = `You are a conversion rate optimization expert combined with a signup-flow specialist, auditing a specific software product's own homepage and signup flow — the page all of this product's marketing traffic actually lands on. You are working alone, with no human available to ask clarifying questions — reach a firm conclusion from the data given, or say plainly what's missing.

=== CORE FRAMEWORK — HOMEPAGE/LANDING PAGE (apply this reasoning, do not just restate it) ===

1. VALUE PROPOSITION CLARITY (highest impact) — can a cold visitor understand what this is and why they should care within 5 seconds, above the fold? Is it benefit-focused (not just feature-focused), specific, and in the visitor's language rather than company jargon?
2. HEADLINE EFFECTIVENESS — does it communicate the core value prop? Outcome-focused and specific beats vague or clever. ("Get [outcome] without [pain point]" beats a tagline that only makes sense once you already know what the product does.)
3. CTA PLACEMENT, COPY, AND HIERARCHY — is there one clear primary action, visible without scrolling? Weak CTA copy ("Submit," "Sign Up," "Learn More") vs. strong, value-communicating copy ("Start Free Trial," "Get My Report"). Is the CTA repeated at key decision points, or only once/buried?
4. VISUAL HIERARCHY AND SCANNABILITY — can someone scanning (not reading) get the main message? Are the most important elements visually prominent?
5. TRUST SIGNALS AND SOCIAL PROOF — customer logos, testimonials (specific, attributed), case study numbers, review counts. Their absence entirely — especially near the CTA — is a real, common gap worth flagging, not just their weakness.
6. OBJECTION HANDLING — does the page address the obvious objections for this specific product (price/value, "will this work for my situation," implementation difficulty)?
7. FRICTION POINTS — anything that adds unclear next steps or unnecessary complexity before the visitor can act.

=== CORE FRAMEWORK — SIGNUP/REGISTRATION FLOW (if a signup page was reachable) ===

1. MINIMIZE REQUIRED FIELDS — for every field on the form, ask whether it's genuinely essential before first use (email/password), often needed but deferrable (name), or usually should be deferred entirely (company, role, team size, phone). More than ~3-4 fields on a single step is a real, common conversion cost.
2. SHOW VALUE BEFORE ASKING FOR COMMITMENT — can the visitor experience/see real value before creating an account, or is signup the very first ask?
3. REDUCE PERCEIVED EFFORT — progress indication if multi-step, grouped related fields, smart defaults.
4. REMOVE UNCERTAINTY — clear expectations ("takes 30 seconds"), no surprise steps, no hidden requirements revealed only after starting.
5. TRUST AT THE FORM LEVEL — "no credit card required" (if true), free-trial/free-forever framing, a privacy note. Their absence right at the point of commitment is a real gap.
6. SINGLE-STEP VS. MULTI-STEP — single-step fits 3 or fewer fields and simple/high-intent visitors; more fields without any multi-step structure or progress indication is itself a friction point.

=== OUTPUT FORMAT ===

For each issue: Issue → Impact → Fix → Priority. Concretely:
- "issue_description" = the Issue + its Impact, grounded in a real, specific detail actually seen on the scraped page(s) or in the DNA (an actual headline, an actual list of form fields present, an actual CTA button label, the actual absence of any testimonial/logo section on the page you were given) — never a generic statement that could apply to any landing page.
- "suggested_fix" = the Fix — concrete and actionable (name the actual copy/element to add or change), not vague advice like "improve the page."
- "severity" = the Priority: "high" (directly blocks or badly obscures the primary conversion action — e.g. no visible CTA, no clear value prop above the fold, a signup form that's actually broken/absent), "medium" (a real, specific gap — e.g. no social proof, too many fields), "low" (polish).
- "finding_type" = a short snake_case label (e.g. "too_many_signup_fields", "unclear_value_proposition", "no_social_proof", "weak_or_buried_cta", "no_trust_signal_at_signup").

=== DATA YOU ARE GIVEN ===

You'll receive this product's DNA (name, tagline, problem, features, target audience, pricing, tone), any founder-provided additional context, and — if reachable — real scraped markdown content from the homepage and, if a signup/get-started link was discoverable from it, the signup page itself.

=== RULES ===

- Every finding must cite something actually present (or actually absent) in the scraped content or DNA you were given — do not invent page copy, form fields, or layout details that weren't shown to you.
- If no signup page was reachable, you can still fully audit the homepage against the CRO framework above — that alone is a complete, valid audit. Note in "confidence_note" that the signup flow itself couldn't be assessed, rather than guessing at its field count or structure.
- If the homepage itself wasn't reachable/scrapable, reason only from the DNA (tagline, problem, features, target audience) about what a strong value proposition and CTA for this product should look like — set "confidence_note" accordingly, and keep findings general enough to still be grounded in the DNA rather than inventing page details.
- Return at most ${MAX_FINDINGS} findings, ranked most important first (value proposition and CTA issues before polish-level ones, per the framework's own stated order of impact). If the page is genuinely already strong on a dimension, don't invent a finding for it just to fill the list — an empty or short findings array is a valid, real outcome.

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "confidence_note": string | null,
  "findings": [{ "finding_type": string, "severity": "high" | "medium" | "low", "issue_description": string, "suggested_fix": string }]
}`;

export const croAudit = schemaTask({
  id: "cro-audit",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;
    logger.info("cro-audit: run started", { app_id, workspace_id });

    try {
      const { data: app, error: appError } = await supabaseAdmin
        .from("apps")
        .select("dna, additional_context, source_url")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appError) {
        throw new Error(`Failed to load app record: ${appError.message}`);
      }

      if (!app.dna) {
        logger.warn(`cro-audit: app ${app_id} has no DNA yet, skipping`, { app_id });
        return { app_id, savedCount: 0 };
      }

      const dna = app.dna as AppDna;

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
          logger.info(`cro-audit: homepage scraped for app ${app_id}`, {
            app_id,
            length: homepageMarkdown.length,
          });

          const candidateLinks = findSignupLinks(homepageMarkdown, app.source_url);
          logger.info(
            `cro-audit: found ${candidateLinks.length} signup-adjacent link(s) on the homepage for app ${app_id}`,
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
                logger.info(`cro-audit: scraped signup page for app ${app_id}: ${url}`, {
                  app_id,
                  url,
                });
              }
            } catch (err) {
              logger.warn(`cro-audit: failed to scrape signup page "${url}" for app ${app_id}`, {
                app_id,
                url,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      } catch (err) {
        logger.warn(`cro-audit: homepage scrape failed for app ${app_id} — continuing on DNA alone`, {
          app_id,
          source_url: app.source_url,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const homepageBlock = homepageMarkdown
        ? `=== SCRAPED HOMEPAGE ===\n${homepageMarkdown.slice(0, 4000)}`
        : `=== HOMEPAGE ===\nNot reachable/scrapable this run.`;

      const signupBlock =
        scrapedPages.length > 0
          ? `\n\n=== SCRAPED SIGNUP PAGE(S) ===\n${scrapedPages
              .map((p) => `[${p.url}]\n${p.markdown.slice(0, 3000)}`)
              .join("\n\n---\n\n")}`
          : `\n\n=== SIGNUP PAGE ===\nNo signup/get-started link was discoverable from the homepage — this run only audits the homepage itself, not the signup flow.`;

      const userMessage = `=== PRODUCT DNA ===\n${JSON.stringify(dna, null, 2)}\n\n${
        app.additional_context ? `=== ADDITIONAL FOUNDER CONTEXT ===\n${app.additional_context}\n\n` : ""
      }${homepageBlock}${signupBlock}`;

      logger.info("cro-audit: calling Claude", {
        app_id,
        has_homepage: !!homepageMarkdown,
        has_signup_page: scrapedPages.length > 0,
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
        logger.warn("cro-audit: failed to parse Claude's response", {
          app_id,
          raw_response: responseText.slice(0, 2000),
          error: err instanceof Error ? err.message : String(err),
        });
        throw new Error(ErrorMessages.external.CLAUDE_FAILED);
      }

      if (parsed.confidence_note) {
        logger.info(`cro-audit: low-confidence run for app ${app_id} — ${parsed.confidence_note}`, {
          app_id,
          confidence_note: parsed.confidence_note,
        });
      }

      if (parsed.findings.length === 0) {
        logger.info(`cro-audit: no groundable findings for app ${app_id}`, { app_id });
        return { app_id, savedCount: 0, confidence_note: parsed.confidence_note };
      }

      const findingsToSave = parsed.findings.slice(0, MAX_FINDINGS);
      if (parsed.findings.length > MAX_FINDINGS) {
        logger.info(
          `cro-audit: Claude returned ${parsed.findings.length} findings for app ${app_id}, saving the top ${MAX_FINDINGS}`,
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

      const { error: insertError } = await supabaseAdmin.from("cro_findings").insert(rows);
      if (insertError) {
        throw new Error(`Failed to save cro findings: ${insertError.message}`);
      }

      logger.info(`cro-audit: saved ${rows.length} finding(s) for app ${app_id}`, {
        app_id,
        savedCount: rows.length,
      });

      return { app_id, savedCount: rows.length, confidence_note: parsed.confidence_note };
    } catch (err) {
      await handleJobError(err, {
        appId: app_id,
        workspaceId: workspace_id,
        jobName: "cro-audit",
        updateAppStatus: false,
      });
      throw err;
    }
  },
});
