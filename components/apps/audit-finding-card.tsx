"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, Loader2, MessageSquarePlus, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type AuditFindingSeverity = "high" | "medium" | "low";
export type AuditFindingStatus = "open" | "fixed" | "not_applicable";

const SEVERITY_LABEL: Record<AuditFindingSeverity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

// Uses the same CSS-var color-mix badge pattern as TopicCard's source
// badge (app-research-view.tsx) rather than the default Badge palette, so
// severity reads at a glance across every audit type this card serves.
const SEVERITY_COLOR_VAR: Record<AuditFindingSeverity, string> = {
  high: "var(--destructive)",
  medium: "var(--chart-3)",
  low: "var(--muted-foreground)",
};

const STATUS_LABEL: Record<AuditFindingStatus, string> = {
  open: "Open",
  fixed: "Fixed",
  not_applicable: "Not Applicable",
};

// Shared across every audit family (onboarding now; churn and CRO audits
// are planned — see PHASES.md Notes Log, 2026-07-22) — deliberately has no
// knowledge of which table or API route backs a given finding. The parent
// page wires the three actions to whatever endpoint matches its own audit
// type, so this component never hardcodes onboarding_findings specifically.
//
// Also reused as-is for the chat panel's mutating-action confirm cards
// (components/dashboard/ChatPanel.tsx) rather than building a second
// confirmation component — the confirmLabel/declineLabel/statusLabels/
// hideFeedback props below exist only for that call site and all default
// to the original audit-finding copy, so no existing caller is affected.
export function AuditFindingCard({
  findingType,
  severity,
  issueDescription,
  suggestedFix,
  status,
  onMarkFixed,
  onMarkNotApplicable,
  onSubmitFeedback,
  confirmLabel = "Mark as Fixed",
  declineLabel = "Not Applicable",
  statusLabels,
  hideFeedback = false,
}: {
  findingType: string;
  severity: AuditFindingSeverity;
  issueDescription: string;
  suggestedFix: string;
  status: AuditFindingStatus;
  onMarkFixed: () => Promise<void>;
  onMarkNotApplicable: () => Promise<void>;
  onSubmitFeedback: (note: string) => Promise<void>;
  confirmLabel?: string;
  declineLabel?: string;
  statusLabels?: Partial<Record<AuditFindingStatus, string>>;
  hideFeedback?: boolean;
}) {
  const resolvedStatusLabel = statusLabels?.[status] ?? STATUS_LABEL[status];
  const [pendingAction, setPendingAction] = useState<"fixed" | "not_applicable" | "feedback" | null>(
    null
  );
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOpen = status === "open";

  async function handleMarkFixed() {
    setPendingAction("fixed");
    setError(null);
    try {
      await onMarkFixed();
      toast.success("Marked as fixed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update this finding.";
      setError(message);
      toast.error(message);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleMarkNotApplicable() {
    setPendingAction("not_applicable");
    setError(null);
    try {
      await onMarkNotApplicable();
      toast.success("Marked as not applicable");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update this finding.";
      setError(message);
      toast.error(message);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleSubmitFeedback() {
    if (!feedbackNote.trim()) return;
    setPendingAction("feedback");
    setError(null);
    try {
      await onSubmitFeedback(feedbackNote.trim());
      setFeedbackSent(true);
      setFeedbackNote("");
      toast.success("Thanks — this will inform the next audit run");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send feedback.";
      setError(message);
      toast.error(message);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <Badge
            variant="outline"
            className="shrink-0 border-transparent font-medium"
            style={{
              backgroundColor: `color-mix(in oklch, ${SEVERITY_COLOR_VAR[severity]} 16%, transparent)`,
              color: SEVERITY_COLOR_VAR[severity],
            }}
          >
            {SEVERITY_LABEL[severity]}
          </Badge>
          {!isOpen && <Badge variant="secondary">{resolvedStatusLabel}</Badge>}
        </div>

        <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
          {findingType.replace(/_/g, " ")}
        </p>

        <p className={cn("text-sm leading-snug", !isOpen && "text-muted-foreground")}>
          {issueDescription}
        </p>

        <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Suggested fix: </span>
          {suggestedFix}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {isOpen && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pendingAction !== null}
                onClick={handleMarkFixed}
              >
                {pendingAction === "fixed" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                {confirmLabel}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pendingAction !== null}
                onClick={handleMarkNotApplicable}
              >
                {pendingAction === "not_applicable" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <XCircle className="size-3.5" />
                )}
                {declineLabel}
              </Button>
              {!hideFeedback && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pendingAction !== null || feedbackSent}
                  onClick={() => setFeedbackOpen((v) => !v)}
                >
                  <MessageSquarePlus className="size-3.5" />
                  {feedbackSent ? "Feedback sent" : "Tell us more"}
                  {!feedbackSent && (
                    <ChevronDown className={cn("size-3.5 transition-transform", feedbackOpen && "rotate-180")} />
                  )}
                </Button>
              )}
            </div>

            {!hideFeedback && feedbackOpen && !feedbackSent && (
              <div className="flex flex-col gap-2">
                <Textarea
                  placeholder="Add context this audit got wrong or missed — it's folded into the next run."
                  rows={3}
                  value={feedbackNote}
                  onChange={(e) => setFeedbackNote(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  className="self-start"
                  disabled={pendingAction !== null || !feedbackNote.trim()}
                  onClick={handleSubmitFeedback}
                >
                  {pendingAction === "feedback" && <Loader2 className="animate-spin" />}
                  Submit
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
