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
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setSaveError(json?.error ?? "Failed to save changes.");
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
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setUrlError(json?.error ?? "Failed to change URL.");
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
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setReanalyseError(json?.error ?? "Failed to start re-analysis.");
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="app-name">App Name</Label>
          <Input id="app-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>App URL</Label>
          <div className="flex items-center gap-2 text-sm">
            <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{currentUrl}</span>
          </div>
          <p className="text-xs text-muted-foreground">URL is locked after creation</p>
          {currentUrlChangedAt === null && (
            <button
              type="button"
              onClick={() => {
                setNewUrlInput(currentUrl);
                setUrlError(null);
                setUrlModalOpen(true);
              }}
              className="w-fit text-xs font-medium text-primary hover:underline"
            >
              Change URL (one time only)
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-type">Product Type</Label>
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
          <Label htmlFor="additional-context">Additional context about your app</Label>
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

        {saveError && <p className="text-sm text-destructive">{saveError}</p>}
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
            {urlError && <p className="text-sm text-destructive">{urlError}</p>}
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

          {reanalyseError && <p className="text-sm text-destructive">{reanalyseError}</p>}

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
