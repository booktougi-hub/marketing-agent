import "server-only";

// Used only by trigger/outreach-preview.ts. Requires HUNTER_API_KEY — see
// PHASES.md Notes Log (2026-07-14): still a blank placeholder in
// .env.example, both calls below fail gracefully until a real key is added.

const HUNTER_TIMEOUT_MS = 15_000;

export type HunterEmailStatus =
  | "valid"
  | "invalid"
  | "accept_all"
  | "webmail"
  | "disposable"
  | "unknown";

export interface HunterVerifyResult {
  status: HunterEmailStatus;
  score: number | null;
}

export interface HunterVerifyResponse {
  result: HunterVerifyResult | null;
  error: string | null;
}

interface HunterVerifierRawResponse {
  data?: { status?: string; score?: number };
  errors?: { details?: string }[];
}

async function hunterFetch(url: string): Promise<{ json: unknown; error: string | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HUNTER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      return { json: null, error: `Hunter request failed: ${response.status} ${response.statusText}` };
    }
    return { json, error: null };
  } catch (err) {
    return { json: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function verifyEmail(email: string): Promise<HunterVerifyResponse> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) {
    return { result: null, error: "HUNTER_API_KEY is not configured" };
  }

  const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${apiKey}`;
  const { json, error } = await hunterFetch(url);
  if (error) return { result: null, error };

  const data = json as HunterVerifierRawResponse;
  if (data.errors?.length) {
    return { result: null, error: data.errors[0]?.details ?? "Hunter returned an error" };
  }

  const status = (data.data?.status ?? "unknown") as HunterEmailStatus;
  return { result: { status, score: data.data?.score ?? null }, error: null };
}

interface HunterFinderRawResponse {
  data?: { email?: string | null };
  errors?: { details?: string }[];
}

export async function findEmail(
  domain: string,
  firstName: string,
  lastName: string
): Promise<{ email: string | null; error: string | null }> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) {
    return { email: null, error: "HUNTER_API_KEY is not configured" };
  }

  const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${apiKey}`;
  const { json, error } = await hunterFetch(url);
  if (error) return { email: null, error };

  const data = json as HunterFinderRawResponse;
  if (data.errors?.length) {
    return { email: null, error: data.errors[0]?.details ?? "Hunter returned an error" };
  }

  return { email: data.data?.email ?? null, error: null };
}
