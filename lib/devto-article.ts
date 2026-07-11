// Shared prompt-building for every Dev.to article generation path (the
// from-research route and the bulk content-generation job) so both produce
// the same structure and writing quality instead of drifting apart. Only
// the user-prompt (what the article is actually about) differs per caller —
// the system prompt built here is identical either way.

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

${DEVTO_QUALITY_INSTRUCTIONS}
${tone ? `\nTone: ${tone}\n` : ""}
Respond with ONLY the article in Markdown — no prose about what you're doing, no code fences wrapping the whole thing.`;
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
