"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  INFLUENCER_STATUS_LABEL,
  type CostTier,
  type InfluencerCandidate,
  type InfluencerStatus,
} from "@/lib/dummy-data/platform-detail";

const numberFormatter = new Intl.NumberFormat();

const STATUS_OPTIONS: { value: InfluencerStatus; label: string }[] = (
  Object.entries(INFLUENCER_STATUS_LABEL) as [InfluencerStatus, string][]
).map(([value, label]) => ({ value, label }));

const COST_TIER_COLOR_VAR: Record<CostTier, string> = {
  Nano: "var(--chart-2)",
  Micro: "var(--chart-1)",
  Mid: "var(--chart-3)",
  Macro: "var(--chart-6)",
};

export function PlatformInfluencerDetailModal({
  candidate,
  open,
  onOpenChange,
  status,
  onStatusChange,
  notes,
  onNotesChange,
}: {
  candidate: InfluencerCandidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: InfluencerStatus;
  onStatusChange: (status: InfluencerStatus) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
}) {
  if (!candidate) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{candidate.name}</DialogTitle>
          <DialogDescription>
            {numberFormatter.format(candidate.followers)} followers · {candidate.engagementRate}{" "}
            engagement
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-transparent font-medium"
              style={{
                backgroundColor: `color-mix(in oklch, ${COST_TIER_COLOR_VAR[candidate.costTier]} 16%, transparent)`,
                color: COST_TIER_COLOR_VAR[candidate.costTier],
              }}
            >
              {candidate.costTier}
            </Badge>
            {candidate.contactEmail ? (
              <span className="text-sm text-muted-foreground">{candidate.contactEmail}</span>
            ) : (
              <span className="text-sm text-muted-foreground italic">No contact info found</span>
            )}
          </div>

          <p className="text-sm text-muted-foreground">{candidate.matchReason}</p>

          <div className="flex flex-col gap-2">
            <Label>Viral videos</Label>
            <div className="flex flex-col gap-2">
              {candidate.viralVideos.map((video) => (
                <div
                  key={video.title}
                  className="flex items-center justify-between gap-3 rounded-md border p-2.5"
                >
                  <span className="min-w-0 truncate text-sm">{video.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {numberFormatter.format(video.views)} views · {video.multiplier}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="candidate-status">Status</Label>
            <Select
              items={STATUS_OPTIONS}
              value={status}
              onValueChange={(v) => onStatusChange(v as InfluencerStatus)}
            >
              <SelectTrigger id="candidate-status" className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* TODO: wire this select to a real PATCH endpoint (e.g.
                PATCH /api/apps/[id]/influencer-candidates/[candidateId])
                against an influencer_candidates table once it exists. Local
                state only for this pass — doesn't persist across a
                refresh. */}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="candidate-notes">Notes</Label>
            <Textarea
              id="candidate-notes"
              placeholder="Add any notes about this candidate — rate quoted, past campaigns, etc."
              rows={3}
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
            />
            {/* TODO: wire to the same real PATCH endpoint as the status
                select above once the influencer_candidates table exists. */}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
