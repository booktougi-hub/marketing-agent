"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  TOPIC_SOURCE_COLOR_VAR,
  TOPIC_SOURCE_LABEL,
  parseCompetitorGap,
  parseProblem,
  parseTopic,
} from "@/lib/research";
import type { ResearchFinding } from "@/types";

type FindingRow = Pick<ResearchFinding, "id" | "findings" | "status" | "week_of" | "created_at">;

type ResearchTab = "topics" | "problems" | "competitors";

const TABS: { value: ResearchTab; label: string }[] = [
  { value: "topics", label: "Topics" },
  { value: "problems", label: "Problems" },
  { value: "competitors", label: "Competitors" },
];

const TREND_ICON = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
} as const;

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function TopicCard({ appId, finding }: { appId: string; finding: FindingRow }) {
  const router = useRouter();
  const parsed = parseTopic(finding.findings);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const TrendIcon = parsed.trend ? TREND_ICON[parsed.trend] : null;

  async function handleUseTopic() {
    if (!parsed.topic) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: parsed.topic, angle: parsed.angle ?? undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Failed to create draft post.");
        setCreating(false);
        return;
      }
      router.push(`/dashboard/apps/${appId}/content`);
    } catch {
      setError("Failed to create draft post.");
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold leading-snug">
            {parsed.topic ?? "Untitled topic"}
          </h3>
          {parsed.source && (
            <Badge
              variant="outline"
              className="shrink-0 border-transparent font-medium"
              style={{
                backgroundColor: `color-mix(in oklch, ${TOPIC_SOURCE_COLOR_VAR[parsed.source]} 16%, transparent)`,
                color: TOPIC_SOURCE_COLOR_VAR[parsed.source],
              }}
            >
              {TOPIC_SOURCE_LABEL[parsed.source]}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {parsed.searchVolume !== null ? (
            <span>{parsed.searchVolume.toLocaleString()} searches/mo</span>
          ) : TrendIcon ? (
            <>
              <TrendIcon className="h-3.5 w-3.5" />
              <span className="capitalize">Trending {parsed.trend}</span>
            </>
          ) : (
            <span>No trend data yet</span>
          )}
        </div>

        {parsed.angle && <p className="text-sm text-muted-foreground">{parsed.angle}</p>}

        <div>
          <Button
            type="button"
            size="sm"
            disabled={creating || !parsed.topic}
            onClick={handleUseTopic}
          >
            {creating && <Loader2 className="animate-spin" />}
            Use This Topic
          </Button>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ProblemCard({ appId, finding }: { appId: string; finding: FindingRow }) {
  const parsed = parseProblem(finding.findings);
  const [status, setStatus] = useState(finding.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isUsed = status === "acted_on";

  async function handleUseInEmail() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/research/${finding.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "acted_on" }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Failed to use this problem.");
        return;
      }
      setStatus("acted_on");
    } catch {
      setError("Failed to use this problem.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <p className="text-base italic leading-snug">
          {parsed.statement ? `“${parsed.statement}”` : "No statement captured yet"}
        </p>

        <div className="flex items-center gap-2">
          {parsed.sourcePlatform && (
            <Badge variant="outline">{parsed.sourcePlatform}</Badge>
          )}
          {parsed.sourceUrl && (
            <a
              href={parsed.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              View source
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          {parsed.appFit ?? "No fit summary yet for how your app solves this."}
        </p>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={isUsed ? "secondary" : "default"}
            size="sm"
            disabled={saving || isUsed}
            onClick={handleUseInEmail}
          >
            {saving && <Loader2 className="animate-spin" />}
            {isUsed ? "Added to next batch" : "Use In Email"}
          </Button>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function CompetitorGapCard({ appId, finding }: { appId: string; finding: FindingRow }) {
  const parsed = parseCompetitorGap(finding.findings);
  const [status, setStatus] = useState(finding.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdded = status === "acted_on";

  async function handleAddToStrategy() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/strategy/pillars`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          findingId: finding.id,
          pillar: {
            name: parsed.competitorName ? `${parsed.competitorName} gap` : "Competitor gap",
            description: parsed.positioning ?? parsed.gap ?? "",
            example_topics: parsed.gap ? [parsed.gap] : [],
          },
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Failed to add to strategy.");
        return;
      }
      setStatus("acted_on");
    } catch {
      setError("Failed to add to strategy.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <h3 className="text-base font-semibold leading-snug">
          {parsed.competitorName ?? "Unknown competitor"}
        </h3>

        {parsed.gap && <p className="text-sm">{parsed.gap}</p>}

        {parsed.source && (
          <p className="text-xs text-muted-foreground">Source: {parsed.source}</p>
        )}

        {parsed.positioning && (
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {parsed.positioning}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={isAdded ? "secondary" : "default"}
            size="sm"
            disabled={saving || isAdded}
            onClick={handleAddToStrategy}
          >
            {saving && <Loader2 className="animate-spin" />}
            {isAdded ? "Added to Strategy" : "Add to Strategy"}
          </Button>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

export function AppResearchView({
  appId,
  initialTopics,
  initialProblems,
  initialCompetitors,
}: {
  appId: string;
  initialTopics: FindingRow[];
  initialProblems: FindingRow[];
  initialCompetitors: FindingRow[];
}) {
  const [tab, setTab] = useState<ResearchTab>("topics");

  return (
    <div className="flex flex-col gap-5">
      <div className={cn("flex gap-6 border-b")}>
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setTab(item.value)}
            className={cn(
              "-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
              tab === item.value
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "topics" &&
        (initialTopics.length === 0 ? (
          <EmptyState message="The research agent hasn't found trending topics for your app yet. Check back once the weekly topic scan runs." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {initialTopics.map((finding) => (
              <TopicCard key={finding.id} appId={appId} finding={finding} />
            ))}
          </div>
        ))}

      {tab === "problems" &&
        (initialProblems.length === 0 ? (
          <EmptyState message="No user problems discovered yet. This tab fills in as the research agent finds real user complaints and requests." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {initialProblems.map((finding) => (
              <ProblemCard key={finding.id} appId={appId} finding={finding} />
            ))}
          </div>
        ))}

      {tab === "competitors" &&
        (initialCompetitors.length === 0 ? (
          <EmptyState message="No competitor gaps found yet. This tab fills in once the monthly competitor analysis runs." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {initialCompetitors.map((finding) => (
              <CompetitorGapCard key={finding.id} appId={appId} finding={finding} />
            ))}
          </div>
        ))}
    </div>
  );
}
