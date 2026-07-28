"use client";

import { useState } from "react";
import { Check, Copy, Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { InfluencerCandidate } from "@/lib/dummy-data/platform-detail";

// Static template substitution only — no LLM call in this pass.
// TODO: replace this with a real call to the outreach-message-generation
// endpoint (LLM-written, grounded in the app's brand voice + the specific
// viral video referenced) once it exists.
function buildPlaceholderMessage(candidate: InfluencerCandidate): string {
  const topVideo = candidate.viralVideos[0];
  const videoLine = topVideo
    ? ` Your video "${topVideo.title}" (${topVideo.multiplier} your normal views) is exactly the kind of content our audience loves.`
    : "";
  return `Hi ${candidate.name} team,

I've been following your content and think there's a great fit for a collaboration.${videoLine}

Would you be open to a quick chat about a potential partnership?

Best,
The team`;
}

export function PlatformOutreachMessageModal({
  candidate,
  open,
  onOpenChange,
}: {
  candidate: InfluencerCandidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!candidate) return null;

  const message = buildPlaceholderMessage(candidate);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — nothing
      // else to do here, the message is still visible to copy manually.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Outreach message for {candidate.name}</DialogTitle>
          <DialogDescription>
            A placeholder message — review and personalize before sending.
          </DialogDescription>
        </DialogHeader>

        <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{message}</p>

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" onClick={handleCopy}>
            {copied ? <Check className="text-chart-2" /> : <Copy />}
            {copied ? "Copied" : "Copy message"}
          </Button>

          {candidate.contactEmail && (
            <Tooltip>
              <TooltipTrigger render={<Button type="button" disabled />}>
                <Mail />
                Send via email
              </TooltipTrigger>
              <TooltipContent>Coming soon</TooltipContent>
            </Tooltip>
          )}
          {/* TODO: wire "Send via email" to the existing Outreach/email
              infrastructure (trigger/outreach-preview.ts's send path, once
              extended to influencer candidates specifically) once that
              integration exists. */}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
