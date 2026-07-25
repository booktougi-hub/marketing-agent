import "server-only";
import { extractKeyPhrase } from "@/lib/research-job";
import type { AppDna, ProductType } from "@/types";

// Shared by trigger/competitor-gap-analysis.ts and trigger/competitor-research.ts
// — both need "find this app's real competitors" query construction, and
// this is the one already fixed (2026-07-14) to search by function/category/
// region instead of the app's own name. Extracted here so competitor-research
// reuses it instead of duplicating it, per PHASES.md's diagnosis-pipeline
// redesign (2026-07-14).

export const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  developer_tool: "developer tool",
  mobile_app: "mobile app",
  web_app: "web app",
  saas: "SaaS tool",
  browser_extension: "browser extension",
  other: "tool",
};

// The product_type dropdown is set once at onboarding and is often wrong
// for landing pages whose real product is a mobile app (e.g. a page
// showcasing a Play Store app, manually categorized as "web_app"). DNA
// extraction now detects actual Play Store / App Store links on the page
// (see trigger/dna-extraction.ts) — that's a stronger, self-correcting
// signal than the dropdown, so app-store-aware sources trust either one.
export function hasAppStorePresence(dna: AppDna, productType: ProductType): boolean {
  return productType === "mobile_app" || !!dna.app_store_urls?.play_store || !!dna.app_store_urls?.app_store;
}

export interface DiscoveryQuery {
  query: string;
  kind: "category" | "region" | "problem";
}

// Query construction — 2-4 distinct queries per app instead of one narrow
// phrase, each targeting a different angle: what the app DOES (category),
// WHO/WHERE it's for (region/context), and what a user would search when
// hunting for a solution (problem). dna.name is never used as input — the
// bug this replaces was a literal `${dna.name} alternatives` search that
// surfaced anything sharing word fragments with the product's own name.
export function buildDiscoveryQueries(
  dna: AppDna,
  productType: ProductType,
  additionalContext: string | null
): DiscoveryQuery[] {
  const categoryLabel = PRODUCT_TYPE_LABEL[productType] ?? "tool";
  const functionPhrase = extractKeyPhrase(dna.tagline, 5) || extractKeyPhrase(dna.problem, 5);
  const audiencePhrase = extractKeyPhrase(dna.target_audience, 6);
  const problemPhrase = extractKeyPhrase(dna.problem, 6);
  // additional_context is free text the user typed at onboarding — the most
  // likely place a region/language/cultural signal ("for the Manipuri
  // community", "Quebec French speakers") shows up. Falls back to the
  // audience phrase when it's empty.
  const contextPhrase = extractKeyPhrase(additionalContext, 6);
  const regionPhrase = contextPhrase || audiencePhrase;

  const queries: DiscoveryQuery[] = [];
  const seenQueries = new Set<string>();
  const push = (query: string, kind: DiscoveryQuery["kind"]) => {
    const key = query.trim().toLowerCase();
    if (!key || seenQueries.has(key)) return;
    seenQueries.add(key);
    queries.push({ query: query.trim(), kind });
  };

  if (functionPhrase) {
    push(`${functionPhrase} ${categoryLabel}`, "category");
  }
  if (regionPhrase) {
    push(`${categoryLabel} for ${regionPhrase}`, "region");
  }
  if (problemPhrase) {
    push(`${problemPhrase} app`, "problem");
  }

  return queries;
}
