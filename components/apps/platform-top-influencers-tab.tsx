"use client";

import { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PlatformInfluencerCandidateCard } from "@/components/apps/platform-influencer-candidate-card";
import { PlatformInfluencerDetailModal } from "@/components/apps/platform-influencer-detail-modal";
import { PlatformOutreachMessageModal } from "@/components/apps/platform-outreach-message-modal";
import { COST_TIERS, type CostTier, type InfluencerCandidate, type InfluencerStatus } from "@/lib/dummy-data/platform-detail";
import type { ContentPlatform } from "@/types";

type SortBy = "relevance" | "engagement" | "followers";
type CostTierFilter = "all" | CostTier;

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "engagement", label: "Engagement rate" },
  { value: "followers", label: "Follower count" },
];

function engagementRateToNumber(rate: string): number {
  return parseFloat(rate.replace("%", "")) || 0;
}

interface CandidateLocalState {
  status: InfluencerStatus;
  notes: string;
}

// Sorting/filtering here is real (against the dummy array) so the page
// feels functional during review, even though the data behind it isn't.
// TODO: replace this client-side sort/filter with a real query once
// influencer candidates come from the database (an influencer_candidates
// table, populated by the niche-influencer-discovery job) instead of
// lib/dummy-data/platform-detail.ts's hardcoded array.
export function PlatformTopInfluencersTab({
  platform,
  candidates,
}: {
  platform: ContentPlatform;
  candidates: InfluencerCandidate[];
}) {
  const [sortBy, setSortBy] = useState<SortBy>("relevance");
  const [tierFilter, setTierFilter] = useState<CostTierFilter>("all");
  const [localState, setLocalState] = useState<Record<string, CandidateLocalState>>(() =>
    Object.fromEntries(candidates.map((c) => [c.id, { status: c.status, notes: "" }]))
  );

  const [detailCandidateId, setDetailCandidateId] = useState<string | null>(null);
  const [outreachCandidateId, setOutreachCandidateId] = useState<string | null>(null);

  const visibleCandidates = useMemo(() => {
    const filtered = candidates.filter((c) => tierFilter === "all" || c.costTier === tierFilter);
    const sorted = [...filtered];
    if (sortBy === "engagement") {
      sorted.sort((a, b) => engagementRateToNumber(b.engagementRate) - engagementRateToNumber(a.engagementRate));
    } else if (sortBy === "followers") {
      sorted.sort((a, b) => b.followers - a.followers);
    }
    // "relevance" keeps the original (dummy) discovery order.
    return sorted;
  }, [candidates, sortBy, tierFilter]);

  function updateLocalState(candidateId: string, patch: Partial<CandidateLocalState>) {
    setLocalState((prev) => ({ ...prev, [candidateId]: { ...prev[candidateId], ...patch } }));
  }

  const detailCandidate = candidates.find((c) => c.id === detailCandidateId) ?? null;
  const outreachCandidate = candidates.find((c) => c.id === outreachCandidateId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Sort by</span>
          <Select items={SORT_OPTIONS} value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTierFilter("all")}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              tierFilter === "all"
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            All tiers
          </button>
          {COST_TIERS.map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => setTierFilter(tier)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                tierFilter === tier
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {tier}
            </button>
          ))}
        </div>
      </div>

      {visibleCandidates.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No candidates match these filters.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visibleCandidates.map((candidate) => (
            <PlatformInfluencerCandidateCard
              key={candidate.id}
              platform={platform}
              candidate={candidate}
              onOpenDetail={() => setDetailCandidateId(candidate.id)}
              onGenerateOutreach={() => setOutreachCandidateId(candidate.id)}
              onViewChannel={() => {
                /* TODO: open the candidate's real profile URL once the
                   niche-influencer-discovery job stores one. */
              }}
            />
          ))}
        </div>
      )}

      <PlatformInfluencerDetailModal
        candidate={detailCandidate}
        open={detailCandidateId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailCandidateId(null);
        }}
        status={detailCandidate ? localState[detailCandidate.id]?.status ?? detailCandidate.status : "not_contacted"}
        onStatusChange={(status) => {
          if (detailCandidate) updateLocalState(detailCandidate.id, { status });
        }}
        notes={detailCandidate ? localState[detailCandidate.id]?.notes ?? "" : ""}
        onNotesChange={(notes) => {
          if (detailCandidate) updateLocalState(detailCandidate.id, { notes });
        }}
      />

      <PlatformOutreachMessageModal
        candidate={outreachCandidate}
        open={outreachCandidateId !== null}
        onOpenChange={(open) => {
          if (!open) setOutreachCandidateId(null);
        }}
      />
    </div>
  );
}
