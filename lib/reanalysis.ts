import type { PlanTier } from "@/types";

// null = unlimited. Not explicitly specified for 'agency' in the product
// spec (only free/solo/growth/builder) — treated the same as builder since
// it's the higher tier above it.
export const PLAN_REANALYSIS_CREDITS: Record<PlanTier, number | null> = {
  free: 0,
  solo: 1,
  growth: 3,
  builder: null,
  agency: null,
};

export function isCreditResetDue(resetAt: string | null): boolean {
  if (!resetAt) return true;
  return new Date(resetAt).getTime() <= Date.now();
}

export function nextResetDate(from: Date = new Date()): string {
  const next = new Date(from);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString();
}

// Pure/read-only — used for display on the client and for the eligibility
// check in the API route. The counters themselves are only ever reset in
// the database at the moment a reanalysis is actually performed (see
// app/api/apps/[id]/reanalyse/route.ts), never as a side effect of reading.
export function getRemainingCredits(
  planTier: PlanTier,
  reanalysisCreditsUsed: number,
  reanalysisCreditsResetAt: string | null
): number | null {
  const total = PLAN_REANALYSIS_CREDITS[planTier];
  if (total === null) return null;
  const effectiveUsed = isCreditResetDue(reanalysisCreditsResetAt) ? 0 : reanalysisCreditsUsed;
  return Math.max(0, total - effectiveUsed);
}
