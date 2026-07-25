"use client";

import { useState } from "react";
import { ChevronDown, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/time";
import { getScoreBand, SCORE_BAND_LABEL, type ScoreBand } from "@/lib/seo/checkRegistry";
import { DEMO_GEO_CHECK_LIST, type GeoDimScores } from "@/lib/demoData/geoDemoData";
import type { SeoGeoCheckResultMap } from "@/types";

const BAND_COLOR_VAR: Record<ScoreBand, string> = {
  strong: "var(--chart-2)",
  workable: "var(--chart-3)",
  needs_work: "var(--destructive)",
};

// GEO counterpart to components/apps/seo-score-summary.tsx — same layout
// (score + band, per-dimension breakdown, collapsible full-check list), the
// three GEO dimensions (content_quality/structure/freshness) instead of
// SEO's (retrievability/off_page), and the same 0-49/50-74/75-100 bands
// SCORING.md specifies for both tracks.
export function GeoScoreSummary({
  score,
  dimScores,
  checkResults,
  runAt,
}: {
  score: number;
  dimScores: GeoDimScores;
  checkResults: SeoGeoCheckResultMap;
  runAt: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const band = getScoreBand(score);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-3">
          <span className="text-3xl font-semibold tabular-nums">{score}</span>
          <Badge
            variant="outline"
            className="border-transparent font-medium"
            style={{
              backgroundColor: `color-mix(in oklch, ${BAND_COLOR_VAR[band]} 16%, transparent)`,
              color: BAND_COLOR_VAR[band],
            }}
          >
            {SCORE_BAND_LABEL[band]}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">Last checked {formatTimeAgo(runAt)}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Content quality</p>
            <p className="text-xl font-semibold tabular-nums">{dimScores.content_quality}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Structure</p>
            <p className="text-xl font-semibold tabular-nums">{dimScores.structure}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Freshness</p>
            <p className="text-xl font-semibold tabular-nums">{dimScores.freshness}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="flex items-center gap-1 self-start text-xs font-medium text-primary hover:underline"
        >
          {showAll ? "Hide all checks" : "Show all checks"}
          <ChevronDown className={cn("size-3.5 transition-transform", showAll && "rotate-180")} />
        </button>

        {showAll && (
          <div className="flex flex-col gap-1">
            {DEMO_GEO_CHECK_LIST.map((check) => {
              const result = checkResults[check.id];
              const Icon = !result || !result.measurable ? MinusCircle : result.pass ? CheckCircle2 : XCircle;
              const color = !result || !result.measurable
                ? "var(--muted-foreground)"
                : result.pass
                  ? "var(--chart-2)"
                  : "var(--destructive)";
              return (
                <div key={check.id} className="flex items-center justify-between gap-3 border-t py-2 first:border-t-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="size-3.5 shrink-0" style={{ color }} />
                    <span className="truncate text-xs">{check.description}</span>
                  </div>
                  <span className="shrink-0 text-[10px] font-mono text-muted-foreground">{check.id}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
