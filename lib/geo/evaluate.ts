import "server-only";
import { z } from "zod";
import { logger } from "@trigger.dev/sdk";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { callExternalService } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { MODELS } from "@/lib/ai/models";
import {
  countWords,
  extractJsonLdBlocks,
  extractMarkdownHeadings,
  keywordDensity,
  type ScrapedPage,
} from "@/lib/seo/evaluate";
import type { SeoGeoCheckResultMap } from "@/types";

// Real evaluators for every GEO check in lib/geo/checkRegistry.ts, against
// SCORING.md's own definitions. Reuses lib/seo/evaluate.ts's page-parsing
// helpers (same scraped page, same markdown/rawHtml) rather than re-scraping
// — trigger/seo-geo-audit.ts scrapes the page once and passes the same
// ScrapedPage into both the SEO and GEO evaluators.

function pass(value: unknown, ok: boolean, confidence = 0.9): { pass: boolean; value: unknown; confidence: number; measurable: true } {
  return { pass: ok, value, confidence, measurable: true };
}

function notMeasurable(reason: string): { pass: null; value: unknown; confidence: number; measurable: false } {
  return { pass: null, value: reason, confidence: 0, measurable: false };
}

// --- LLM content + structure checks --------------------------------------
// Prompt transcribed verbatim from SCORING.md's "LLM call specification for
// GEO content checks" — one call per page, all seven LLM-judged checks in a
// single structured response, per that section's explicit cost guidance.

const CLAUDE_MODEL: string = MODELS.STANDARD;

const geoLlmResponseSchema = z.object({
  answer_first: z.object({ pass: z.boolean(), location: z.string().nullable(), confidence: z.number() }),
  entity_clear: z.object({ pass: z.boolean(), location: z.string().nullable(), confidence: z.number() }),
  statistics: z.object({ pass: z.boolean(), examples: z.array(z.string()), confidence: z.number() }),
  citations: z.object({ pass: z.boolean(), examples: z.array(z.string()), confidence: z.number() }),
  quotation: z.object({ pass: z.boolean(), examples: z.array(z.string()), confidence: z.number() }),
  standalone_chunks: z.object({ pass: z.boolean(), weak_sections: z.array(z.string()), confidence: z.number() }),
  fluency: z.object({ pass: z.boolean(), issues: z.array(z.string()), confidence: z.number() }),
  // keyword_stuffing is part of the documented response shape, but scored
  // via the deterministic keywordDensity() rule check below instead (see
  // evaluateGeoRuleChecks) — the check registry marks
  // geo.penalty.keyword_stuffing as evaluator: "rule", and a density
  // calculation is cheap and exact, so there's no reason to trust the LLM's
  // own guess for something this mechanical. Still requested so the prompt
  // stays byte-identical to SCORING.md's spec.
  keyword_stuffing: z.object({ triggered: z.boolean(), offending_term: z.string().nullable() }),
});

