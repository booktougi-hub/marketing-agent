"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { ProspectCard } from "@/components/apps/app-outreach-view";
import type { ColdEmailProspect, IcpData, IcpStatus } from "@/types";

type CompanyStage = "bootstrapped" | "funded" | "established";

const COMPANY_STAGE_OPTIONS: { value: CompanyStage; label: string }[] = [
  { value: "bootstrapped", label: "Bootstrapped" },
  { value: "funded", label: "Funded" },
  { value: "established", label: "Established" },
];

interface AdjustFormState {
  companyStage: CompanyStage | null;
  exclusions: string;
  geographicFocus: string;
  personaConfirmed: "yes" | "needs_changing";
  personaFeedback: string;
}

const EMPTY_ADJUST_FORM: AdjustFormState = {
  companyStage: null,
  exclusions: "",
  geographicFocus: "",
  personaConfirmed: "yes",
  personaFeedback: "",
};

export function OutreachIcpOnboarding({
  appId,
  initialIcpData,
  initialIcpStatus,
  initialPreviewProspects,
  onApproved,
}: {
  appId: string;
  initialIcpData: IcpData | null;
  initialIcpStatus: IcpStatus;
  initialPreviewProspects: ColdEmailProspect[];
  onApproved: () => void;
}) {
  const [icpData, setIcpData] = useState(initialIcpData);
  const [icpStatus, setIcpStatus] = useState(initialIcpStatus);
  const [previewProspects, setPreviewProspects] = useState(initialPreviewProspects);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState<AdjustFormState>(EMPTY_ADJUST_FORM);
  const [submittingAdjust, setSubmittingAdjust] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tracks whether we're mid-regeneration so the apps-table subscription
  // below knows when a "needs_adjustment -> something else" transition
  // means "new ICP just landed, clear the old preview batch" rather than
  // firing on every unrelated apps update.
  const wasAdjustingRef = useRef(initialIcpStatus === "needs_adjustment");

  useEffect(() => {
    const channel = supabase
      .channel(`outreach-icp-${appId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "apps",
          filter: `id=eq.${appId}`,
        },
        (payload) => {
          const row = payload.new as { icp_data: IcpData | null; icp_status: IcpStatus };
          setIcpData(row.icp_data);
          setIcpStatus(row.icp_status);
          if (wasAdjustingRef.current && row.icp_status !== "needs_adjustment") {
            // icp-inference just finished re-running — the new ICP summary
            // is in, but outreach-preview (triggered by icp-inference) may
            // still be writing the new 5 previews. Clear the stale batch;
            // the cold_email_prospects INSERT subscription below repopulates
            // it as the new rows actually arrive.
            setPreviewProspects([]);
          }
          wasAdjustingRef.current = row.icp_status === "needs_adjustment";
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "cold_email_prospects",
          filter: `app_id=eq.${appId}`,
        },
        (payload) => {
          const row = payload.new as ColdEmailProspect;
          if (!row.is_preview) return;
          setPreviewProspects((prev) => (prev.some((p) => p.id === row.id) ? prev : [...prev, row]));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [appId]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleLooksGood() {
    setError(null);
    setApproving(true);
    try {
      const res = await fetch(`/api/apps/${appId}/icp`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Failed to approve the ICP.");
        return;
      }

      // Regular monthly full-batch job — V3, not built yet (see PHASES.md
      // Notes Log, 2026-07-14). The agent-action route already returns a
      // clean 501/NOT_IMPLEMENTED for this action; treated as expected here,
      // not an error.
      try {
        const batchRes = await fetch(`/api/apps/${appId}/agent-action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionType: "cold_email_prospecting" }),
        });
        if (batchRes.status === 501) {
          toast.info("We'll research your full batch this month.");
        } else if (!batchRes.ok) {
          const batchJson = await batchRes.json().catch(() => null);
          toast.error(batchJson?.error ?? "Failed to start your full prospect batch.");
        }
      } catch {
        toast.error("Failed to start your full prospect batch.");
      }

      setIcpStatus("approved");
      onApproved();
    } catch {
      setError("Failed to approve the ICP.");
    } finally {
      setApproving(false);
    }
  }

  async function handleSaveAdjustment() {
    setError(null);
    setSubmittingAdjust(true);
    try {
      const res = await fetch(`/api/apps/${appId}/icp/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_stage: adjustForm.companyStage,
          exclusions: adjustForm.exclusions.trim() || null,
          geographic_focus: adjustForm.geographicFocus.trim() || null,
          persona_feedback:
            adjustForm.personaConfirmed === "needs_changing"
              ? adjustForm.personaFeedback.trim() || null
              : null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Failed to save your adjustments.");
        return;
      }
      wasAdjustingRef.current = true;
      setIcpStatus("needs_adjustment");
      setAdjustOpen(false);
      setAdjustForm(EMPTY_ADJUST_FORM);
    } catch {
      setError("Failed to save your adjustments.");
    } finally {
      setSubmittingAdjust(false);
    }
  }

  if (icpStatus === "needs_adjustment") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Regenerating your ICP and prospect previews with your adjustments...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!icpData) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Here&apos;s who we think your ideal customer is</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{icpData.summary}</p>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleLooksGood} disabled={approving || submittingAdjust}>
              {approving && <Loader2 className="animate-spin" />}
              Looks good
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={approving || submittingAdjust}
              onClick={() => setAdjustOpen((v) => !v)}
            >
              Adjust this
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {adjustOpen && (
            <div className="flex flex-col gap-4 rounded-lg border p-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="company-stage">Company stage</Label>
                <Select
                  items={COMPANY_STAGE_OPTIONS}
                  value={adjustForm.companyStage ?? undefined}
                  onValueChange={(value) =>
                    setAdjustForm((prev) => ({ ...prev, companyStage: value as CompanyStage }))
                  }
                >
                  <SelectTrigger id="company-stage" className="w-full">
                    <SelectValue placeholder="Select a stage (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPANY_STAGE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="exclusions">Explicit exclusions</Label>
                <Textarea
                  id="exclusions"
                  placeholder="e.g. no agencies, no enterprise companies"
                  value={adjustForm.exclusions}
                  onChange={(e) => setAdjustForm((prev) => ({ ...prev, exclusions: e.target.value }))}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="geographic-focus">Geographic focus</Label>
                <Input
                  id="geographic-focus"
                  placeholder="e.g. US and Canada only"
                  value={adjustForm.geographicFocus}
                  onChange={(e) => setAdjustForm((prev) => ({ ...prev, geographicFocus: e.target.value }))}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Are the personas right?</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={adjustForm.personaConfirmed === "yes" ? "default" : "outline"}
                    onClick={() => setAdjustForm((prev) => ({ ...prev, personaConfirmed: "yes" }))}
                  >
                    Yes, it&apos;s right
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={adjustForm.personaConfirmed === "needs_changing" ? "default" : "outline"}
                    onClick={() => setAdjustForm((prev) => ({ ...prev, personaConfirmed: "needs_changing" }))}
                  >
                    Needs changing
                  </Button>
                </div>
                {adjustForm.personaConfirmed === "needs_changing" && (
                  <Textarea
                    placeholder="What's wrong with it?"
                    value={adjustForm.personaFeedback}
                    onChange={(e) => setAdjustForm((prev) => ({ ...prev, personaFeedback: e.target.value }))}
                  />
                )}
              </div>

              <Button
                type="button"
                onClick={handleSaveAdjustment}
                disabled={submittingAdjust}
                className="self-start"
              >
                {submittingAdjust && <Loader2 className="animate-spin" />}
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {previewProspects.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Based on that, we already found these 5 people and wrote them personalized emails
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {previewProspects.map((prospect) => (
              <ProspectCard
                key={prospect.id}
                prospect={prospect}
                expanded={expandedIds.has(prospect.id)}
                approving={false}
                onToggleExpand={() => toggleExpand(prospect.id)}
                onApprove={() => {}}
                readOnly
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
