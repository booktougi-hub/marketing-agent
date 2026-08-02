"use client";

import { useEffect, useState } from "react";
import { AgentActionEmptyState } from "@/components/apps/agent-action-empty-state";
import { GeoScoreSummary } from "@/components/apps/geo-score-summary";
import { SeoFindingCard } from "@/components/apps/app-seo-view";
import { DemoDataBanner } from "@/components/apps/demo-data-banner";
import { supabase } from "@/lib/supabase";
import { getNextWeeklyOccurrence, WEEKLY_AUTOMATIONS } from "@/lib/schedule";
import {
  DEMO_GEO_SCORE,
  DEMO_GEO_DIM_SCORES,
  DEMO_GEO_CHECK_RESULTS,
  DEMO_GEO_RUN_AT,
  DEMO_GEO_FINDINGS,
} from "@/lib/demoData/geoDemoData";
import type { GeoDimScores, PlanTier, SeoGeoCheckResultMap, SeoGeoFinding } from "@/types";

// Real GEO panel — mirrors components/apps/app-seo-view.tsx exactly (same
// realtime subscription, same empty-state-before-first-run pattern, same
// SeoFindingCard/AuditFindingCard reuse). GEO score/findings come from the
// same seo_geo_scores/seo_geo_findings tables as SEO, filtered to
// track='geo', and share the same seo-findings API routes (see that route's
// comment for why it isn't track-filtered). Both tracks are produced by the
// same trigger/seo-geo-audit.ts run and the same weekly-seo-scan cron —
// there's no separate "GEO scan" credit action, so this reuses the SEO
// panel's "seo_audit" action type for the empty-state's next-run/credit
// messaging.

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

function DemoGeoPreview({ appId, planTier, agentCreditsUsedThisWeek, agentCreditsResetAt, agentActionCooldowns, nextAuditRun }: {
  appId: string;
  planTier: PlanTier;
  agentCreditsUsedThisWeek: number;
  agentCreditsResetAt: string | null;
  agentActionCooldowns: Record<string, string> | null;
  nextAuditRun: Date;
}) {
  const [demoFindings, setDemoFindings] = useState(DEMO_GEO_FINDINGS);

  return (
    <div className="flex flex-col gap-4">
      <DemoDataBanner message="No GEO audit has run for this app yet — showing example data so you can see what a real score and findings will look like." />

      <GeoScoreSummary
        score={DEMO_GEO_SCORE}
        dimScores={DEMO_GEO_DIM_SCORES}
        checkResults={DEMO_GEO_CHECK_RESULTS}
        runAt={DEMO_GEO_RUN_AT}
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
        agentActionCooldowns={agentActionCooldowns}
        nextRunAt={nextAuditRun}
      />
    </div>
  );
}

export function AppGeoView({
  appId,
  initialFindings,
  latestScore,
  planTier,
  agentCreditsUsedThisWeek,
  agentCreditsResetAt,
  agentActionCooldowns,
}: {
  appId: string;
  initialFindings: SeoGeoFinding[];
  latestScore: { score: number; dim_scores: GeoDimScores; check_results: SeoGeoCheckResultMap; run_at: string } | null;
  planTier: PlanTier;
  agentCreditsUsedThisWeek: number;
  agentCreditsResetAt: string | null;
  agentActionCooldowns: Record<string, string> | null;
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
      .channel(`geo-findings-${appId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "seo_geo_findings", filter: `app_id=eq.${appId}` },
        (payload) => {
          const row = payload.new as SeoGeoFinding;
          if (row.track !== "geo" || row.status !== "open") return;
          setFindings((prev) => (prev.some((f) => f.id === row.id) ? prev : [row, ...prev]));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "seo_geo_findings", filter: `app_id=eq.${appId}` },
        (payload) => {
          const row = payload.new as SeoGeoFinding;
          if (row.track !== "geo") return;
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
      <DemoGeoPreview
        appId={appId}
        planTier={planTier}
        agentCreditsUsedThisWeek={agentCreditsUsedThisWeek}
        agentCreditsResetAt={agentCreditsResetAt}
        agentActionCooldowns={agentActionCooldowns}
        nextAuditRun={nextAuditRun}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <GeoScoreSummary
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
