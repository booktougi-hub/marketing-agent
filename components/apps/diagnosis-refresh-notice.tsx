"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DiagnosisProposalReview } from "@/components/apps/diagnosis-proposal-review";
import type { DiagnosisProposal } from "@/types";

// Lower-urgency than the original diagnosis approval — a notice on the
// Overview page, not a blocking modal. Collapsed to a single line by
// default; expands in place to the full review (reusing the same
// acknowledge/approve interaction the original diagnosis screen uses, via
// DiagnosisProposalReview) rather than navigating to a separate page.
export function DiagnosisRefreshNotice({
  appId,
  proposal,
}: {
  appId: string;
  proposal: DiagnosisProposal;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [resolved, setResolved] = useState(false);

  if (resolved) return null;

  return (
    <Card className="border-amber-500/30">
      <CardHeader
        className="flex flex-row items-center justify-between gap-2 space-y-0 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-sm font-medium">
          We noticed something that might affect your strategy
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
          View details
          <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
        </span>
      </CardHeader>

      {expanded && (
        <div className="px-6 pb-6">
          <DiagnosisProposalReview
            appId={appId}
            proposal={proposal}
            onAccepted={() => {
              setResolved(true);
              router.refresh();
            }}
            onDismissed={() => {
              setResolved(true);
              router.refresh();
            }}
          />
        </div>
      )}
    </Card>
  );
}
