import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./AppError";
import { ErrorMessages } from "./messages";
import { captureError } from "./sentry";

// Wraps an API route handler so every route shares one try/catch instead of
// repeating its own. Works for routes with no second argument
// (`POST(request)`) and routes with a dynamic-segment context
// (`PATCH(request, { params })`) alike, via a rest-args generic — avoids
// hand-typing a route-context shape (and avoids `any`) while still giving
// the wrapped handler's params their real inferred type.
export function withErrorHandling<Args extends unknown[]>(
  handler: (req: NextRequest, ...args: Args) => Promise<NextResponse>
) {
  return async (req: NextRequest, ...args: Args): Promise<NextResponse> => {
    try {
      return await handler(req, ...args);
    } catch (error) {
      return handleApiError(error);
    }
  };
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    if (!error.isOperational) {
      // An AppError subclass that's still explicitly non-operational
      // (currently just InternalError) — expected shape, unexpected cause.
      console.error("[UNEXPECTED APP ERROR]", error);
      captureError(error);
    }
    return NextResponse.json(
      { error: error.message, code: error.errorCode, ...(error.details ?? {}) },
      { status: error.statusCode }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: ErrorMessages.generic.VALIDATION_FAILED,
        code: "VALIDATION_ERROR",
        details: error.issues,
      },
      { status: 422 }
    );
  }

  // Truly unexpected — not one of our own error types at all. Log full
  // details server-side, report to Sentry, return the generic message.
  console.error("[UNHANDLED ERROR]", error);
  captureError(error);
  return NextResponse.json(
    { error: ErrorMessages.generic.UNKNOWN, code: "INTERNAL_ERROR" },
    { status: 500 }
  );
}