function buildGeoEvalPrompt(content: string, additionalContext: string | null): string {
  // additionalContext folded in the same way every other LLM job in this
  // codebase reads apps.additional_context (see the comment on
  // app/api/apps/[id]/seo-findings/[findingId]/feedback/route.ts, which
  // specifically anticipated this) — appended after SCORING.md's prompt
  // rather than altering its wording, so founder-provided context (product
  // facts, prior audit feedback) can inform judgment calls like
  // entity_clear or statistics without changing the documented prompt body.
  const contextBlock = additionalContext
    ? `\n\nAdditional context from the founder, which may help you judge these checks accurately:\n<context>\n${additionalContext}\n</context>`
    : "";

  return `You are evaluating a piece of content for generative engine optimisation signals.
Return ONLY valid JSON — no preamble, no markdown fences.

Content to evaluate:
<content>
${content}
</content>${contextBlock}

Evaluate each of the following and return a JSON object with this exact shape:
{
  "answer_first": { "pass": boolean, "location": "first sentence text if pass, else null", "confidence": 0.0-1.0 },
  "entity_clear": { "pass": boolean, "location": "the entity statement if found, else null", "confidence": 0.0-1.0 },
  "statistics": { "pass": boolean, "examples": ["stat 1", "stat 2"], "confidence": 0.0-1.0 },
  "citations": { "pass": boolean, "examples": ["source 1"], "confidence": 0.0-1.0 },
  "quotation": { "pass": boolean, "examples": ["quote excerpt"], "confidence": 0.0-1.0 },
  "standalone_chunks": { "pass": boolean, "weak_sections": ["H2 heading of any section that isn't standalone"], "confidence": 0.0-1.0 },
  "fluency": { "pass": boolean, "issues": ["specific fluency problem if any"], "confidence": 0.0-1.0 },
  "keyword_stuffing": { "triggered": boolean, "offending_term": "term if triggered, else null" }
}

Rules:
- "location" fields must be the actual text from the content, not a description of it
- Confidence 0.9+ = very clear; 0.5-0.89 = judgment call; below 0.5 = uncertain
- For statistics: only pass if the stat is specific and verifiable (a number, a percentage, a named study). Vague claims like "many users" do not count.
- For citations: only pass if an external source is named or linked. Self-referential links do not count.`;
}

export async function evaluateGeoLlmChecks(
  scraped: ScrapedPage,
  additionalContext: string | null
): Promise<SeoGeoCheckResultMap> {
  const anthropic = createAnthropicClient();
  const prompt = buildGeoEvalPrompt(scraped.markdown, additionalContext);

  const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
    anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: "You are a precise content evaluator. Respond with only the requested JSON object, nothing else.",
      messages: [{ role: "user", content: prompt }],
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

  let parsed: z.infer<typeof geoLlmResponseSchema>;
  try {
    parsed = geoLlmResponseSchema.parse(JSON.parse(responseText));
  } catch (err) {
    logger.warn("evaluateGeoLlmChecks: failed to parse Claude's response as the expected JSON shape", {
      error: err instanceof Error ? err.message : String(err),
      rawText: responseText.slice(0, 500),
    });
    return {};
  }

  return {
    "geo.content.answer_first": pass({ location: parsed.answer_first.location }, parsed.answer_first.pass, parsed.answer_first.confidence),
    "geo.content.entity_clear": pass({ location: parsed.entity_clear.location }, parsed.entity_clear.pass, parsed.entity_clear.confidence),
    "geo.content.statistics": pass({ examples: parsed.statistics.examples }, parsed.statistics.pass, parsed.statistics.confidence),
    "geo.content.citations": pass({ examples: parsed.citations.examples }, parsed.citations.pass, parsed.citations.confidence),
    "geo.content.quotation": pass({ examples: parsed.quotation.examples }, parsed.quotation.pass, parsed.quotation.confidence),
    "geo.structure.standalone_chunks": pass({ weakSections: parsed.standalone_chunks.weak_sections }, parsed.standalone_chunks.pass, parsed.standalone_chunks.confidence),
    "geo.structure.fluency": pass({ issues: parsed.fluency.issues }, parsed.fluency.pass, parsed.fluency.confidence),
  };
}

// --- Rule-based structure + freshness checks ------------------------------

const FAQ_HEADING_PATTERN = /frequently asked questions|^faq$/i;

function hasFaqSection(markdown: string): boolean {
  const headings = extractMarkdownHeadings(markdown);
  const faqHeadingIndex = headings.findIndex((h) => FAQ_HEADING_PATTERN.test(h.text));
  if (faqHeadingIndex === -1) return false;

  // At least 2 question-style lines (ending in "?") between this heading
  // and the next same-or-higher-level heading counts as real Q&A content,
  // not just a heading that says "FAQ" with nothing under it.
  const faqHeading = headings[faqHeadingIndex];
  const nextSameLevel = headings
    .slice(faqHeadingIndex + 1)
    .find((h) => h.level <= faqHeading.level);
  const startIdx = markdown.indexOf(faqHeading.text);
  const endIdx = nextSameLevel ? markdown.indexOf(nextSameLevel.text, startIdx + faqHeading.text.length) : markdown.length;
  const section = startIdx >= 0 ? markdown.slice(startIdx, endIdx >= 0 ? endIdx : undefined) : "";
  const questionLines = section.split("\n").filter((line) => line.trim().endsWith("?"));
  return questionLines.length >= 2;
}

