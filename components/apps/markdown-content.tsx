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
