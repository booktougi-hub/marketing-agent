import { ErrorMessages } from "./messages";

export interface ParsedApiError {
  message: string;
  code?: string;
  // Present only on RateLimitError responses (e.g. the manual-research
  // cooldown) — hours remaining until the caller can retry.
  retryAfter?: number;
}

// Parses the { error, code, ...details } shape every API route now returns
// via handleApiError (lib/errors/apiHandler.ts) into a clean object a form
// or component can use directly — so every call site parses a failed
// response the same way instead of each writing its own
// `response.json().catch(...)` + `json?.error ?? "..."` fallback.
export async function parseApiError(response: Response): Promise<ParsedApiError> {
  const json = await response.json().catch(() => null);

  if (!json || typeof json.error !== "string") {
    return { message: ErrorMessages.generic.UNKNOWN };
  }

  return {
    message: json.error,
    code: typeof json.code === "string" ? json.code : undefined,
    retryAfter: typeof json.retryAfter === "number" ? json.retryAfter : undefined,
  };
}
