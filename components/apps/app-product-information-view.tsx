import { Globe, Link2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PRODUCT_TYPE_LABEL } from "@/lib/discovery-query-builder";
import type { AppDna, AppStatus, ProductType } from "@/types";

// Recognizable third-party destinations get a fixed, branded label instead
// of a path-derived guess — humanizing Play/App Store URLs' own path
// segments (e.g. "/store/apps/details", "/us/app/some-app-name/id123")
// would produce noise, not signal.
const KNOWN_HOST_LABELS: Record<string, string> = {
  "play.google.com": "Android App",
  "apps.apple.com": "iOS App",
  "github.com": "GitHub",
  "producthunt.com": "Product Hunt",
  "medium.com": "Medium",
  "youtube.com": "YouTube",
  "discord.com": "Discord",
  "discord.gg": "Discord",
};

// Case-correct a handful of words that plain title-casing would otherwise
// mangle into something unrecognizable (acronyms) or a single unreadable
// run-together word.
const ACRONYM_WORDS: Record<string, string> = {
  seo: "SEO",
  geo: "GEO",
  ugc: "UGC",
  api: "API",
  faq: "FAQ",
};
const COMPOUND_WORDS: Record<string, string> = {
  hackernews: "Hacker News",
  linkedin: "LinkedIn",
  github: "GitHub",
};

// A short, generic path segment that reads as a category the adjacent
// segment belongs to (e.g. the "agent" in "/agent/writer") rather than
// meaningful content on its own — folded into the label as a suffix
// instead of shown as its own separate word.
const CATEGORY_SEGMENTS = new Set(["agent", "agents", "feature", "features", "product", "products"]);

function humanizeWord(word: string): string {
  const lower = word.toLowerCase();
  if (COMPOUND_WORDS[lower]) return COMPOUND_WORDS[lower];
  if (ACRONYM_WORDS[lower]) return ACRONYM_WORDS[lower];
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map(humanizeWord)
    .join(" ");
}

// Derives a short, meaningful label from the URL itself — e.g.
// "okara.ai/agent/writer" -> "Writer Agent" — instead of the bare hostname,
// which is useless for telling apart a batch of additional_urls that all
// share the same domain (see this function's own call site's comment).
function getUrlLabel(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const hostname = parsed.hostname.replace(/^www\./, "");
  for (const [host, label] of Object.entries(KNOWN_HOST_LABELS)) {
    if (hostname === host || hostname.endsWith(`.${host}`)) return label;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return parsed.hostname;

  const last = humanizeSlug(decodeURIComponent(segments[segments.length - 1]));
  const parent = segments.length > 1 ? segments[segments.length - 2].toLowerCase() : null;

  if (parent && CATEGORY_SEGMENTS.has(parent)) {
    const category = humanizeSlug(parent).replace(/s$/, "");
    return `${last} ${category}`;
  }

  return last;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function AppProductInformationView({
  sourceUrl,
  productType,
  status,
  dna,
}: {
  sourceUrl: string;
  productType: ProductType;
  status: AppStatus;
  dna: AppDna | null;
}) {
  if (!dna) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          {status === "error" ? (
            <Badge variant="destructive">Error</Badge>
          ) : (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          )}
          <p className="max-w-sm text-sm text-muted-foreground">
            {status === "error"
              ? "Something went wrong while extracting this app's product information."
              : "Extracting product information from your app's website..."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{dna.name}</CardTitle>
          <p className="text-sm text-muted-foreground">{dna.tagline}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Category">
              <Badge variant="outline" className="capitalize">
                {PRODUCT_TYPE_LABEL[productType]}
              </Badge>
            </Field>
            <Field label="Source URL">
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{sourceUrl}</span>
              </a>
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Problem it solves</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{dna.problem}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Key features</CardTitle>
          </CardHeader>
          <CardContent>
            {dna.features.length === 0 ? (
              <p className="text-sm text-muted-foreground">No features listed.</p>
            ) : (
              <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                {dna.features.map((feature, i) => (
                  <li key={i}>{feature}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Competitors</CardTitle>
          </CardHeader>
          <CardContent>
            {dna.competitors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No competitors identified.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {dna.competitors.map((competitor, i) => (
                  <Badge key={i} variant="secondary">
                    {competitor}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 py-6 sm:grid-cols-2">
          <Field label="Target audience">{dna.target_audience}</Field>
          <Field label="Pricing">{dna.pricing}</Field>
        </CardContent>
      </Card>

      {dna.additional_urls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Additional URLs</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {dna.additional_urls.map((url, i) => (
              <Badge
                key={i}
                variant="outline"
                render={<a href={url} title={url} target="_blank" rel="noopener noreferrer" />}
                className="h-auto gap-1.5 px-3 py-1.5 font-sans text-sm font-normal transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Link2 className="text-muted-foreground" />
                {getUrlLabel(url)}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
