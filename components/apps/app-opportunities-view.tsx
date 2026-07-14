"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AgentActionEmptyState } from "@/components/apps/agent-action-empty-state";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/time";
import { getNextResearchOccurrence } from "@/lib/schedule";
import {
  OPPORTUNITY_PLATFORM_COLOR_VAR,
  OPPORTUNITY_PLATFORM_LABEL,
  RELEVANCE_COLOR_VAR,
  RELEVANCE_LABEL,
  parseForumOpportunity,
  type OpportunityPlatform,
} from "@/lib/opportunity";
import type { PlanTier, ResearchDay, ResearchFinding, ResearchStatus } from "@/types";

export type OpportunityFinding = Pick<
  ResearchFinding,
  "id" | "findings" | "status" | "created_at"
>;

type TimeTab = "week" | "month" | "all";
type PlatformFilter = "all" | OpportunityPlatform;

const TIME_TABS: { value: TimeTab; label: string }[] = [
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All" },
];

const PLATFORM_FILTERS: { value: PlatformFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "reddit", label: "Reddit" },
  { value: "hackernews", label: "Hacker News" },
  { value: "quora", label: "Quora" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const EXCERPT_LENGTH = 200;

function withinRange(dateStr: string, tab: TimeTab) {
  if (tab === "all") return true;
  const windowMs = (tab === "week" ? 7 : 30) * DAY_MS;
  return new Date(dateStr).getTime() >= Date.now() - windowMs;
}

function PlatformBadge({ platform }: { platform: OpportunityPlatform }) {
  const colorVar = OPPORTUNITY_PLATFORM_COLOR_VAR[platform];
  return (
    <Badge
      variant="outline"
      className="border-transparent font-medium"
      style={{
        backgroundColor: `color-mix(in oklch, ${colorVar} 16%, transparent)`,
        color: colorVar,
      }}
    >
      {OPPORTUNITY_PLATFORM_LABEL[platform]}
    </Badge>
  );
}

function RelevanceIndicator({
  relevance,
}: {
  relevance: "high" | "medium" | "low" | null;
}) {
  if (!relevance) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: RELEVANCE_COLOR_VAR[relevance] }}
      />
      <span className="text-xs text-muted-foreground">
        {RELEVANCE_LABEL[relevance]} relevance
      </span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

interface OpportunityCardProps {
  finding: OpportunityFinding;
  excerptExpanded: boolean;
  replyExpanded: boolean;
  copied: boolean;
  dismissing: boolean;
  error?: string;
  onToggleExcerpt: () => void;
  onToggleReply: () => void;
  onCopyReply: (text: string) => void;
  onDismiss: () => void;
}

