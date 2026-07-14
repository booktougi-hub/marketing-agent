import "server-only";
import type { ApolloFilters } from "@/types";

// Used only by trigger/outreach-preview.ts. Requires APOLLO_API_KEY — see
// PHASES.md Notes Log (2026-07-14): still a blank placeholder in
// .env.example, this call fails gracefully (empty result + error string)
// until a real key is added.
//
// Two real Apollo endpoints, not one — verified against
// https://docs.apollo.io/reference/people-api-search and
// https://docs.apollo.io/reference/bulk-people-enrichment (2026-07-14):
//
// 1. People Search (mixed_people/api_search) — free (no credit cost), but
//    deliberately returns almost nothing: no email, no last name (only
//    `last_name_obfuscated`), no organization domain, no funding/tech/
//    employment data. It exists purely to find candidate IDs. It also
//    requires a *master* API key specifically (regular API keys 403 on
//    this endpoint) — see https://docs.apollo.io/docs/create-api-key.
// 2. Bulk People Enrichment (people/bulk_match) — this is where real email,
//    full name, linkedin_url, organization.primary_domain, funding_events,
//    and employment_history actually live. Costs Apollo credits per
//    enriched record (more again if reveal_personal_emails unlocks an
//    email), capped at 10 people per call.

const APOLLO_TIMEOUT_MS = 20_000;
const ENRICH_BATCH_SIZE = 10; // Apollo's bulk_match hard cap per call

export interface ApolloCandidate {
  id: string;
  first_name: string | null;
  title: string | null;
  organization_name: string | null;
}

export interface ApolloSearchResult {
  candidates: ApolloCandidate[];
  error: string | null;
}

interface ApolloRawSearchPerson {
  id?: string;
  first_name?: string | null;
  title?: string | null;
  organization?: { name?: string | null } | null;
}

interface ApolloRawSearchResponse {
  people?: ApolloRawSearchPerson[];
  error?: string;
}

export async function searchApolloPeople(
  filters: ApolloFilters,
  perPage = 20
): Promise<ApolloSearchResult> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    return { candidates: [], error: "APOLLO_API_KEY is not configured" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), APOLLO_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        person_titles: filters.person_titles,
        person_seniorities: filters.person_seniorities,
        organization_num_employees_ranges: filters.organization_num_employees_ranges,
        organization_industry_tag_ids: filters.organization_industries,
        ...(filters.technologies.length > 0 ? { q_organization_keyword_tags: filters.technologies } : {}),
        per_page: perPage,
        page: 1,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const hint =
        response.status === 403
          ? " (People Search requires both a *master* API key AND a paid Apollo plan — confirmed disabled entirely on free tier, per Apollo's own docs: 'developer tools follow your Apollo permissions, plan access, and credit availability... can't bypass those limits'. See https://docs.apollo.io/docs/api-pricing)"
          : "";
      return {
        candidates: [],
        error: `Apollo search failed: ${response.status} ${response.statusText}${hint}${bodyText ? ` — ${bodyText.slice(0, 300)}` : ""}`,
      };
    }

    const data = (await response.json()) as ApolloRawSearchResponse;
    if (data.error) {
      return { candidates: [], error: data.error };
    }

    const candidates = (data.people ?? [])
      .filter((p): p is ApolloRawSearchPerson & { id: string } => !!p.id)
      .map((p) => ({
        id: p.id,
        first_name: p.first_name ?? null,
        title: p.title ?? null,
        organization_name: p.organization?.name ?? null,
      }));

    return { candidates, error: null };
  } catch (err) {
    return { candidates: [], error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface ApolloPerson {
  id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  // True only when Apollo's own email_status says "verified" — a stronger
  // signal than Hunter's, used to skip a redundant Hunter call when present.
  email_verified_by_apollo: boolean;
  linkedin_url: string | null;
  organization_name: string | null;
  organization_domain: string | null;
  // Grounded in real enrichment fields (funding_events, employment_history)
  // — not guessed, and null when nothing recent is actually present.
  trigger_event: string | null;
}

interface ApolloRawFundingEvent {
  date?: string | null;
  type?: string | null;
  amount?: string | null;
}

interface ApolloRawEmploymentHistory {
  title?: string | null;
  start_date?: string | null;
  current?: boolean | null;
}

interface ApolloRawOrganization {
  name?: string | null;
  primary_domain?: string | null;
  latest_funding_stage?: string | null;
  latest_funding_round_date?: string | null;
  funding_events?: ApolloRawFundingEvent[] | null;
}

interface ApolloRawMatch {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  email?: string | null;
  email_status?: string | null;
  linkedin_url?: string | null;
  organization?: ApolloRawOrganization | null;
  employment_history?: ApolloRawEmploymentHistory[] | null;
}

interface ApolloRawBulkMatchResponse {
  matches?: ApolloRawMatch[];
  error_message?: string | null;
}

const RECENT_DAYS_THRESHOLD = 90;

function isWithinRecentDays(dateStr: string | null | undefined, days: number): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr).getTime();
  if (Number.isNaN(date)) return false;
  return Date.now() - date <= days * 24 * 60 * 60 * 1000;
}

