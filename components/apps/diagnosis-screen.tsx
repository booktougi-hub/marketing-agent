"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DiagnosisBottleneck, DiagnosisData } from "@/types";

const BOTTLENECK_LABEL: Record<DiagnosisBottleneck, string> = {
  awareness: "Awareness",
  trust: "Trust",
  activation: "Activation",
  distribution: "Distribution",
};

// Pure display of a diagnosis — bottleneck/reasoning/competitive_context/
// primary_lever, no buttons or fetch logic — shared between this screen
// (the original onboarding diagnosis approval) and
// components/apps/diagnosis-proposal-review.tsx (the quarterly refresh
// proposal review), so both show a diagnosis in the exact same visual
// format rather than two hand-maintained copies.
export function DiagnosisSummary({ diagnosis }: { diagnosis: DiagnosisData }) {
  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <Badge variant="secondary" className="w-fit">
            Your biggest growth challenge right now: {BOTTLENECK_LABEL[diagnosis.bottleneck]}
          </Badge>
          <CardTitle className="text-base font-normal text-muted-foreground">
            {diagnosis.reasoning}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How you compare to real competitors</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{diagnosis.competitive_context}</p>
        </CardContent>
      </Card>

      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-base">Recommended focus</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-medium">{diagnosis.primary_lever}</p>
        </CardContent>
      </Card>
    </>
  );
}

export function DiagnosisScreen({
  appId,
  diagnosis,
  onAcknowledged,
}: {
  appId: string;
  diagnosis: DiagnosisData;
  onAcknowledged: () => void;
}) {
  const [correction, setCorrection] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAcknowledge() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/apps/${appId}/acknowledge-diagnosis`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correction: correction.trim() || null }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Failed to acknowledge diagnosis.");
        return;
      }
      onAcknowledged();
    } catch {
      setError("Failed to acknowledge diagnosis.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Here&apos;s what we found</h1>
      </div>

      <DiagnosisSummary diagnosis={diagnosis} />

      {diagnosis.confidence === "low" && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              We have limited information about your market — this diagnosis may need your input
              to sharpen it.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="diagnosis-correction">Anything we got wrong or should know?</Label>
              <Textarea
                id="diagnosis-correction"
                placeholder="Optional — tell us what to correct before we build your strategy"
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        <Button onClick={handleAcknowledge} disabled={submitting} className="self-start">
          {submitting && <Loader2 className="animate-spin" />}
          {submitting ? "Building your strategy..." : "This looks right — build my strategy"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
