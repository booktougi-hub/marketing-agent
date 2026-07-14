import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Every call site used to construct `new Anthropic({ apiKey })` with the
// SDK's bare defaults: a 10-minute per-attempt timeout and 2 automatic
// retries (anthropic-ai/sdk client.js: DEFAULT_TIMEOUT = 600000, maxRetries
// default = 2) — so a single hanging/erroring call could sit for up to 30
// minutes before failing. That's what was making dna-extraction (one Claude
// call) and other jobs appear to hang indefinitely with nothing surfaced to
// the user. None of these prompts need anywhere near 10 minutes — 60s is
// generous headroom, and the SDK's default 2 retries still apply on top,
// now bounded to a worst case of 3 minutes instead of 30.
export function createAnthropicClient(): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    timeout: 60_000,
  });
}
