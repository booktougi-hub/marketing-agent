"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DiagnosisSummary } from "@/components/apps/diagnosis-screen";
import type { DiagnosisProposal } from "@/types";

// Reuses DiagnosisSummary (components/apps/diagnosis-screen.tsx) for the
// proposed diagnosis so it renders in the exact same visual format as the
// original diagnosis screen — the change here is only which two actions sit
// below it (accept-and-rebuild vs. dismiss), not a new interaction model.
export function DiagnosisProposalReview({
  appId,
  proposal,
  onAccepted,
  onDismissed,
}: {
  appId: string;
  proposal: DiagnosisProposal;
  onAccepted: () => void;
  onDismissed: () => void;
}) {
  const [pendingAction, setPendingAction] = useState<"accept" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setPendingAction("accept");
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/diagnosis-proposals/${proposal.id}/accept`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Failed to accept the updated diagnosis.");
        return;
      }
      onAccepted();
    } catch {
      setError("Failed to accept the updated diagnosis.");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDismiss() {
    setPendingAction("dismiss");
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/diagnosis-proposals/${proposal.id}/dismiss`, {
        method: "PATCH",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Failed to dismiss this proposal.");
        return;
      }
      onDismissed();
    } catch {
      setError("Failed to dismiss this proposal.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="text-base">What changed</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{proposal.change_summary}</p>
        </CardContent>
      </Card>

      <DiagnosisSummary diagnosis={proposal.proposed_diagnosis} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleAccept} disabled={pendingAction !== null}>
            {pendingAction === "accept" && <Loader2 className="animate-spin" />}
            {pendingAction === "accept" ? "Rebuilding your strategy..." : "Review updated diagnosis"}
          </Button>
          <Button variant="outline" onClick={handleDismiss} disabled={pendingAction !== null}>
            {pendingAction === "dismiss" && <Loader2 className="animate-spin" />}
            Keep current strategy
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
