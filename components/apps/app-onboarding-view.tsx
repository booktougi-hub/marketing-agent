"use client";

import { useEffect, useState } from "react";
import { AuditFindingCard } from "@/components/apps/audit-finding-card";
import { AgentActionEmptyState } from "@/components/apps/agent-action-empty-state";
import { supabase } from "@/lib/supabase";
import { getNextMonthlyOccurrence, MONTHLY_AUTOMATIONS } from "@/lib/schedule";
import type { OnboardingFinding, PlanTier } from "@/types";

const SEVERITY_RANK: Record<OnboardingFinding["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

async function updateFindingStatus(
  appId: string,
  findingId: string,
  status: "fixed" | "not_applicable"
) {
  const res = await fetch(`/api/apps/${appId}/onboarding-findings/${findingId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to update this finding.");
  }
}

async function submitFindingFeedback(appId: string, findingId: string, note: string) {
  const res = await fetch(`/api/apps/${appId}/onboarding-findings/${findingId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to send feedback.");
  }
}

export function AppOnboardingView({
  appId,
  initialFindings,
  planTier,
  agentCreditsUsedThisWeek,
  agentCreditsResetAt,
  agentActionCooldowns,
  firstAuditCompletedAt,
}: {
  appId: string;
  initialFindings: OnboardingFinding[];
  planTier: PlanTier;
  agentCreditsUsedThisWeek: number;
  agentCreditsResetAt: string | null;
  agentActionCooldowns: Record<string, string> | null;
  // Null both when no audit has ever run AND when the first run found zero
  // groundable findings (a real outcome — see trigger/onboarding-audit.ts).
  // The empty state below falls back to its generic "no results yet"
  // copy in either case rather than a misleading date.
  firstAuditCompletedAt: string | null;
}) {
  const [findings, setFindings] = useState(initialFindings);

  // Optimistic local removal, same pattern as AppResearchView's
  // markActedOn — doesn't wait on the Realtime UPDATE round trip below,
  // which stays purely as a cross-tab/cross-session sync mechanism.
  function removeLocally(findingId: string) {
    setFindings((prev) => prev.filter((f) => f.id !== findingId));
  }

  async function handleMarkFixed(findingId: string) {
    await updateFindingStatus(appId, findingId, "fixed");
    removeLocally(findingId);
  }

  async function handleMarkNotApplicable(findingId: string) {
    await updateFindingStatus(appId, findingId, "not_applicable");
    removeLocally(findingId);
  }

  useEffect(() => {
    const channel = supabase
      .channel(`onboarding-findings-${appId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "onboarding_findings",
          filter: `app_id=eq.${appId}`,
        },
        (payload) => {
          const row = payload.new as OnboardingFinding;
          if (row.status !== "open") return;
          setFindings((prev) => (prev.some((f) => f.id === row.id) ? prev : [row, ...prev]));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "onboarding_findings",
          filter: `app_id=eq.${appId}`,
        },
        (payload) => {
          const row = payload.new as OnboardingFinding;
          // Resolved findings drop out of the (status = 'open') list this
          // view renders — same "optimistic local update" pattern as
          // AppResearchView's markActedOn.
          if (row.status !== "open") {
            setFindings((prev) => prev.filter((f) => f.id !== row.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [appId]);

  const sortedFindings = [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );

  const nextAuditRun = getNextMonthlyOccurrence(
    MONTHLY_AUTOMATIONS.find((a) => a.id === "monthly-onboarding-scan")!
  );

  if (sortedFindings.length === 0) {
    return (
      <AgentActionEmptyState
        appId={appId}
        actionType="onboarding_audit"
        planTier={planTier}
        agentCreditsUsedThisWeek={agentCreditsUsedThisWeek}
        agentCreditsResetAt={agentCreditsResetAt}
        agentActionCooldowns={agentActionCooldowns}
        firstRun={
          firstAuditCompletedAt
            ? { completed: true, completedAt: firstAuditCompletedAt }
            : undefined
        }
        nextRunAt={nextAuditRun}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {sortedFindings.map((finding) => (
        <AuditFindingCard
          key={finding.id}
          findingType={finding.finding_type}
          severity={finding.severity}
          issueDescription={finding.issue_description}
          suggestedFix={finding.suggested_fix}
          status={finding.status}
          onMarkFixed={() => handleMarkFixed(finding.id)}
          onMarkNotApplicable={() => handleMarkNotApplicable(finding.id)}
          onSubmitFeedback={(note) => submitFindingFeedback(appId, finding.id, note)}
        />
      ))}
    </div>
  );
}
