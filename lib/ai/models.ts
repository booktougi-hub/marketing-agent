import "server-only";

// Single source of truth for which Claude/OpenRouter model each task
// category uses. Every job that calls an LLM imports from here instead of
// hardcoding a model string, so rebalancing a tier (a model turning out
// insufficient, a new model shipping) is a one-line change here instead of
// a per-file hunt.
export const MODELS = {
  // The two highest-leverage, lowest-frequency calls in the system —
  // diagnosis and strategy generation run once per app plus occasional
  // refreshes, so the ~2x cost premium over Sonnet is a few cents per
  // run, not a real line item. Both synthesize multiple inputs (DNA +
  // competitor research + prior findings) into a single judgment that
  // everything downstream inherits — worth defaulting to the stronger
  // model here specifically. See trigger/diagnosis.ts and
  // trigger/strategy-generation.ts for the quality-logging (model stored
  // on the result row) and SYNTHESIS_MODEL_OVERRIDE escape hatch this
  // choice is paired with.
  HIGH_STAKES_SYNTHESIS: "claude-opus-4-8",

  // Other multi-input synthesis jobs — narrower scope or lower downstream
  // leverage than diagnosis/strategy, stay on Sonnet for now.
  SYNTHESIS: "claude-sonnet-5",

  // Structured extraction, audits, chat coordination, content generation
  // — well-scoped, moderate-stakes, Sonnet's actual sweet spot.
  STANDARD: "claude-sonnet-5",

  // High-volume, low-stakes, per-item classification/extraction —
  // relevance checks, keyword extraction, topic fit judgments. Bare
  // alias (not the dated `-20251001` snapshot) per current model-catalog
  // guidance to prefer aliases over pinned snapshots.
  BULK_CLASSIFICATION: "claude-haiku-4-5",

  // Bulk short-form social content — pin explicitly, do not use an
  // unpinned "whichever has capacity" router for anything that produces
  // public-facing brand content. See trigger/content-generation.ts for
  // the bounded fallback this is paired with.
  //
  // 2026-07-27: OpenRouter retired "meta-llama/llama-3.3-70b-instruct:free"
  // (and the unpinned "openrouter/free" alias content-generation.ts used to
  // fall back to) — every call was failing immediately with a model-not-
  // found error, breaking content generation for every app. Swapped to a
  // currently-listed free model. OpenRouter's free tier churns over time
  // (models get added/retired without notice); if generation starts
  // failing fast again, check https://openrouter.ai/api/v1/models for
  // whether this ID (or the fallback in content-generation.ts) is still
  // listed before assuming the bug is elsewhere.
  BULK_CONTENT_FREE: "inclusionai/ling-3.0-flash:free",
} as const;

// trigger/diagnosis.ts and trigger/strategy-generation.ts both call this
// instead of reading MODELS.HIGH_STAKES_SYNTHESIS directly, so a specific
// run can be forced back to Sonnet — for a side-by-side comparison against
// Opus output on the same app/inputs — without a code change or redeploy.
export function getHighStakesSynthesisModel(): string {
  return process.env.SYNTHESIS_MODEL_OVERRIDE || MODELS.HIGH_STAKES_SYNTHESIS;
}
