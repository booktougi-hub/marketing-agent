"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { parseApiError } from "@/lib/errors/parseApiError";
import type { ConversionRetentionSettings } from "@/lib/app-settings";

// "unknown" is a real, always-selectable item (not an empty-string
// sentinel) so a user can explicitly revert to "not sure" after picking
// Yes/No — not knowing the answer is a common, legitimate state here.
type FreeTierValue = "unknown" | "true" | "false";

function numberFieldToInput(value: number | null): string {
  return value === null ? "" : String(value);
}

function inputToNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function ConversionRetentionSection({
  appId,
  initialSettings,
}: {
  appId: string;
  initialSettings: ConversionRetentionSettings;
}) {
  const router = useRouter();

  const [trialLengthDays, setTrialLengthDays] = useState(
    numberFieldToInput(initialSettings.trial_length_days)
  );
  const [hasFreeTier, setHasFreeTier] = useState<FreeTierValue>(
    initialSettings.has_free_tier === null
      ? "unknown"
      : (String(initialSettings.has_free_tier) as FreeTierValue)
  );
  const [onboardingStepCount, setOnboardingStepCount] = useState(
    numberFieldToInput(initialSettings.onboarding_step_count)
  );
  const [signupConversionRate, setSignupConversionRate] = useState(
    numberFieldToInput(initialSettings.known_signup_conversion_rate)
  );
  const [activationRate, setActivationRate] = useState(
    numberFieldToInput(initialSettings.known_activation_rate)
  );
  const [churnRate, setChurnRate] = useState(numberFieldToInput(initialSettings.known_churn_rate));

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch(`/api/apps/${appId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversion_retention: {
            trial_length_days: inputToNullableNumber(trialLengthDays),
            has_free_tier: hasFreeTier === "unknown" ? null : hasFreeTier === "true",
            onboarding_step_count: inputToNullableNumber(onboardingStepCount),
            known_signup_conversion_rate: inputToNullableNumber(signupConversionRate),
            known_activation_rate: inputToNullableNumber(activationRate),
            known_churn_rate: inputToNullableNumber(churnRate),
          },
        }),
      });
      if (!res.ok) {
        const { message } = await parseApiError(res);
        setSaveError(message);
        return;
      }
      setSaveSuccess(true);
      toast.success("Saved");
      router.refresh();
    } catch {
      setSaveError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversion &amp; Retention</CardTitle>
        <CardDescription>
          Optional — helps our analysis but not required. The onboarding-audit agent uses this
          alongside your app&apos;s DNA and signup flow to find real activation friction; without
          it, the audit still runs but flags lower confidence on anything it can&apos;t infer.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="trial-length-days">Trial length (days)</Label>
            <Input
              id="trial-length-days"
              type="number"
              min={0}
              placeholder="e.g. 14"
              value={trialLengthDays}
              onChange={(e) => setTrialLengthDays(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="has-free-tier">Free tier?</Label>
            <Select
              items={[
                { value: "unknown", label: "Not sure" },
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ]}
              value={hasFreeTier}
              onValueChange={(value) => setHasFreeTier(value as FreeTierValue)}
            >
              <SelectTrigger id="has-free-tier" className="w-full">
                <SelectValue placeholder="Not sure" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">Not sure</SelectItem>
                <SelectItem value="true">Yes</SelectItem>
                <SelectItem value="false">No</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="onboarding-step-count">Onboarding step count</Label>
            <Input
              id="onboarding-step-count"
              type="number"
              min={0}
              placeholder="e.g. 3"
              value={onboardingStepCount}
              onChange={(e) => setOnboardingStepCount(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-conversion-rate">Signup conversion rate (%)</Label>
            <Input
              id="signup-conversion-rate"
              type="number"
              min={0}
              max={100}
              step="0.1"
              placeholder="e.g. 12.5"
              value={signupConversionRate}
              onChange={(e) => setSignupConversionRate(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="activation-rate">Activation rate (%)</Label>
            <Input
              id="activation-rate"
              type="number"
              min={0}
              max={100}
              step="0.1"
              placeholder="e.g. 40"
              value={activationRate}
              onChange={(e) => setActivationRate(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="churn-rate">Churn rate (%)</Label>
            <Input
              id="churn-rate"
              type="number"
              min={0}
              max={100}
              step="0.1"
              placeholder="e.g. 5"
              value={churnRate}
              onChange={(e) => setChurnRate(e.target.value)}
            />
          </div>
        </div>

        {saveError && <ErrorMessage message={saveError} />}
        {saveSuccess && <p className="text-sm text-muted-foreground">Saved.</p>}

        <div className="flex justify-end border-t pt-4">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save Changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
