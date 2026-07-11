// Diagnostic-only request timing. Disabled in production so this never
// spams a real deployment's logs — safe to leave wrapped around calls.
const ENABLED = process.env.NODE_ENV !== "production";

// Accepts PromiseLike, not just Promise, because Supabase's query builders
// are thenables (awaitable) but not real Promise instances.
export async function timed<T>(label: string, fn: () => PromiseLike<T>): Promise<T> {
  if (!ENABLED) return fn();
  const start = Date.now();
  const result = await fn();
  console.log(`[perf] ${label}: ${Date.now() - start}ms`);
  return result;
}
