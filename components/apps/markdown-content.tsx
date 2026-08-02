import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Shared element styling for every read-only Markdown render (full articles
// and the truncated list-view preview) — no typography plugin installed, so
// visual hierarchy/table borders/link styling are applied per-element here
// instead of via a "prose" class.
const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-6 text-2xl font-semibold tracking-tight first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-5 text-xl font-semibold tracking-tight first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 text-lg font-semibold first:mt-0">{children}</h3>
  ),
  p: ({ children }) => <p className="mb-3 text-sm leading-relaxed last:mb-0">{children}</p>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-sm last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border px-3 py-2 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-3 py-2 align-top">{children}</td>,
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-border pl-3 italic text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
  ),
  hr: () => <hr className="my-4 border-border" />,
};

export function MarkdownContent({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Tighter spacing/type-scale for a narrow chat bubble (components/dashboard/
// ChatPanel.tsx) — markdownComponents above is sized for full-width article
// bodies (mt-6 headings, mb-3 paragraphs), which reads as oddly spread out
// inside a ~280-640px bubble. Same element set otherwise, so the chat
// coordinator's **bold**/bullet-list output (SCOPED_SYSTEM_PROMPT expects
// markdown to actually render now, see lib/chat/system-prompt.ts) renders
// properly instead of showing literal "**"/"-" characters. Headings collapse
// to one small weight — a chat answer has no business rendering a page-sized
// H1. Inline code gets a bg-background fill (not bg-muted) so it stays
// visible against the assistant bubble's own bg-muted background.
const chatMarkdownComponents: Components = {
  h1: ({ children }) => <p className="mb-1.5 mt-2 text-sm font-semibold first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mb-1.5 mt-2 text-sm font-semibold first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mb-1.5 mt-2 text-sm font-semibold first:mt-0">{children}</p>,
  p: ({ children }) => <p className="mb-1.5 text-sm leading-relaxed last:mb-0">{children}</p>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children }) => (
    <ul className="mb-1.5 list-disc space-y-0.5 pl-4 text-sm last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 text-sm last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  table: ({ children }) => (
    <div className="mb-1.5 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-background/60">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border/60 px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border/60 px-2 py-1 align-top">{children}</td>,
  blockquote: ({ children }) => (
    <blockquote className="mb-1.5 border-l-2 border-border pl-2 italic text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-xs">
      {children}
    </code>
  ),
  hr: () => <hr className="my-2 border-border/60" />,
};

export function ChatMarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
      {content}
    </ReactMarkdown>
  );
}
