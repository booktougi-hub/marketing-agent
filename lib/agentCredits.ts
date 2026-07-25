import { WEEKLY_AUTOMATIONS, getNextWeeklyOccurrence } from "@/lib/schedule";
import type { PlanTier } from "@/types";

// Unified Agent Action Credit system — replaces the single-purpose
// manual-research rate limit (lib/manual-research.ts, now deleted) so every
// manually-triggerable agent (topic/problem research, forum opportunity
// scan, competitor gap analysis, and — once built — cold email prospecting)
// draws from one shared weekly pool instead of each having its own counter.

export type AgentActionType =
  | "topic_and_problem_research"
  | "forum_opportunity_scan"
  | "competitor_gap_analysis"
  | "cold_email_prospecting"
  | "onboarding_audit"
  | "churn_prevention_audit"
  | "cro_audit"
  | "pricing_audit"
  | "diagnosis_refresh"
  | "seo_audit"
  | "brand_info_extraction";

// 999 stands in for "unlimited" so the same numeric comparison works for
// every plan. `agency` isn't in the product spec (only free/solo/growth/
// builder) — treated the same as builder, the tier above it, matching the
// convention already used for reanalysis/manual-research allowances.
export const AGENT_CREDIT_ALLOWANCE: Record<PlanTier, number> = {
  free: 0,
  solo: 2,
  growth: 5,
  builder: 999,
  agency: 999,
};

export const UNLIMITED_AGENT_CREDIT_PLANS = new Set<PlanTier>(["builder", "agency"]);

export const AGENT_ACTION_COST: Record<AgentActionType, number> = {
  topic_and_problem_research: 1,
  forum_opportunity_scan: 1,
  competitor_gap_analysis: 2,
  cold_email_prospecting: 3,
  onboarding_audit: 2,
  churn_prevention_audit: 2,
  cro_audit: 2,
  pricing_audit: 2,
  diagnosis_refresh: 2,
  seo_audit: 2,
  brand_info_extraction: 2,
};

export const AGENT_ACTION_LABEL: Record<AgentActionType, string> = {
  topic_and_problem_research: "Topic & Problem Research",
  forum_opportunity_scan: "Opportunity Scan",
  competitor_gap_analysis: "Competitor Analysis",
  cold_email_prospecting: "Cold Email Prospecting",
  onboarding_audit: "Onboarding Audit",
  churn_prevention_audit: "Churn Prevention Audit",
  cro_audit: "Conversion (CRO) Audit",
  pricing_audit: "Pricing Audit",
  diagnosis_refresh: "Diagnosis Refresh Check",
  seo_audit: "SEO Audit",
  brand_info_extraction: "Brand Identity Re-analysis",
};

// cold_email_prospecting stays hard-gated by tier regardless of credits —
// it triggers real Apollo/Hunter spend per contact, not just an LLM call.
export const COLD_EMAIL_MIN_TIERS = new Set<PlanTier>(["growth", "builder", "agency"]);

const WEEKLY_RESET_MS = 7 * 24 * 60 * 60 * 1000;
export const AGENT_ACTION_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export function isCreditsResetDue(resetAt: string | null): boolean {
  if (!resetAt) return true;
  return Date.now() - new Date(resetAt).getTime() > WEEKLY_RESET_MS;
}

interface CreditFields {
  agent_credits_used_this_week: number;
  agent_credits_reset_at: string | null;
}

export interface RemainingCreditsInfo {
  remaining: number;
  allowance: number;
  // Next fixed Monday-00:00-UTC reset (trigger/weekly-research-reset.ts) —
  // not tied to the app's own preferred_research_day/hour, which only
  // controls when the research *scan* itself runs, not the credit reset.
  resetsAt: Date;
}

// Pure/read-only "lazy reset" pattern, same as lib/reanalysis.ts before it —
// the counters are only ever reset in the database at the moment an action
// actually runs (see the agent-action route), never as a side effect of
// reading.
export function getRemainingCredits(app: CreditFields, planTier: PlanTier): RemainingCreditsInfo {
  const allowance = AGENT_CREDIT_ALLOWANCE[planTier] ?? AGENT_CREDIT_ALLOWANCE.free;
  const resetDue = isCreditsResetDue(app.agent_credits_reset_at);
  const effectiveUsed = resetDue ? 0 : app.agent_credits_used_this_week;
  const remaining = Math.max(0, allowance - effectiveUsed);
  const resetAutomation = WEEKLY_AUTOMATIONS.find((a) => a.id === "weekly-research-reset")!;

  return { remaining, allowance, resetsAt: getNextWeeklyOccurrence(resetAutomation) };
}

export function canAffordAction(
  app: CreditFields,
  actionType: AgentActionType,
  planTier: PlanTier
): { allowed: boolean; reason?: string } {
  if (actionType === "cold_email_prospecting" && !COLD_EMAIL_MIN_TIERS.has(planTier)) {
    return {
      allowed: false,
      reason: "Cold email outreach is available on Growth and Builder plans.",
    };
  }

  const cost = AGENT_ACTION_COST[actionType];
  const { remaining } = getRemainingCredits(app, planTier);

  if (!UNLIMITED_AGENT_CREDIT_PLANS.has(planTier) && remaining < cost) {
    return {
      allowed: false,
      reason: `This action needs ${cost} agent credit${cost === 1 ? "" : "s"}, but you only have ${remaining} remaining this week. Upgrade for more, or wait for your next automatic scan.`,
    };
  }

  return { allowed: true };
}

// Applies per-app across every action type (not per-action-type) — running
// a competitor scan and then immediately a forum scan is still blocked by
// the same cooldown, same as the single manual-research trigger used to
// enforce before this system unified the four action types into one pool.
export function getCooldownHoursRemaining(lastAgentActionAt: string | null): number {
  if (!lastAgentActionAt) return 0;
  const msSinceLast = Date.now() - new Date(lastAgentActionAt).getTime();
  if (msSinceLast >= AGENT_ACTION_COOLDOWN_MS) return 0;
  return Math.ceil((AGENT_ACTION_COOLDOWN_MS - msSinceLast) / (60 * 60 * 1000));
}
