// Base error class for every expected, handled error in the app — API
// routes and Trigger.dev jobs throw one of the subclasses below instead of
// constructing a NextResponse/status code by hand.
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly isOperational: boolean;
  // Extra fields merged into the API response alongside { error, code } —
  // e.g. RateLimitError's `retryAfter`, which the frontend reads directly
  // off the response body to show a cooldown countdown.
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    errorCode: string,
    isOperational = true,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
    // Node-only API — guarded since it's absent from the plain Error type
    // in some lib configurations.
    (Error as unknown as { captureStackTrace?: (target: object, ctor: unknown) => void })
      .captureStackTrace?.(this, this.constructor);
  }
}

// 401 — the caller has no valid session at all.
export class UnauthorizedError extends AppError {
  constructor(message: string, errorCode = "UNAUTHORIZED") {
    super(message, 401, errorCode);
  }
}

// 403 — the caller is authenticated but not allowed to do this (wrong
// workspace, plan limit, missing credits).
export class ForbiddenError extends AppError {
  constructor(message: string, errorCode = "FORBIDDEN") {
    super(message, 403, errorCode);
  }
}

// 404 — the requested record doesn't exist (or doesn't belong to this
// workspace, which looks identical from the caller's side).
export class NotFoundError extends AppError {
  constructor(message: string, errorCode = "NOT_FOUND") {
    super(message, 404, errorCode);
  }
}

// 422 — the request is well-formed but invalid: bad input, wrong state,
// mismatched types. Covers what used to be a grab-bag of route-specific
// 422 codes (INVALID_STATE, TYPE_MISMATCH, NO_STRATEGY, etc.) — pass a more
// specific errorCode when the distinction is worth keeping.
export class ValidationError extends AppError {
  constructor(message: string, errorCode = "VALIDATION_ERROR") {
    super(message, 422, errorCode);
  }
}

// 429 — the caller is rate-limited (manual research cooldown, etc.).
export class RateLimitError extends AppError {
  constructor(message: string, errorCode = "RATE_LIMITED", details?: Record<string, unknown>) {
    super(message, 429, errorCode, true, details);
  }
}

// 502 — a call to a dependency we don't control failed (Firecrawl, Claude,
// OpenRouter, PostEverywhere, Apollo, ...). `service` records which one so
// it shows up directly in error_message/logs without digging into a stack
// trace.
export class ExternalServiceError extends AppError {
  public readonly service: string;

  constructor(message: string, service: string, errorCode = "EXTERNAL_SERVICE_ERROR") {
    super(message, 502, errorCode);
    this.service = service;
  }
}

// 500 — a genuinely unexpected failure (bad state we didn't anticipate, a
// bug). isOperational is false here specifically so downstream logging/
// Sentry treats it as a real incident rather than expected application flow.
export class InternalError extends AppError {
  constructor(message: string, errorCode = "INTERNAL_ERROR") {
    super(message, 500, errorCode, false);
  }
}

// Wraps a call to an external SDK/API so any failure — network error, SDK
// throw, non-2xx response the SDK itself throws on — surfaces as a typed
// ExternalServiceError naming the failing service, instead of an untyped
// Error that all looks the same by the time it reaches error_message.
// Only applied at call sites that are already fatal-on-failure; call sites
// that already treat a failure as non-fatal (logged and continued) are left
// alone so this never turns a soft-fail into a hard-fail.
//
// ExternalServiceError is `isOperational: true` (the default), so
// handleApiError (lib/errors/apiHandler.ts) treats it as an expected
// failure and never logs or reports it — deliberately, since a transient
// rate limit or network blip on a third-party API isn't an incident. But
// that also meant the ORIGINAL error — the one specific piece of
// information that actually explains why a given call failed — was
// discarded entirely, with nothing surfaced anywhere: chasing down a real
// bug behind this generic message meant reproducing the failure by hand
// from scratch rather than reading a log. Logging it here keeps the
// "operational, don't alert on every occurrence" classification for the
// wrapped error the caller sees, while still making the real cause visible
// in server logs for whoever has to debug the next one.
export async function callExternalService<T>(
  service: string,
  message: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error(`[EXTERNAL SERVICE ERROR] ${service}`, err);
    throw new ExternalServiceError(message, service);
  }
}
