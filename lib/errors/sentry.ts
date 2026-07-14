import "server-only";

// @sentry/nextjs is a declared dependency (see CLAUDE.md's tech stack table)
// but has no init files and an empty SENTRY_DSN in .env.local/.env.example —
// it isn't actually wired up yet. This stays a safe no-op until that setup
// lands (a separate task), rather than standing up full Sentry
// instrumentation as part of this error-handling refactor. The moment
// SENTRY_DSN is set and init files exist, this starts reporting without any
// call site changes.
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!process.env.SENTRY_DSN) return;

  import("@sentry/nextjs")
    .then(({ captureException }) => {
      captureException(error, context ? { extra: context } : undefined);
    })
    .catch(() => {
      // Sentry itself failing to load/report must never break error handling.
    });
}
