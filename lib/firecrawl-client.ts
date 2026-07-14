import "server-only";
import FirecrawlApp from "@mendable/firecrawl-js";

// The actual root cause of DNA extraction (and other jobs) hanging for 30+
// minutes: @mendable/firecrawl-js's scrapeUrl() only applies a request
// timeout when the caller explicitly passes one —
// `timeout: params?.timeout !== void 0 ? params.timeout + 5e3 : void 0`
// (dist/index.js). With no `timeout` param, that's `undefined`, so the
// underlying axios request has NO timeout at all and can hang indefinitely
// on a slow/stalled page. Every scrapeUrl() call must pass this explicitly.
// (firecrawl.search() is unaffected — it already defaults `timeout` to
// 60000ms internally before it reaches the same axios call.)
// 30s cut off real (slow-loading/JS-heavy) sites before their scrape
// finished in testing, losing DNA quality (e.g. missed app_store_urls
// detection) even though the job itself no longer hung. 45s is still a
// tiny fraction of the previous unbounded/30-minute failure mode while
// giving slower pages a real chance to finish.
export const SCRAPE_TIMEOUT_MS = 45_000;

export function createFirecrawlClient(): FirecrawlApp {
  return new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });
}