function OpportunityCard({
  finding,
  excerptExpanded,
  replyExpanded,
  copied,
  dismissing,
  error,
  onToggleExcerpt,
  onToggleReply,
  onCopyReply,
  onDismiss,
}: OpportunityCardProps) {
  const parsed = parseForumOpportunity(finding.findings);
  const isDismissed = finding.status === "dismissed";
  const postedAt = parsed.postedAt ?? finding.created_at;
  const content = parsed.content;
  const isLongContent = (content?.length ?? 0) > EXCERPT_LENGTH;
  const excerpt =
    content && (excerptExpanded || !isLongContent)
      ? content
      : content
        ? `${content.slice(0, EXCERPT_LENGTH)}…`
        : null;

  return (
    <Card className={cn(isDismissed && "opacity-50")}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {parsed.platform && <PlatformBadge platform={parsed.platform} />}
            {parsed.sourceName && (
              <span className="text-xs text-muted-foreground">{parsed.sourceName}</span>
            )}
          </div>
          <RelevanceIndicator relevance={parsed.relevance} />
        </div>

        <h3 className="text-base font-semibold leading-snug">
          {parsed.title ?? "Untitled thread"}
        </h3>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{formatTimeAgo(postedAt)}</span>
          {parsed.engagementCount !== null && (
            <span>{parsed.engagementCount.toLocaleString()} upvotes</span>
          )}
        </div>

        {excerpt && (
          <div className="flex flex-col items-start gap-1">
            <p className="text-sm text-muted-foreground">{excerpt}</p>
            {isLongContent && (
              <button
                type="button"
                onClick={onToggleExcerpt}
                className="text-xs font-medium text-primary hover:underline"
              >
                {excerptExpanded ? "Show less" : "Read more"}
              </button>
            )}
          </div>
        )}

        <div className="border-t pt-3">
          <button
            type="button"
            onClick={onToggleReply}
            className="flex w-full items-center justify-between text-sm font-medium"
          >
            Drafted reply
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", replyExpanded && "rotate-180")}
            />
          </button>

          {replyExpanded && (
            <div className="mt-3 flex flex-col gap-3">
              {parsed.draftedReply ? (
                <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                  {parsed.draftedReply}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No drafted reply available yet.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!parsed.draftedReply}
                  onClick={() => onCopyReply(parsed.draftedReply ?? "")}
                >
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy Reply"}
                </Button>

                {parsed.url ? (
                  <a
                    href={parsed.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    <ExternalLink />
                    View Thread
                  </a>
                ) : null}

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={dismissing || isDismissed}
                  onClick={onDismiss}
                >
                  {dismissing && <Loader2 className="animate-spin" />}
                  {isDismissed ? "Dismissed" : "Dismiss"}
                </Button>
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function AppOpportunitiesView({
  appId,
  initialFindings,
  planTier,
  agentCreditsUsedThisWeek,
  agentCreditsResetAt,
  lastAgentActionAt,
  firstResearchCompleted,
  firstResearchCompletedAt,
  preferredResearchDay,
  preferredResearchHour,
}: {
  appId: string;
  initialFindings: OpportunityFinding[];
  planTier: PlanTier;
  agentCreditsUsedThisWeek: number;
  agentCreditsResetAt: string | null;
  lastAgentActionAt: string | null;
  firstResearchCompleted: boolean;
  firstResearchCompletedAt: string | null;
  preferredResearchDay: ResearchDay;
  preferredResearchHour: number;
}) {
  const [findings, setFindings] = useState(initialFindings);
  const [timeTab, setTimeTab] = useState<TimeTab>("week");
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [showDismissed, setShowDismissed] = useState(false);

  const [expandedExcerpts, setExpandedExcerpts] = useState<Set<string>>(new Set());
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  function toggleFromSet(setter: typeof setExpandedExcerpts, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setRowError(id: string, message: string | null) {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  const visible = useMemo(() => {
    return findings
      .filter((f) => showDismissed || f.status !== "dismissed")
      .filter((f) => {
        if (platformFilter === "all") return true;
        return parseForumOpportunity(f.findings).platform === platformFilter;
      })
      .filter((f) => withinRange(f.created_at, timeTab))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [findings, showDismissed, platformFilter, timeTab]);

  async function handleCopyReply(id: string, text: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 2000);
    } catch {
      setRowError(id, "Couldn't copy to clipboard.");
    }
  }

  async function handleDismiss(id: string) {
    setDismissingId(id);
    setRowError(id, null);
    try {
      const res = await fetch(`/api/apps/${appId}/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setRowError(id, json?.error ?? "Failed to dismiss this opportunity.");
        return;
      }
      setFindings((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, status: "dismissed" as ResearchStatus } : f
        )
      );
    } catch {
      setRowError(id, "Failed to dismiss this opportunity.");
    } finally {
      setDismissingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
            {TIME_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setTimeTab(tab.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  timeTab === tab.value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowDismissed((prev) => !prev)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              showDismissed
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            Show Dismissed
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {PLATFORM_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setPlatformFilter(filter.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                platformFilter === filter.value
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {findings.length === 0 ? (
        <AgentActionEmptyState
          appId={appId}
          actionType="forum_opportunity_scan"
          planTier={planTier}
          agentCreditsUsedThisWeek={agentCreditsUsedThisWeek}
          agentCreditsResetAt={agentCreditsResetAt}
          lastAgentActionAt={lastAgentActionAt}
          firstRun={{ completed: firstResearchCompleted, completedAt: firstResearchCompletedAt }}
          nextRunAt={getNextResearchOccurrence(preferredResearchDay, preferredResearchHour)}
        />
      ) : visible.length === 0 ? (
        <EmptyState message="No opportunities match these filters." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visible.map((finding) => (
            <OpportunityCard
              key={finding.id}
              finding={finding}
              excerptExpanded={expandedExcerpts.has(finding.id)}
              replyExpanded={expandedReplies.has(finding.id)}
              copied={copiedId === finding.id}
              dismissing={dismissingId === finding.id}
              error={rowErrors[finding.id]}
              onToggleExcerpt={() => toggleFromSet(setExpandedExcerpts, finding.id)}
              onToggleReply={() => toggleFromSet(setExpandedReplies, finding.id)}
              onCopyReply={(text) => handleCopyReply(finding.id, text)}
              onDismiss={() => handleDismiss(finding.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
