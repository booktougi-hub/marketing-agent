"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { parseApiError } from "@/lib/errors/parseApiError";
import { cn } from "@/lib/utils";
import {
  DEVTO_FREQUENCY_OPTIONS,
  IGFB_FREQUENCY_OPTIONS,
  LINKEDIN_FREQUENCY_OPTIONS,
  TIMEZONE_OPTIONS,
  TWITTER_FREQUENCY_OPTIONS,
  TWITTER_HOUR_OPTIONS,
  WEEK_DAY_OPTIONS,
  type DevtoFrequency,
  type InstagramFacebookFrequency,
  type LinkedinFrequency,
  type PublishingScheduleSettings,
  type TwitterFrequency,
  type TwitterHour,
  type WeekDay,
} from "@/lib/app-settings";

function ScheduleSelect<T extends string>({
  id,
  label,
  value,
  onValueChange,
  options,
}: {
  id: string;
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select items={options} value={value} onValueChange={(v) => onValueChange(v as T)}>
        <SelectTrigger id={id} className="w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ChipMultiSelect<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(option.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PublishingScheduleSection({
  appId,
  initialSchedule,
}: {
  appId: string;
  initialSchedule: PublishingScheduleSettings;
}) {
  const router = useRouter();
  const [schedule, setSchedule] = useState(initialSchedule);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function setTwitterFrequency(frequency: TwitterFrequency) {
    setSchedule((prev) => ({ ...prev, twitter: { ...prev.twitter, frequency } }));
  }

  function toggleTwitterHour(hour: TwitterHour) {
    setSchedule((prev) => {
      const isSelected = prev.twitter.hours.includes(hour);
      // Keep at least one hour selected — the API requires a non-empty list.
      if (isSelected && prev.twitter.hours.length === 1) return prev;
      const hours = isSelected
        ? prev.twitter.hours.filter((h) => h !== hour)
        : [...prev.twitter.hours, hour];
      return { ...prev, twitter: { ...prev.twitter, hours } };
    });
  }

  function setLinkedinFrequency(frequency: LinkedinFrequency) {
    setSchedule((prev) => ({ ...prev, linkedin: { ...prev.linkedin, frequency } }));
  }

  function toggleLinkedinDay(day: WeekDay) {
    setSchedule((prev) => {
      const isSelected = prev.linkedin.days.includes(day);
      if (isSelected && prev.linkedin.days.length === 1) return prev;
      const days = isSelected
        ? prev.linkedin.days.filter((d) => d !== day)
        : [...prev.linkedin.days, day];
      return { ...prev, linkedin: { ...prev.linkedin, days } };
    });
  }

  function setIgfbFrequency(frequency: InstagramFacebookFrequency) {
    setSchedule((prev) => ({
      ...prev,
      instagram_facebook: { ...prev.instagram_facebook, frequency },
    }));
  }

  function setIncludeWeekends(includeWeekends: boolean) {
    setSchedule((prev) => ({
      ...prev,
      instagram_facebook: { ...prev.instagram_facebook, include_weekends: includeWeekends },
    }));
  }

  function setDevtoFrequency(frequency: DevtoFrequency) {
    setSchedule((prev) => ({ ...prev, devto: { frequency } }));
  }

  function setTimezone(timezone: string) {
    setSchedule((prev) => ({ ...prev, timezone }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/apps/${appId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishing_schedule: schedule }),
      });
      if (!res.ok) {
        const { message } = await parseApiError(res);
        setError(message);
        return;
      }
      setSuccess(true);
      router.refresh();
    } catch {
      setError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Publishing Schedule</CardTitle>
        <CardDescription>Control when and how often new content gets published.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            These settings take effect on the next content generation cycle.
            Current scheduled posts will not be affected.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold">Twitter / X</h3>
          <ScheduleSelect
            id="twitter-frequency"
            label="Posting frequency"
            value={schedule.twitter.frequency}
            onValueChange={setTwitterFrequency}
            options={TWITTER_FREQUENCY_OPTIONS}
          />
          <ChipMultiSelect
            label="Preferred posting hours"
            options={TWITTER_HOUR_OPTIONS}
            selected={schedule.twitter.hours}
            onToggle={toggleTwitterHour}
          />
        </div>

        <div className="flex flex-col gap-4 border-t pt-6">
          <h3 className="text-sm font-semibold">LinkedIn</h3>
          <ScheduleSelect
            id="linkedin-frequency"
            label="Posting frequency"
            value={schedule.linkedin.frequency}
            onValueChange={setLinkedinFrequency}
            options={LINKEDIN_FREQUENCY_OPTIONS}
          />
          <ChipMultiSelect
            label="Preferred posting days"
            options={WEEK_DAY_OPTIONS}
            selected={schedule.linkedin.days}
            onToggle={toggleLinkedinDay}
          />
        </div>

        <div className="flex flex-col gap-4 border-t pt-6">
          <h3 className="text-sm font-semibold">Instagram / Facebook</h3>
          <ScheduleSelect
            id="igfb-frequency"
            label="Posting frequency"
            value={schedule.instagram_facebook.frequency}
            onValueChange={setIgfbFrequency}
            options={IGFB_FREQUENCY_OPTIONS}
          />
          <ToggleSwitch
            label="Include weekends"
            checked={schedule.instagram_facebook.include_weekends}
            onCheckedChange={setIncludeWeekends}
          />
        </div>

        <div className="flex flex-col gap-4 border-t pt-6">
          <h3 className="text-sm font-semibold">Dev.to Articles</h3>
          <ScheduleSelect
            id="devto-frequency"
            label="Article frequency"
            value={schedule.devto.frequency}
            onValueChange={setDevtoFrequency}
            options={DEVTO_FREQUENCY_OPTIONS}
          />
        </div>

        <div className="flex flex-col gap-4 border-t pt-6">
          <h3 className="text-sm font-semibold">Timezone</h3>
          <ScheduleSelect
            id="timezone"
            label="Your timezone"
            value={schedule.timezone}
            onValueChange={setTimezone}
            options={TIMEZONE_OPTIONS}
          />
        </div>

        {error && <ErrorMessage message={error} />}
        {success && <p className="text-sm text-muted-foreground">Saved.</p>}

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
