// Shared prompt-building for every Dev.to article generation path (the
// from-research route and the bulk content-generation job) so both produce
// the same structure and writing quality instead of drifting apart. Only
// the user-prompt (what the article is actually about) differs per caller —
// the system prompt built here is identical either way. Also hosts
// buildBrandVoiceBlock() below, shared with trigger/content-generation.ts's
// short-form (Twitter/LinkedIn) path for the same reason — one block
// builder, not two copies that could drift.

// CRAFT_PRINCIPLES below: reasoning framework swapped for
// .claude/skills/content-strategy/SKILL.md + .claude/skills/copywriting/
// SKILL.md + .claude/skills/copy-editing/SKILL.md + .claude/skills/
// marketing-psychology/SKILL.md combined — same "compress the skill's
// framework into a numbered list baked into a static prompt" pattern the
// four Audits-family jobs use (trigger/pricing-audit.ts:79 etc.), applied
// here to the long-form article path specifically because it already runs
// on Sonnet (MODELS.STANDARD) and has room for a fuller instruction set
// without meaningfully changing cost — trigger/content-generation.ts's
// short-form path gets a deliberately condensed version of the same four
// skills instead, since that path is pinned to a free bulk model kept
// cheap and fast on purpose.
const CRAFT_PRINCIPLES = `=== CRAFT PRINCIPLES (apply this reasoning, do not just restate it) ===

1. SEARCHABLE OR SHAREABLE — every section should either answer a real question directly, or contain a genuinely novel insight, counterintuitive take, or piece of original data worth sharing on its own. A section that does neither is filler.
2. SPECIFICITY OVER VAGUENESS — a concrete number, named mechanism, or real detail from the reference material beats an abstract claim every time ("cuts weekly reporting from 4 hours to 15 minutes," not "saves time"). Never write "streamline," "optimize," "innovative," or "leverage" without a concrete detail attached.
3. BENEFITS OVER FEATURES (JOBS TO BE DONE) — readers don't want a feature, they want the outcome it produces. For every feature mentioned, answer "so what?" — bridge it to the actual outcome with a "which means..." connector, don't just list the feature and move on.
4. PROVE IT — every non-obvious claim needs evidence: a real number, a named source, a specific example from the reference material. An unsupported claim ("the best way to...") reads as filler; cut it or ground it in something real.
5. ANCHORING & FRAMING — when comparing before/after, a problem/solution, or two options, put the less-favorable one first so the better one reads as the obvious improvement, not the other way around.
6. ZERO RISK NEAR THE CTA — the closing call to action should remove friction, not manufacture urgency it hasn't earned — name the product, name the specific next step, no vague "learn more."`;

export const DEVTO_QUALITY_INSTRUCTIONS = `CRITICAL WRITING QUALITY:
- Vary sentence length deliberately — mix short, punchy sentences with longer explanatory ones.
- Reference specific, concrete details from the reference material provided (exact numbers, exact quotes, exact source or competitor names) rather than generic statements.
- Avoid generic AI-writing patterns: no "In today's fast-paced world", no "It's important to note that", no starting multiple paragraphs with the same sentence structure.
- Write with a point of view, not neutral description — take a clear position where the reference material supports one.
- Use natural transitions between sections rather than abrupt topic changes.`;

export function buildDevtoStructureInstructions(includeComparisonTable: boolean): string {
  return `Structure the article as Markdown with this exact content plan:
- A compelling, specific, concrete title as a single "# Title" line — not generic
- A hook opening paragraph (1-3 sentences) that states a specific, real detail from the reference material above — cite it directly, don't paraphrase it into something generic
- 3-5 sections, each starting with a "## Section Header" line
${includeComparisonTable ? "- At least one comparison table in Markdown table syntax, comparing the product against the named competitor on 2-4 relevant dimensions, grounded in the real data given above\n" : ""}- 2-3 links woven naturally into the body using Markdown link syntax [text](url) — use ONLY the real URLs listed in the reference material, never invent a URL; if fewer real URLs are available, use fewer links rather than fabricate more
- **Bold** used sparingly, only for genuinely key terms — not overused
- A closing section with a clear call to action that mentions the product by name`;
}

export function buildDevtoSystemPrompt({
  includeComparisonTable,
  tone,
}: {
  includeComparisonTable: boolean;
  tone: string | null;
}): string {
  return `You are a technical writer producing a genuinely well-written, human-sounding Dev.to article for a software product — not generic AI-generated filler.

${buildDevtoStructureInstructions(includeComparisonTable)}

${CRAFT_PRINCIPLES}

${DEVTO_QUALITY_INSTRUCTIONS}
${tone ? `\nTone: ${tone}\n` : ""}
If a "=== BRAND VOICE ===" section appears in the reference material you're given, it always overrides the craft principles above whenever they conflict — a founder's specific stated tone and words-to-avoid win over this general guidance every time. The craft principles are the default; brand voice is the override.

Respond with ONLY the article in Markdown — no prose about what you're doing, no code fences wrapping the whole thing.`;
}

// Shared by both content-generation.ts paths (short-form contextBlock and
// this file's own buildDevtoUserPrompt below) — one formatter, so the
// "=== BRAND VOICE ===" heading both system prompts above reference by name
// can never drift out of sync between the two paths. Returns "" when there's
// nothing to show (no brand_information row yet, or one with neither field
// populated) rather than an empty/misleading heading.
export function buildBrandVoiceBlock(
  brandVoice: { tone_descriptors: string[] | null; words_to_avoid: string[] | null } | null
): string {
  if (!brandVoice) return "";
  const lines: string[] = [];
  if (brandVoice.tone_descriptors && brandVoice.tone_descriptors.length > 0) {
    lines.push(`Voice: ${brandVoice.tone_descriptors.join(", ")}`);
  }
  if (brandVoice.words_to_avoid && brandVoice.words_to_avoid.length > 0) {
    lines.push(`Never use these words or phrases: ${brandVoice.words_to_avoid.join(", ")}`);
  }
  if (lines.length === 0) return "";
  return `=== BRAND VOICE (set by the founder — overrides general craft/style guidance whenever they conflict) ===\n${lines.join("\n")}`;
}

// Every real URL a caller is allowed to hand to the model as link material —
// callers collect these from wherever real URLs exist (app.source_url,
// dna.additional_urls, a finding's source_url, ...) and pass the combined,
// deduplicated list here. Never let the model invent one beyond this list.
export function buildRealLinksBlock(urls: (string | null | undefined)[]): string {
  const unique = Array.from(new Set(urls.filter((u): u is string => Boolean(u))));
  if (unique.length === 0) {
    return "=== REAL URLS YOU MAY LINK TO ===\nNone available — do not include any Markdown links in this article.";
  }
  return `=== REAL URLS YOU MAY LINK TO (do not invent any other URL) ===\n${unique.map((u) => `- ${u}`).join("\n")}`;
}
