"use client";

import { useEffect, useState } from "react";
import { AuditFindingCard, type AuditFindingSeverity, type AuditFindingStatus } from "@/components/apps/audit-finding-card";
import { AgentActionEmptyState } from "@/components/apps/agent-action-empty-state";
import { SeoScoreSummary } from "@/components/apps/seo-score-summary";
import { DemoDataBanner } from "@/components/apps/demo-data-banner";
import { supabase } from "@/lib/supabase";
import { getNextWeeklyOccurrence, WEEKLY_AUTOMATIONS } from "@/lib/schedule";
import {
  DEMO_SEO_SCORE,
  DEMO_SEO_DIM_SCORES,
  DEMO_SEO_CHECK_RESULTS,
  DEMO_SEO_RUN_AT,
  DEMO_SEO_FINDINGS,
} from "@/lib/demoData/seoDemoData";
import type { PlanTier, SeoGeoFinding, SeoGeoRemediation, SeoDimScores, SeoGeoCheckResultMap } from "@/types";

const TIER_TO_SEVERITY: Record<number, AuditFindingSeverity> = { 1: "high", 2: "medium", 3: "low" };

export function remediationText(remediation: SeoGeoRemediation | null): string {
  if (!remediation) return "No remediation available.";
  if (remediation.type === "technical") {
    return remediation.snippet ? `${remediation.instruction} Example: ${remediation.snippet}` : remediation.instruction;
  }
  if (remediation.type === "route_to_forum") return remediation.reason;
  if (remediation.type === "diff") return `Suggested rewrite for "${remediation.section}": ${remediation.after}`;
  return "See the connected repository for the suggested changes.";
}

function findingToCardStatus(status: SeoGeoFinding["status"]): AuditFindingStatus {
  if (status === "applied") return "fixed";
  if (status === "skipped") return "not_applicable";
  return "open";
}

