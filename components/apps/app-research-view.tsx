"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Loader2, Search, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AgentActionEmptyState } from "@/components/apps/agent-action-empty-state";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import {
  TOPIC_SOURCE_COLOR_VAR,
  TOPIC_SOURCE_LABEL,
  parseCompetitorGap,
  parseProblem,
  parseTopic,
} from "@/lib/research";
import { getNextMonthlyOccurrence, getNextResearchOccurrence, MONTHLY_AUTOMATIONS } from "@/lib/schedule";
import type { ContentPlatform, PlanTier, ResearchDay, ResearchFinding } from "@/types";

type FindingRow = Pick<ResearchFinding, "id" | "findings" | "status" | "week_of" | "created_at">;
type FindingType = "topic" | "problem" | "competitor_gap";
type DraftPlatform = "twitter" | "linkedin" | "devto";
type DraftedPlatformsMap = Record<string, ContentPlatform[]>;

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

async function createDraftFromFinding({
  appId,
  findingId,
  type,
  platform,
}: {
  appId: string;
  findingId: string;
  type: FindingType;
  platform: DraftPlatform;
}) {
  const res = await fetch(`/api/apps/${appId}/content/from-research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ research_finding_id: findingId, type, platform }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to create draft.");
  }
  return json;
}

// Optimistic local update mirroring what the realtime UPDATE subscription
// will apply moments later — keeps the card's disabled state instant
// instead of waiting on the round trip.
function markActedOn(setter: (updater: (prev: FindingRow[]) => FindingRow[]) => void, id: string) {
  setter((prev) => prev.map((f) => (f.id === id ? { ...f, status: "acted_on" } : f)));
}

function draftsUrl(appId: string) {
  return `/dashboard/apps/${appId}/content?tab=drafts`;
}

const DRAFT_BUTTONS: { value: DraftPlatform; label: string; draftedLabel: string }[] = [
  { value: "twitter", label: "Draft Tweet", draftedLabel: "Tweet Drafted — View" },
  { value: "linkedin", label: "Draft LinkedIn Post", draftedLabel: "LinkedIn Drafted — View" },
  { value: "devto", label: "Draft Article", draftedLabel: "Article Drafted — View" },
];

// The three draft-destination buttons shared by every finding card. Each
// platform tracks its own in-flight/drafted state independently — a single
// finding can seed a tweet AND a LinkedIn post AND an article, so clicking
// one must never disable the others.
function DraftButtonsRow({
  appId,
  findingId,
  type,
  primaryPlatform,
  draftedPlatforms,
  onDrafted,
  disabled,
}: {
  appId: string;
  findingId: string;
  type: FindingType;
  primaryPlatform: DraftPlatform;
  draftedPlatforms: ContentPlatform[];
  onDrafted: (platform: DraftPlatform) => void;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pendingPlatform, setPendingPlatform] = useState<DraftPlatform | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(platform: DraftPlatform) {
    if (draftedPlatforms.includes(platform)) {
      router.push(draftsUrl(appId));
      return;
    }
    setPendingPlatform(platform);
    setError(null);
    try {
      await createDraftFromFinding({ appId, findingId, type, platform });
      onDrafted(platform);
      toast.success("Draft created", {
        action: { label: "View in Content", onClick: () => router.push(draftsUrl(appId)) },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create draft.";
      setError(message);
      toast.error(message);
    } finally {
      setPendingPlatform(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {DRAFT_BUTTONS.map(({ value, label, draftedLabel }) => {
          const isDrafted = draftedPlatforms.includes(value);
          const isPending = pendingPlatform === value;
          return (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={isDrafted ? "secondary" : value === primaryPlatform ? "default" : "outline"}
              disabled={disabled || (pendingPlatform !== null && !isPending)}
              onClick={() => handleClick(value)}
            >
              {isPending && <Loader2 className="animate-spin" />}
              {isDrafted ? draftedLabel : label}
            </Button>
          );
        })}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// Separate from drafting entirely — this never generates content. It just
// queues the finding's text as a keyword for the Forum Opportunity Finder's
// next run, since a Reddit post always has to be a reply to a thread that
// job actually finds, never a standalone draft.
function ForumSeedButton({ appId, findingId }: { appId: string; findingId: string }) {
  const [seeding, setSeeding] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSeeding(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/research/seed-forum-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ research_finding_id: findingId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error ?? "Failed to queue forum search.");
      }
      setSeeded(true);
      toast.success("Added to the next Forum Opportunity scan");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to queue forum search.";
      setError(message);
      toast.error(message);
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit"
        disabled={seeding || seeded}
        onClick={handleClick}
      >
        {seeding ? <Loader2 className="animate-spin" /> : <Search className="size-3.5" />}
        {seeded ? "Added to Forum Search" : "Search Forums For This"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function TopicCard({
  appId,
  finding,
  draftedPlatforms,
  onDrafted,
}: {
  appId: string;
  finding: FindingRow;
  draftedPlatforms: ContentPlatform[];
  onDrafted: (platform: DraftPlatform) => void;
}) {
  const parsed = parseTopic(finding.findings);
  const TrendIcon = parsed.trend ? TREND_ICON[parsed.trend] : null;

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

        <DraftButtonsRow
          appId={appId}
          findingId={finding.id}
          type="topic"
          primaryPlatform="twitter"
          draftedPlatforms={draftedPlatforms}
          onDrafted={onDrafted}
          disabled={!parsed.topic}
        />
      </CardContent>
    </Card>
  );
}

function ProblemCard({
  appId,
  finding,
  draftedPlatforms,
  onDrafted,
}: {
  appId: string;
  finding: FindingRow;
  draftedPlatforms: ContentPlatform[];
  onDrafted: (platform: DraftPlatform) => void;
}) {
  const parsed = parseProblem(finding.findings);

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

        <DraftButtonsRow
          appId={appId}
          findingId={finding.id}
          type="problem"
          primaryPlatform="twitter"
          draftedPlatforms={draftedPlatforms}
          onDrafted={onDrafted}
          disabled={!parsed.statement}
        />

        <ForumSeedButton appId={appId} findingId={finding.id} />
      </CardContent>
    </Card>
  );
}

function CompetitorGapCard({
  appId,
  finding,
  draftedPlatforms,
  onDrafted,
}: {
  appId: string;
  finding: FindingRow;
  draftedPlatforms: ContentPlatform[];
  onDrafted: (platform: DraftPlatform) => void;
}) {
  const parsed = parseCompetitorGap(finding.findings);

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

        <DraftButtonsRow
          appId={appId}
          findingId={finding.id}
          type="competitor_gap"
          primaryPlatform="devto"
          draftedPlatforms={draftedPlatforms}
          onDrafted={onDrafted}
          disabled={!parsed.gap}
        />

        <ForumSeedButton appId={appId} findingId={finding.id} />
      </CardContent>
    </Card>
  );
}

export function AppResearchView({
  appId,
  initialTopics,
  initialProblems,
  initialCompetitors,
  knownCompetitors,
  initialDraftedPlatforms,
  planTier,
  agentCreditsUsedThisWeek,
  agentCreditsResetAt,
  agentActionCooldowns,
  firstResearchCompleted,
  firstResearchCompletedAt,
  preferredResearchDay,
  preferredResearchHour,
}: {
  appId: string;
  initialTopics: FindingRow[];
  initialProblems: FindingRow[];
  initialCompetitors: FindingRow[];
  // The app's DNA-listed (or auto-discovered) competitor names — shown even
  // when no gap finding exists yet, since a gap only appears once Claude
  // finds a genuine, groundable weakness for one of them. Without this, a
  // freshly-discovered competitor list is invisible in the UI until/unless
  // that happens.
  knownCompetitors: string[];
  initialDraftedPlatforms: DraftedPlatformsMap;
  planTier: PlanTier;
  agentCreditsUsedThisWeek: number;
  agentCreditsResetAt: string | null;
  agentActionCooldowns: Record<string, string> | null;
  firstResearchCompleted: boolean;
  firstResearchCompletedAt: string | null;
  preferredResearchDay: ResearchDay;
  preferredResearchHour: number;
}) {
  const [tab, setTab] = useState<ResearchTab>("topics");
  const [topics, setTopics] = useState(initialTopics);
  const [problems, setProblems] = useState(initialProblems);
  const [competitors, setCompetitors] = useState(initialCompetitors);
  const [draftedPlatforms, setDraftedPlatforms] = useState<DraftedPlatformsMap>(
    initialDraftedPlatforms
  );

  const nextWeeklyResearchRun = getNextResearchOccurrence(
    preferredResearchDay,
    preferredResearchHour
  );
  const nextCompetitorScanRun = getNextMonthlyOccurrence(
    MONTHLY_AUTOMATIONS.find((a) => a.id === "monthly-competitor-scan")!
  );

  function handleDrafted(
    listSetter: (updater: (prev: FindingRow[]) => FindingRow[]) => void,
    findingId: string,
    platform: DraftPlatform
  ) {
    setDraftedPlatforms((prev) => {
      const existing = prev[findingId] ?? [];
      if (existing.includes(platform)) return prev;
      return { ...prev, [findingId]: [...existing, platform] };
    });
    markActedOn(listSetter, findingId);
  }

  useEffect(() => {
    const channel = supabase
      .channel(`research-findings-${appId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "research_findings",
          filter: `app_id=eq.${appId}`,
        },
        (payload) => {
          const row = payload.new as FindingRow & { stream: string };
          const entry: FindingRow = {
            id: row.id,
            findings: row.findings,
            status: row.status,
            week_of: row.week_of,
            created_at: row.created_at,
          };
          const appendUnique = (prev: FindingRow[]) =>
            prev.some((f) => f.id === entry.id) ? prev : [entry, ...prev];

          if (row.stream === "topic_research") {
            setTopics(appendUnique);
          } else if (row.stream === "problem_discovery") {
            setProblems(appendUnique);
          } else if (row.stream === "competitor_gap") {
            setCompetitors(appendUnique);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "research_findings",
          filter: `app_id=eq.${appId}`,
        },
        (payload) => {
          const row = payload.new as FindingRow & { stream: string };
          const applyStatus = (prev: FindingRow[]) =>
            prev.map((f) => (f.id === row.id ? { ...f, status: row.status } : f));

          if (row.stream === "topic_research") {
            setTopics(applyStatus);
          } else if (row.stream === "problem_discovery") {
            setProblems(applyStatus);
          } else if (row.stream === "competitor_gap") {
            setCompetitors(applyStatus);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [appId]);

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
        (topics.length === 0 ? (
          <AgentActionEmptyState
            appId={appId}
            actionType="topic_and_problem_research"
            planTier={planTier}
            agentCreditsUsedThisWeek={agentCreditsUsedThisWeek}
            agentCreditsResetAt={agentCreditsResetAt}
            agentActionCooldowns={agentActionCooldowns}
            firstRun={{ completed: firstResearchCompleted, completedAt: firstResearchCompletedAt }}
            nextRunAt={nextWeeklyResearchRun}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {topics.map((finding) => (
              <TopicCard
                key={finding.id}
                appId={appId}
                finding={finding}
                draftedPlatforms={draftedPlatforms[finding.id] ?? []}
                onDrafted={(platform) => handleDrafted(setTopics, finding.id, platform)}
              />
            ))}
          </div>
        ))}

      {tab === "problems" &&
        (problems.length === 0 ? (
          <AgentActionEmptyState
            appId={appId}
            actionType="topic_and_problem_research"
            planTier={planTier}
            agentCreditsUsedThisWeek={agentCreditsUsedThisWeek}
            agentCreditsResetAt={agentCreditsResetAt}
            agentActionCooldowns={agentActionCooldowns}
            firstRun={{ completed: firstResearchCompleted, completedAt: firstResearchCompletedAt }}
            nextRunAt={nextWeeklyResearchRun}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {problems.map((finding) => (
              <ProblemCard
                key={finding.id}
                appId={appId}
                finding={finding}
                draftedPlatforms={draftedPlatforms[finding.id] ?? []}
                onDrafted={(platform) => handleDrafted(setProblems, finding.id, platform)}
              />
            ))}
          </div>
        ))}

      {tab === "competitors" && (
        <div className="flex flex-col gap-4">
          {knownCompetitors.length > 0 && (
            <Card>
              <CardContent className="flex flex-col gap-2">
                <p className="text-sm font-semibold">
                  Tracking {knownCompetitors.length} competitor
                  {knownCompetitors.length === 1 ? "" : "s"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {knownCompetitors.map((name) => (
                    <Badge key={name} variant="outline">
                      {name}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Gap cards below only appear once a genuine, groundable weakness is found for
                  one of these — newer or niche competitors may not have public reviews yet.
                </p>
              </CardContent>
            </Card>
          )}

          {competitors.length === 0 ? (
            <AgentActionEmptyState
              appId={appId}
              actionType="competitor_gap_analysis"
              planTier={planTier}
              agentCreditsUsedThisWeek={agentCreditsUsedThisWeek}
              agentCreditsResetAt={agentCreditsResetAt}
              agentActionCooldowns={agentActionCooldowns}
              firstRun={{ completed: firstResearchCompleted, completedAt: firstResearchCompletedAt }}
              nextRunAt={nextCompetitorScanRun}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {competitors.map((finding) => (
                <CompetitorGapCard
                  key={finding.id}
                  appId={appId}
                  finding={finding}
                  draftedPlatforms={draftedPlatforms[finding.id] ?? []}
                  onDrafted={(platform) => handleDrafted(setCompetitors, finding.id, platform)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
