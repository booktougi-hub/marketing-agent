"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getRemainingCredits } from "@/lib/reanalysis";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { parseApiError } from "@/lib/errors/parseApiError";
import type { PlanTier, ProductType } from "@/types";

const PRODUCT_TYPE_OPTIONS: { value: ProductType; label: string }[] = [
  { value: "developer_tool", label: "Developer Tool" },
  { value: "mobile_app", label: "Mobile App" },
  { value: "web_app", label: "Web App" },
  { value: "saas", label: "SaaS Product" },
  { value: "browser_extension", label: "Browser Extension" },
  { value: "other", label: "Other" },
];

export function AppIdentitySection({
  appId,
  initialName,
  sourceUrl,
  screenshotUrl,
  initialProductType,
  initialAdditionalContext,
  urlChangedAt,
  planTier,
  reanalysisCreditsUsed,
  reanalysisCreditsResetAt,
}: {
  appId: string;
  initialName: string | null;
  sourceUrl: string;
  screenshotUrl: string | null;
  initialProductType: ProductType;
  initialAdditionalContext: string | null;
  urlChangedAt: string | null;
  planTier: PlanTier;
  reanalysisCreditsUsed: number;
  reanalysisCreditsResetAt: string | null;
}) {
  const router = useRouter();

  const [name, setName] = useState(initialName ?? "");
  const [productType, setProductType] = useState<ProductType>(initialProductType);
  const [additionalContext, setAdditionalContext] = useState(initialAdditionalContext ?? "");
  const [currentUrl, setCurrentUrl] = useState(sourceUrl);
  const [currentUrlChangedAt, setCurrentUrlChangedAt] = useState(urlChangedAt);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [newUrlInput, setNewUrlInput] = useState("");
  const [urlSubmitting, setUrlSubmitting] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const [reanalyseModalOpen, setReanalyseModalOpen] = useState(false);
  const [reanalysing, setReanalysing] = useState(false);
  const [reanalyseError, setReanalyseError] = useState<string | null>(null);

  const remainingCredits = getRemainingCredits(
    planTier,
    reanalysisCreditsUsed,
    reanalysisCreditsResetAt
  );
  const hasCredits = remainingCredits === null || remainingCredits > 0;

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch(`/api/apps/${appId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          product_type: productType,
          additional_context: additionalContext,
        }),
      });
      if (!res.ok) {
        const { message } = await parseApiError(res);
        setSaveError(message);
        return;
      }
      setSaveSuccess(true);
      router.refresh();
    } catch {
      setSaveError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmUrlChange() {
    setUrlSubmitting(true);
    setUrlError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/reanalyse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_url: newUrlInput }),
      });
      if (!res.ok) {
        const { message } = await parseApiError(res);
        setUrlError(message);
        return;
      }
      setCurrentUrl(newUrlInput);
      setCurrentUrlChangedAt(new Date().toISOString());
      setUrlModalOpen(false);
      router.push(`/dashboard/apps/${appId}`);
    } catch {
      setUrlError("Failed to change URL.");
    } finally {
      setUrlSubmitting(false);
    }
  }

  async function handleConfirmReanalyse() {
    setReanalysing(true);
    setReanalyseError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/reanalyse`, { method: "POST" });
      if (!res.ok) {
        const { message } = await parseApiError(res);
        setReanalyseError(message);
        return;
      }
      setReanalyseModalOpen(false);
      router.push(`/dashboard/apps/${appId}`);
    } catch {
      setReanalyseError("Failed to start re-analysis.");
    } finally {
      setReanalysing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>App Identity</CardTitle>
        <CardDescription>
          Update how this app is identified across your dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* Live preview — screenshot_url comes from trigger/dna-extraction.ts,
              piggybacking on the same Firecrawl scrape that already resolves
              icon_url, so it refreshes on initial onboarding and again on
              every "Re-analyse App" below, not on a fixed schedule. */}
          <div className="flex w-full flex-col gap-2 lg:w-72 lg:shrink-0">
            {/* DESIGN.md's "Level 2" elevated-surface treatment
                (bg-muted resolves to #1c1c1c in dark mode, one step
                lighter than this Card's own #171717) plus the standard
                hairline border — full-opacity bg-muted, not a faded
                tint, so the box reads as a clearly bordered grey tile
                against the card behind it. */}
            <div className="w-full overflow-hidden rounded-lg border bg-muted">
              {screenshotUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={screenshotUrl}
                  alt={`${currentUrl} preview`}
                  className="aspect-[16/9] w-full object-cover object-top"
                />
              ) : (
                <div className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-1 px-4 text-center text-xs text-muted-foreground">
                  <span>No preview yet</span>
                  <span>Captured on the next analysis</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              Live Preview
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="app-name" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                App Name
              </Label>
              <Input id="app-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  App URL
                </Label>
                {currentUrlChangedAt === null && (
                  <button
                    type="button"
                    onClick={() => {
                      setNewUrlInput(currentUrl);
                      setUrlError(null);
                      setUrlModalOpen(true);
                    }}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Change URL (one time only)
                  </button>
                )}
              </div>
              <div className="flex h-8 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm">
                <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{currentUrl}</span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="product-type" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Product Type
              </Label>
              <Select
                items={PRODUCT_TYPE_OPTIONS}
                value={productType}
                onValueChange={(value) => setProductType(value as ProductType)}
              >
                <SelectTrigger id="product-type" className="w-full">
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="additional-context" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Additional Context
              </Label>
              <Textarea
                id="additional-context"
                rows={6}
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This is used to improve your marketing strategy. Updates here are free
                and take effect on the next content cycle.
              </p>
            </div>
          </div>
        </div>

        {saveError && <ErrorMessage message={saveError} />}
        {saveSuccess && <p className="text-sm text-muted-foreground">Saved.</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            disabled={!hasCredits}
            title={!hasCredits ? "Upgrade for more credits" : undefined}
            onClick={() => {
              setReanalyseError(null);
              setReanalyseModalOpen(true);
            }}
          >
            Re-analyse App ({remainingCredits === null ? "Unlimited" : remainingCredits}{" "}
            credits remaining)
          </Button>

          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save Changes
          </Button>
        </div>
      </CardContent>

      <Dialog open={urlModalOpen} onOpenChange={setUrlModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change app URL</DialogTitle>
            <DialogDescription>
              This is a one-time action. Changing your URL will use one re-analysis
              credit and cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-url">New URL</Label>
            <Input
              id="new-url"
              value={newUrlInput}
              onChange={(e) => setNewUrlInput(e.target.value)}
              placeholder="https://yourapp.com"
            />
            {urlError && <ErrorMessage message={urlError} />}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setUrlModalOpen(false)}
              disabled={urlSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirmUrlChange}
              disabled={urlSubmitting || !newUrlInput.trim()}
            >
              {urlSubmitting && <Loader2 className="animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reanalyseModalOpen} onOpenChange={setReanalyseModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-analyse this app?</DialogTitle>
            <DialogDescription>
              This will replace your current strategy and pause all scheduled
              content until you approve the new strategy. 1 credit will be used.
            </DialogDescription>
          </DialogHeader>

          {reanalyseError && <ErrorMessage message={reanalyseError} />}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReanalyseModalOpen(false)}
              disabled={reanalysing}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirmReanalyse} disabled={reanalysing}>
              {reanalysing && <Loader2 className="animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
