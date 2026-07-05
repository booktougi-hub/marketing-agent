// Parses/defaults for the `publishing_schedule` key inside the untyped
// `apps.app_settings` jsonb column (see SCHEMA.md). Other keys (research
// schedule, notifications, ...) will get their own sections here as those
// settings sections get built — not invented ahead of time.

export const TWITTER_FREQUENCIES = [
  "1_per_day",
  "2_per_day",
  "3_per_day",
  "5_per_week",
  "3_per_week",
] as const;
export type TwitterFrequency = (typeof TWITTER_FREQUENCIES)[number];

export const TWITTER_HOURS = ["09:00", "12:00", "15:00", "18:00", "21:00"] as const;
export type TwitterHour = (typeof TWITTER_HOURS)[number];

export const LINKEDIN_FREQUENCIES = ["daily", "3_per_week", "2_per_week", "1_per_week"] as const;
export type LinkedinFrequency = (typeof LINKEDIN_FREQUENCIES)[number];

export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export const IGFB_FREQUENCIES = ["daily", "3_per_week", "2_per_week"] as const;
export type InstagramFacebookFrequency = (typeof IGFB_FREQUENCIES)[number];

export const DEVTO_FREQUENCIES = ["weekly", "biweekly", "monthly"] as const;
export type DevtoFrequency = (typeof DEVTO_FREQUENCIES)[number];

export interface PublishingScheduleSettings {
  twitter: { frequency: TwitterFrequency; hours: TwitterHour[] };
  linkedin: { frequency: LinkedinFrequency; days: WeekDay[] };
  instagram_facebook: { frequency: InstagramFacebookFrequency; include_weekends: boolean };
  devto: { frequency: DevtoFrequency };
  timezone: string;
}

export const DEFAULT_PUBLISHING_SCHEDULE: PublishingScheduleSettings = {
  twitter: { frequency: "2_per_day", hours: ["09:00", "12:00", "18:00"] },
  linkedin: { frequency: "3_per_week", days: ["tue", "wed", "thu"] },
  instagram_facebook: { frequency: "3_per_week", include_weekends: false },
  devto: { frequency: "weekly" },
  timezone: "UTC",
};

export const TWITTER_FREQUENCY_OPTIONS: { value: TwitterFrequency; label: string }[] = [
  { value: "1_per_day", label: "1 per day" },
  { value: "2_per_day", label: "2 per day" },
  { value: "3_per_day", label: "3 per day" },
  { value: "5_per_week", label: "5 per week" },
  { value: "3_per_week", label: "3 per week" },
];

export const TWITTER_HOUR_OPTIONS: { value: TwitterHour; label: string }[] = [
  { value: "09:00", label: "9am" },
  { value: "12:00", label: "12pm" },
  { value: "15:00", label: "3pm" },
  { value: "18:00", label: "6pm" },
  { value: "21:00", label: "9pm" },
];

export const LINKEDIN_FREQUENCY_OPTIONS: { value: LinkedinFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "3_per_week", label: "3 per week" },
  { value: "2_per_week", label: "2 per week" },
  { value: "1_per_week", label: "1 per week" },
];

export const WEEK_DAY_OPTIONS: { value: WeekDay; label: string }[] = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

export const IGFB_FREQUENCY_OPTIONS: { value: InstagramFacebookFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "3_per_week", label: "3 per week" },
  { value: "2_per_week", label: "2 per week" },
];

export const DEVTO_FREQUENCY_OPTIONS: { value: DevtoFrequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
];

export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "Eastern Time (US)" },
  { value: "America/Chicago", label: "Central Time (US)" },
  { value: "America/Denver", label: "Mountain Time (US)" },
  { value: "America/Los_Angeles", label: "Pacific Time (US)" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Berlin", label: "Central Europe (CET/CEST)" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Asia/Tokyo", label: "Japan (JST)" },
  { value: "Australia/Sydney", label: "Sydney (AEDT/AEST)" },
];

function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

export function parsePublishingSchedule(raw: unknown): PublishingScheduleSettings {
  const obj = asRecord(raw);
  const twitterObj = asRecord(obj.twitter);
  const linkedinObj = asRecord(obj.linkedin);
  const igfbObj = asRecord(obj.instagram_facebook);
  const devtoObj = asRecord(obj.devto);

  const twitterHours = Array.isArray(twitterObj.hours)
    ? twitterObj.hours.filter((h): h is TwitterHour => isOneOf(TWITTER_HOURS, h))
    : [];

  const linkedinDays = Array.isArray(linkedinObj.days)
    ? linkedinObj.days.filter((d): d is WeekDay => isOneOf(WEEK_DAYS, d))
    : [];

  return {
    twitter: {
      frequency: isOneOf(TWITTER_FREQUENCIES, twitterObj.frequency)
        ? twitterObj.frequency
        : DEFAULT_PUBLISHING_SCHEDULE.twitter.frequency,
      hours: twitterHours.length > 0 ? twitterHours : DEFAULT_PUBLISHING_SCHEDULE.twitter.hours,
    },
    linkedin: {
      frequency: isOneOf(LINKEDIN_FREQUENCIES, linkedinObj.frequency)
        ? linkedinObj.frequency
        : DEFAULT_PUBLISHING_SCHEDULE.linkedin.frequency,
      days: linkedinDays.length > 0 ? linkedinDays : DEFAULT_PUBLISHING_SCHEDULE.linkedin.days,
    },
    instagram_facebook: {
      frequency: isOneOf(IGFB_FREQUENCIES, igfbObj.frequency)
        ? igfbObj.frequency
        : DEFAULT_PUBLISHING_SCHEDULE.instagram_facebook.frequency,
      include_weekends:
        typeof igfbObj.include_weekends === "boolean"
          ? igfbObj.include_weekends
          : DEFAULT_PUBLISHING_SCHEDULE.instagram_facebook.include_weekends,
    },
    devto: {
      frequency: isOneOf(DEVTO_FREQUENCIES, devtoObj.frequency)
        ? devtoObj.frequency
        : DEFAULT_PUBLISHING_SCHEDULE.devto.frequency,
    },
    timezone: typeof obj.timezone === "string" ? obj.timezone : DEFAULT_PUBLISHING_SCHEDULE.timezone,
  };
}
