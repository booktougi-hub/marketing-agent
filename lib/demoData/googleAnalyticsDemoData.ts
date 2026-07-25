// Illustrative-only GA4-shaped traffic data — no Google Analytics
// integration exists yet (needs a "Sign in with Google" OAuth flow and a
// Google Cloud OAuth client that doesn't exist in this project — see
// PHASES.md Notes Log). This previews what a real GA4 pull would look like
// once that's built. Never written to any table; not derived from
// anything real.

export interface GaSummary {
  users: number;
  sessions: number;
  pageviews: number;
  avgEngagementTimeSeconds: number;
  engagementRate: number; // 0-1
  usersDeltaPct: number; // vs previous 28 days
  sessionsDeltaPct: number;
}

export const DEMO_GA_SUMMARY: GaSummary = {
  users: 3842,
  sessions: 5211,
  pageviews: 12904,
  avgEngagementTimeSeconds: 94,
  engagementRate: 0.58,
  usersDeltaPct: 12.4,
  sessionsDeltaPct: 8.1,
};

export interface GaDailySessions {
  day: string; // short weekday label
  sessions: number;
}

// Trailing 7 days, oldest first.
export const DEMO_GA_DAILY_SESSIONS: GaDailySessions[] = [
  { day: "Mon", sessions: 612 },
  { day: "Tue", sessions: 701 },
  { day: "Wed", sessions: 668 },
  { day: "Thu", sessions: 789 },
  { day: "Fri", sessions: 843 },
  { day: "Sat", sessions: 512 },
  { day: "Sun", sessions: 486 },
];

export interface GaTopPage {
  path: string;
  views: number;
  avgEngagementTimeSeconds: number;
}

export const DEMO_GA_TOP_PAGES: GaTopPage[] = [
  { path: "/", views: 4820, avgEngagementTimeSeconds: 61 },
  { path: "/pricing", views: 2140, avgEngagementTimeSeconds: 118 },
  { path: "/blog/ai-code-review-guide", views: 1690, avgEngagementTimeSeconds: 203 },
  { path: "/docs/getting-started", views: 1204, avgEngagementTimeSeconds: 145 },
  { path: "/signup", views: 980, avgEngagementTimeSeconds: 47 },
];

export interface GaTrafficSource {
  source: string;
  sessions: number;
  share: number; // 0-1, of total sessions
}

export const DEMO_GA_TRAFFIC_SOURCES: GaTrafficSource[] = [
  { source: "Organic search", sessions: 2189, share: 0.42 },
  { source: "Direct", sessions: 1563, share: 0.30 },
  { source: "Referral", sessions: 782, share: 0.15 },
  { source: "Social", sessions: 469, share: 0.09 },
  { source: "Other", sessions: 208, share: 0.04 },
];