// Looks for a machine-readable "last updated" signal — JSON-LD
// dateModified/datePublished first (most reliable when present), falling
// back to common OpenGraph/article meta tags. Returns null (not a fabricated
// date) when neither is found — the caller marks the freshness checks
// not_measurable in that case rather than guessing.
function extractContentDate(rawHtml: string): Date | null {
  for (const block of extractJsonLdBlocks(rawHtml)) {
    try {
      const json = JSON.parse(block);
      const dateStr = json.dateModified ?? json.datePublished ?? null;
      if (typeof dateStr === "string") {
        const d = new Date(dateStr);
        if (!Number.isNaN(d.getTime())) return d;
      }
    } catch {
      // not valid JSON — skip this block
    }
  }

  const metaMatch = rawHtml.match(
    /<meta[^>]*(?:property|name)=["'](?:article:modified_time|article:published_time|og:updated_time)["'][^>]*content=["']([^"']+)["']/i
  );
  if (metaMatch) {
    const d = new Date(metaMatch[1]);
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const TWO_YEARS_MS = 2 * ONE_YEAR_MS;

export interface GeoRuleEvaluationInput {
  scraped: ScrapedPage;
  primaryKeyword: string;
  competitorMarkdowns: string[];
}

export function evaluateGeoRuleChecks(input: GeoRuleEvaluationInput): SeoGeoCheckResultMap {
  const { scraped, primaryKeyword, competitorMarkdowns } = input;
  const results: SeoGeoCheckResultMap = {};

  const faqPresent = hasFaqSection(scraped.markdown);
  results["geo.structure.faq_present"] = pass({ found: faqPresent }, faqPresent, 0.85);

  if (competitorMarkdowns.length > 0) {
    const pageWordCount = countWords(scraped.markdown);
    const competitorWordCounts = competitorMarkdowns.map(countWords).sort((a, b) => a - b);
    const median = competitorWordCounts[Math.floor(competitorWordCounts.length / 2)];
    const thin = median > 0 && pageWordCount < median * 0.5;
    results["geo.structure.thin_vs_competitors"] = pass(
      { pageWordCount, competitorMedian: median },
      !thin,
      0.8
    );
  } else {
    results["geo.structure.thin_vs_competitors"] = notMeasurable("No competitor pages available for comparison yet");
  }

  const contentDate = extractContentDate(scraped.rawHtml);
  if (contentDate) {
    const ageMs = Date.now() - contentDate.getTime();
    results["geo.freshness.published_within_1yr"] = pass({ contentDate: contentDate.toISOString(), ageDays: Math.round(ageMs / 86_400_000) }, ageMs <= ONE_YEAR_MS, 0.95);
    results["geo.freshness.published_within_2yr"] = pass({ contentDate: contentDate.toISOString(), ageDays: Math.round(ageMs / 86_400_000) }, ageMs <= TWO_YEARS_MS, 0.95);
  } else {
    results["geo.freshness.published_within_1yr"] = notMeasurable("No dateModified/datePublished or article meta tag found on this page");
    results["geo.freshness.published_within_2yr"] = notMeasurable("No dateModified/datePublished or article meta tag found on this page");
  }

  const density = keywordDensity(scraped.markdown, primaryKeyword);
  results["geo.penalty.keyword_stuffing"] = pass({ density: Math.round(density * 100) / 100 }, density <= 4, 0.85);

  return results;
}