function inferTriggerEvent(raw: ApolloRawMatch): string | null {
  const org = raw.organization;

  const latestFunding = (org?.funding_events ?? [])[0];
  if (latestFunding?.type && isWithinRecentDays(latestFunding.date, RECENT_DAYS_THRESHOLD)) {
    return `${org?.name ?? "Their company"} recently raised a ${latestFunding.type} round${latestFunding.amount ? ` (${latestFunding.amount})` : ""}`;
  }
  if (org?.latest_funding_stage && isWithinRecentDays(org.latest_funding_round_date, RECENT_DAYS_THRESHOLD)) {
    return `${org.name ?? "Their company"} recently raised a ${org.latest_funding_stage} round`;
  }

  const currentRole = (raw.employment_history ?? []).find((e) => e.current);
  if (currentRole?.title && isWithinRecentDays(currentRole.start_date, RECENT_DAYS_THRESHOLD)) {
    return `Recently started as ${currentRole.title}`;
  }

  return null;
}

function mapApolloMatch(raw: ApolloRawMatch, fallbackId: string): ApolloPerson {
  return {
    id: raw.id ?? fallbackId,
    first_name: raw.first_name ?? null,
    last_name: raw.last_name ?? null,
    title: raw.title ?? null,
    email: raw.email ?? null,
    email_verified_by_apollo: raw.email_status === "verified",
    linkedin_url: raw.linkedin_url ?? null,
    organization_name: raw.organization?.name ?? null,
    organization_domain: raw.organization?.primary_domain ?? null,
    trigger_event: inferTriggerEvent(raw),
  };
}

export interface ApolloEnrichResult {
  people: ApolloPerson[];
  error: string | null;
}

// Enriches up to ENRICH_BATCH_SIZE (10, Apollo's own per-call cap) search
// candidates at once — this is the only call that actually costs Apollo
// credits (and reveal_personal_emails may cost more again per Apollo's
// pricing). Callers should only enrich as many candidates as they actually
// need previews for, not the whole search pool.
export async function enrichApolloPeople(candidateIds: string[]): Promise<ApolloEnrichResult> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    return { people: [], error: "APOLLO_API_KEY is not configured" };
  }
  if (candidateIds.length === 0) {
    return { people: [], error: null };
  }

  const ids = candidateIds.slice(0, ENRICH_BATCH_SIZE);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), APOLLO_TIMEOUT_MS);

  try {
    const response = await fetch(
      "https://api.apollo.io/api/v1/people/bulk_match?reveal_personal_emails=true&reveal_phone_number=false",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ details: ids.map((id) => ({ id })) }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      return { people: [], error: `Apollo enrichment failed: ${response.status} ${response.statusText}` };
    }

    const data = (await response.json()) as ApolloRawBulkMatchResponse;
    if (data.error_message) {
      return { people: [], error: data.error_message };
    }

    const people = (data.matches ?? []).map((match, i) => mapApolloMatch(match, ids[i] ?? ids[0]));
    return { people, error: null };
  } catch (err) {
    return { people: [], error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeoutId);
  }
}
