import type { PlanTier } from "@/types";

// Shared by the trigger API route (enforcement) and the Research page
// (display) so the two never drift. 999 stands in for "unlimited" so the
// same numeric comparison works for every plan. `agency` isn't mentioned in
// the product spec (only free/solo/growth/builder) — treated the same as
// builder since it's the tier above it.
export const MANUAL_RESEARCH_ALLOWANCE: Record<PlanTier, number> = {
  free: 0,
  solo: 1,
  growth: 3,
  builder: 999,
  agency: 999,
};

export const UNLIMITED_MANUAL_RESEARCH_PLANS = new Set<PlanTier>(["builder", "agency"]);

const WEEKLY_RESET_MS = 7 * 24 * 60 * 60 * 1000;
export const MANUAL_RESEARCH_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export function isWeeklyResetDue(resetAt: string | null): boolean {
  if (!resetAt) return true;
  return Date.now() - new Date(resetAt).getTime() > WEEKLY_RESET_MS;
}

// Pure/read-only, same "lazy reset" pattern as lib/reanalysis.ts — the
// counters themselves are only ever reset in the database at the moment a
// manual trigger actually runs (see the trigger route), never as a side
// effect of reading.
export function getEffectiveManualResearchCount(
  count: number,
  resetAt: string | null
): number {
  return isWeeklyResetDue(resetAt) ? 0 : count;
}

export function getRemainingManualRuns(
  planTier: PlanTier,
  count: number,
  resetAt: string | null
): number {
  const allowance = MANUAL_RESEARCH_ALLOWANCE[planTier] ?? MANUAL_RESEARCH_ALLOWANCE.free;
  const effectiveCount = getEffectiveManualResearchCount(count, resetAt);
  return Math.max(0, allowance - effectiveCount);
}

// Whole hours remaining, rounded up so "0" never implies "try now" when a
// few minutes are actually left.
export function getCooldownHoursRemaining(lastManualResearchAt: string | null): number {
  if (!lastManualResearchAt) return 0;
  const msSinceLast = Date.now() - new Date(lastManualResearchAt).getTime();
  if (msSinceLast >= MANUAL_RESEARCH_COOLDOWN_MS) return 0;
  return Math.ceil((MANUAL_RESEARCH_COOLDOWN_MS - msSinceLast) / (60 * 60 * 1000));
}