async function updateFindingStatus(appId: string, findingId: string, status: "applied" | "skipped") {
  const res = await fetch(`/api/apps/${appId}/seo-findings/${findingId}`, {
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
  const res = await fetch(`/api/apps/${appId}/seo-findings/${findingId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to send feedback.");
  }
}

// Shared between real findings (backed by seo_geo_findings, via the API
// routes above) and demo findings (local-only, nothing persisted) — same
// card, same mapping from the DB's open/applied/skipped vocabulary to
// AuditFindingCard's open/fixed/not_applicable, different handlers. Also
// reused as-is by components/apps/app-geo-view.tsx's demo findings, since
// the shape (check_id/evidence_tier/explanation/confidence_label/
// remediation/status) is identical for both tracks.
export function SeoFindingCard({
  finding,
  onMarkFixed,
  onMarkNotApplicable,
  onSubmitFeedback,
}: {
  finding: Pick<SeoGeoFinding, "id" | "check_id" | "evidence_tier" | "explanation" | "confidence_label" | "remediation" | "status">;
  onMarkFixed: () => Promise<void>;
  onMarkNotApplicable: () => Promise<void>;
  onSubmitFeedback: (note: string) => Promise<void>;
}) {
  return (
    <AuditFindingCard
      findingType={finding.check_id.replace(/\./g, "_")}
      severity={TIER_TO_SEVERITY[finding.evidence_tier] ?? "medium"}
      issueDescription={`${finding.explanation} (Confidence: ${finding.confidence_label})`}
      suggestedFix={remediationText(finding.remediation)}
      status={findingToCardStatus(finding.status)}
      onMarkFixed={onMarkFixed}
      onMarkNotApplicable={onMarkNotApplicable}
      onSubmitFeedback={onSubmitFeedback}
    />
  );
}

function DemoSeoPreview({ appId, planTier, agentCreditsUsedThisWeek, agentCreditsResetAt, lastAgentActionAt, nextAuditRun }: {
  appId: string;
  planTier: PlanTier;
  agentCreditsUsedThisWeek: number;
  agentCreditsResetAt: string | null;
  lastAgentActionAt: string | null;
  nextAuditRun: Date;
}) {
  const [demoFindings, setDemoFindings] = useState(DEMO_SEO_FINDINGS);

  return (
    <div className="flex flex-col gap-4">
      <DemoDataBanner message="No SEO audit has run for this app yet — showing example data so you can see what a real score and findings will look like." />

      <SeoScoreSummary
        score={DEMO_SEO_SCORE}
        dimScores={DEMO_SEO_DIM_SCORES}
        checkResults={DEMO_SEO_CHECK_RESULTS}
        runAt={DEMO_SEO_RUN_AT}
      />

      {demoFindings.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {demoFindings.map((finding) => (
            <SeoFindingCard
              key={finding.id}
              finding={finding}
              onMarkFixed={async () => setDemoFindings((prev) => prev.filter((f) => f.id !== finding.id))}
              onMarkNotApplicable={async () => setDemoFindings((prev) => prev.filter((f) => f.id !== finding.id))}
              onSubmitFeedback={async () => {}}
            />
          ))}
        </div>
      )}

      <AgentActionEmptyState
        appId={appId}
        actionType="seo_audit"
        planTier={planTier}
        agentCreditsUsedThisWeek={agentCreditsUsedThisWeek}
        agentCreditsResetAt={agentCreditsResetAt}
        lastAgentActionAt={lastAgentActionAt}
        nextRunAt={nextAuditRun}
      />
    </div>
  );
}

export function AppSeoView({
  appId,
  initialFindings,
  latestScore,
  planTier,
  agentCreditsUsedThisWeek,
  agentCreditsResetAt,
  lastAgentActionAt,
}: {
  appId: string;
  initialFindings: SeoGeoFinding[];
  latestScore: { score: number; dim_scores: SeoDimScores; check_results: SeoGeoCheckResultMap; run_at: string } | null;
  planTier: PlanTier;
  agentCreditsUsedThisWeek: number;
  agentCreditsResetAt: string | null;
  lastAgentActionAt: string | null;
}) {
  const [findings, setFindings] = useState(initialFindings);

  function removeLocally(findingId: string) {
    setFindings((prev) => prev.filter((f) => f.id !== findingId));
  }

  async function handleMarkFixed(findingId: string) {
    await updateFindingStatus(appId, findingId, "applied");
    removeLocally(findingId);
  }

  async function handleMarkNotApplicable(findingId: string) {
    await updateFindingStatus(appId, findingId, "skipped");
    removeLocally(findingId);
  }

  useEffect(() => {
    const channel = supabase
      .channel(`seo-findings-${appId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "seo_geo_findings", filter: `app_id=eq.${appId}` },
        (payload) => {
          const row = payload.new as SeoGeoFinding;
          if (row.track !== "seo" || row.status !== "open") return;
          setFindings((prev) => (prev.some((f) => f.id === row.id) ? prev : [row, ...prev]));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "seo_geo_findings", filter: `app_id=eq.${appId}` },
        (payload) => {
          const row = payload.new as SeoGeoFinding;
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

  if (!latestScore) {
    const nextAuditRun = getNextWeeklyOccurrence(
      WEEKLY_AUTOMATIONS.find((a) => a.id === "weekly-seo-scan")!
    );
    return (
      <DemoSeoPreview
        appId={appId}
        planTier={planTier}
        agentCreditsUsedThisWeek={agentCreditsUsedThisWeek}
        agentCreditsResetAt={agentCreditsResetAt}
        lastAgentActionAt={lastAgentActionAt}
        nextAuditRun={nextAuditRun}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SeoScoreSummary
        score={latestScore.score}
        dimScores={latestScore.dim_scores}
        checkResults={latestScore.check_results}
        runAt={latestScore.run_at}
      />

      {findings.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {findings.map((finding) => (
            <SeoFindingCard
              key={finding.id}
              finding={finding}
              onMarkFixed={() => handleMarkFixed(finding.id)}
              onMarkNotApplicable={() => handleMarkNotApplicable(finding.id)}
              onSubmitFeedback={(note) => submitFindingFeedback(appId, finding.id, note)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
