// Shared helpers for handling Markdown `content.body` values (Dev.to
// articles specifically) outside of the full editor — extracting a title,
// building a short preview, and stripping syntax for the tiny calendar chip
// that has no room to render real Markdown.

const LEADING_H1 = /^#\s+(.+?)\s*$/m;

// Devto articles fold their title into the body as a single leading "# "
// line (see lib/devto-article.ts) — there's no separate title column.
export function getArticleTitle(body: string): string | null {
  const match = body.match(LEADING_H1);
  return match ? match[1] : null;
}

export function getArticleBodyWithoutTitle(body: string): string {
  return body.replace(LEADING_H1, "").replace(/^\s+/, "");
}

// First paragraph or two, as whole Markdown blocks (split on blank lines)
// rather than an arbitrary character count — a character-count slice risks
// cutting off mid-token (mid "**bold", mid a link's "](url)") and rendering
// broken Markdown.
export function getMarkdownPreview(body: string, maxParagraphs = 2): string {
  const withoutTitle = getArticleBodyWithoutTitle(body);
  const blocks = withoutTitle.split(/\n{2,}/).filter((block) => block.trim().length > 0);
  return blocks.slice(0, maxParagraphs).join("\n\n");
}

// For the calendar's day-cell chip, which is far too small to render actual
// Markdown — just strip the syntax so raw "#"/"**"/"[]()" characters don't
// show up as literal noise in a ~24-character label.
export function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}
