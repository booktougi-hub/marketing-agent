"use client";

import { useState } from "react";
import { GeoScoreSummary } from "@/components/apps/geo-score-summary";
import { SeoFindingCard } from "@/components/apps/app-seo-view";
import { DemoDataBanner } from "@/components/apps/demo-data-banner";
import {
  DEMO_GEO_SCORE,
  DEMO_GEO_DIM_SCORES,
  DEMO_GEO_CHECK_RESULTS,
  DEMO_GEO_RUN_AT,
  DEMO_GEO_FINDINGS,
} from "@/lib/demoData/geoDemoData";

// GEO scoring itself isn't built yet (no evaluator, no real trigger job —
// see PHASES.md Notes Log) — this whole view is a UI/data-shape preview,
// always local-only (nothing fetched, nothing persisted, no Supabase
// realtime subscription the way app-seo-view.tsx has). Swapping this to
// real data later means replacing the demo data imports with a real fetch
// of track='geo' rows from seo_geo_scores/seo_geo_findings, the same way
// app-seo-view.tsx already reads track='seo' rows — the schema already
// supports it.
export function AppGeoView() {
  const [demoFindings, setDemoFindings] = useState(DEMO_GEO_FINDINGS);

  return (
    <div className="flex flex-col gap-4">
      <DemoDataBanner message="GEO scoring isn't built yet — showing example data so you can see what a real score and findings will look like once it is." />

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
    </div>
  );
}
