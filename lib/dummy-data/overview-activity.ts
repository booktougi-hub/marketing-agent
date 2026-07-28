// TODO(cleanup-before-prod): delete this file and its two imports in
// app/dashboard/apps/[id]/overview/page.tsx before shipping to production.
// This exists purely so the Overview page's real "Weekly activity" and
// "Recent activity" cards can be previewed with realistic-looking data
// before any content has actually been published for a given app — it is
// not a fallback for missing integrations (unlike lib/demoData/*, which
// covers features that genuinely aren't built yet). The real feature
// behind this page already works end to end; this is just sample content
// shown when the real Supabase queries come back empty.
import type { WeeklyActivityDatum } from "@/components/dashboard/WeeklyActivityChart";
import type { ContentPlatform } from "@/types";

export const DEMO_WEEKLY_ACTIVITY_PLATFORMS: ContentPlatform[] = ["twitter", "linkedin", "devto"];

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const DEMO_WEEKLY_ACTIVITY: WeeklyActivityDatum[] = [
  { day: WEEKDAY_LABELS[0], twitter: 2, linkedin: 1, devto: 0 },
  { day: WEEKDAY_LABELS[1], twitter: 1, linkedin: 0, devto: 1 },
  { day: WEEKDAY_LABELS[2], twitter: 3, linkedin: 1, devto: 0 },
  { day: WEEKDAY_LABELS[3], twitter: 1, linkedin: 2, devto: 0 },
  { day: WEEKDAY_LABELS[4], twitter: 2, linkedin: 0, devto: 1 },
  { day: WEEKDAY_LABELS[5], twitter: 0, linkedin: 0, devto: 0 },
  { day: WEEKDAY_LABELS[6], twitter: 1, linkedin: 1, devto: 0 },
];

const now = Date.now();
const hoursAgo = (n: number) => new Date(now - n * 60 * 60 * 1000).toISOString();

export const DEMO_RECENT_ACTIVITY: { platform: ContentPlatform; body: string; published_at: string }[] = [
  {
    platform: "twitter",
    body: "Shipping a small quality-of-life fix today: faster cold starts across the board. More on this soon.",
    published_at: hoursAgo(3),
  },
  {
    platform: "linkedin",
    body: "We just crossed a milestone we're proud of — thanks to everyone who's been along for the ride.",
    published_at: hoursAgo(9),
  },
  {
    platform: "devto",
    body: "New post: a deep dive on how we cut our build times in half without changing our CI provider.",
    published_at: hoursAgo(28),
  },
  {
    platform: "twitter",
    body: "Hot take: most onboarding flows fail not because they're too long, but because they ask for the wrong thing first.",
    published_at: hoursAgo(50),
  },
  {
    platform: "linkedin",
    body: "Sharing a quick breakdown of what worked (and what didn't) in our last product launch.",
    published_at: hoursAgo(96),
  },
];
