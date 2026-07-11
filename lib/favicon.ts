import "server-only";

// Resolves the real favicon/logo for a scraped site, for `apps.icon_url`
// (see trigger/dna-extraction.ts). Preference order: apple-touch-icon (best
// resolution for a small UI icon) > <link rel="icon"> > og:image > a guessed
// /favicon.ico — the first candidate that actually loads as an image wins.
// Everything falls back to a first-letter avatar in the UI (components/apps/app-icon.tsx)
// if nothing here resolves.

const IMAGE_EXTENSIONS = [".ico", ".png", ".svg", ".jpg", ".jpeg", ".gif", ".webp"];

// Not exhaustive DNS-rebinding-proof SSRF protection (that would need
// resolving DNS and pinning the connection to the resolved IP) — just a
// baseline guard against obviously-internal targets, since these candidate
// URLs come from a scraped third-party page's HTML, not from our own code.
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^169\.254\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^\[?::1\]?$/,
];

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return !BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(parsed.hostname));
  } catch {
    return false;
  }
}

function getAttr(tag: string, attr: string): string | null {
  const match = tag.match(new RegExp(`${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? null;
}

function extractLinkIcons(html: string, baseUrl: string): { url: string; priority: number }[] {
  const candidates: { url: string; priority: number }[] = [];
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];

  for (const tag of linkTags) {
    const rel = getAttr(tag, "rel")?.toLowerCase() ?? "";
    const href = getAttr(tag, "href");
    if (!href) continue;

    let priority: number | null = null;
    if (rel.includes("apple-touch-icon")) priority = 0;
    else if (rel.includes("icon")) priority = 1; // covers "icon", "shortcut icon", "mask-icon"

    if (priority === null) continue;

    try {
      candidates.push({ url: new URL(href, baseUrl).toString(), priority });
    } catch {
      // malformed href — skip
    }
  }

  return candidates.sort((a, b) => a.priority - b.priority);
}

async function isReachableImage(url: string): Promise<boolean> {
  if (!isSafeHttpUrl(url)) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
      if (!res.ok) return false;
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.startsWith("image/")) return true;
      // Some servers misconfigure favicon content-type (e.g. serving .ico as
      // application/octet-stream) — fall back to trusting the extension.
      const pathname = new URL(url).pathname.toLowerCase();
      return IMAGE_EXTENSIONS.some((ext) => pathname.endsWith(ext));
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

export async function resolveAppIconUrl({
  html,
  ogImage,
  sourceUrl,
}: {
  html: string | null | undefined;
  ogImage: string | null | undefined;
  sourceUrl: string;
}): Promise<string | null> {
  const candidates: string[] = [];

  if (html) {
    candidates.push(...extractLinkIcons(html, sourceUrl).map((c) => c.url));
  }

  if (ogImage) {
    try {
      candidates.push(new URL(ogImage, sourceUrl).toString());
    } catch {
      // malformed og:image — skip
    }
  }

  try {
    candidates.push(new URL("/favicon.ico", sourceUrl).toString());
  } catch {
    // malformed sourceUrl — nothing we can guess
  }

  for (const candidate of candidates) {
    if (await isReachableImage(candidate)) {
      return candidate;
    }
  }

  return null;
}
