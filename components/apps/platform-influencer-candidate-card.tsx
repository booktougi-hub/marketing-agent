"use client";

import { ExternalLink, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PLATFORM_INFLUENCER_METRIC_LABELS } from "@/lib/platform";
import type { CostTier, InfluencerCandidate } from "@/lib/dummy-data/platform-detail";
import type { ContentPlatform } from "@/types";

const numberFormatter = new Intl.NumberFormat(undefined, { notation: "compact" });

const COST_TIER_COLOR_VAR: Record<CostTier, string> = {
  Nano: "var(--chart-2)",
  Micro: "var(--chart-1)",
  Mid: "var(--chart-3)",
  Macro: "var(--chart-6)",
};

// Deliberately distinct from PlatformChannelIdentity's avatar treatment
// (dashed ring + square-ish radius vs. that one's solid circle) — this is a
// discovered candidate, not the founder's own connected account, and the
// two should never be visually confusable at a glance.
function CandidateAvatar({ initials }: { initials: string }) {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 text-sm font-semibold text-muted-foreground">
      {initials}
    </div>
  );
}

function CandidateStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function PlatformInfluencerCandidateCard({
  platform,
  candidate,
  onOpenDetail,
  onGenerateOutreach,
  onViewChannel,
}: {
  platform: ContentPlatform;
  candidate: InfluencerCandidate;
  onOpenDetail: () => void;
  onGenerateOutreach: () => void;
  onViewChannel: () => void;
}) {
  // Falls back to generic Reach/Engagement rate/Posts published/Followers
  // wording for any platform not yet in PLATFORM_INFLUENCER_METRIC_LABELS
  // (lib/platform.ts) — keeps this card safe to reuse if another platform
  // is ever added to the detail view before its terminology is defined.
  const labels = PLATFORM_INFLUENCER_METRIC_LABELS[platform] ?? {
    reach: "Reach",
    engagement: "Engagement rate",
    published: "Posts published",
    followers: "Followers",
  };

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpenDetail();
      }}
      className="cursor-pointer transition-colors hover:bg-accent/40"
    >
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <CandidateAvatar initials={candidate.avatarInitials} />
            <span className="text-sm font-medium">{candidate.name}</span>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 border-transparent font-medium"
            style={{
              backgroundColor: `color-mix(in oklch, ${COST_TIER_COLOR_VAR[candidate.costTier]} 16%, transparent)`,
              color: COST_TIER_COLOR_VAR[candidate.costTier],
            }}
          >
            {candidate.costTier}
          </Badge>
        </div>

        <div className="grid grid-cols-4 gap-2 rounded-md border p-2.5">
          <CandidateStat label={labels.reach} value={numberFormatter.format(candidate.reach)} />
          <CandidateStat label={labels.engagement} value={candidate.engagementRate} />
          <CandidateStat label={labels.published} value={String(candidate.postsPublished)} />
          <CandidateStat label={labels.followers} value={numberFormatter.format(candidate.followers)} />
        </div>

        <p className="text-sm text-muted-foreground">{candidate.matchReason}</p>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button
            type="button"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onGenerateOutreach();
            }}
          >
            <Send className="size-3.5" />
            Generate outreach message
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              onViewChannel();
            }}
          >
            <ExternalLink className="size-3.5" />
            View channel
          </Button>
          {/* TODO: "View channel" should open the candidate's real profile
              URL once the niche-influencer-discovery job stores one —
              currently a no-op placeholder since dummy candidates have no
              real URL. */}
        </div>
      </CardContent>
    </Card>
  );
}
