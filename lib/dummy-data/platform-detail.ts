// Hardcoded dummy data for the Social Content platform detail views
// (My Channel / Top Influencers) — components/apps/platform-detail/*.
//
// Nothing in this file is real. It exists purely so the UI can be reviewed
// with realistic-looking numbers before any of the real integrations below
// exist. Every TODO in this file names the specific job/table/endpoint that
// will eventually replace it — search this file for "TODO:" to find every
// point that needs real wiring.
//
// Delete this file wholesale once every TODO below has a real data source
// wired in its place — nothing else in the app depends on it existing.
import type { ContentPlatform } from "@/types";

export type CostTier = "Nano" | "Micro" | "Mid" | "Macro";
export type InfluencerStatus = "not_contacted" | "contacted" | "responded" | "booked";

export const COST_TIERS: CostTier[] = ["Nano", "Micro", "Mid", "Macro"];

export const INFLUENCER_STATUS_LABEL: Record<InfluencerStatus, string> = {
  not_contacted: "Not contacted",
  contacted: "Contacted",
  responded: "Responded",
  booked: "Booked",
};

export interface ChannelIdentity {
  avatarInitials: string;
  avatarUrl: string | null;
  handle: string;
  connected: boolean;
}

export interface ChannelMetrics {
  viewsLabel: string;
  views: number;
  engagementRate: string;
  publishedLabel: string;
  published: number;
  growthLabel: string;
  growth: string;
}

export interface ChannelChecklistItem {
  label: string;
  pass: boolean;
}

export interface ViralVideo {
  title: string;
  views: number;
  multiplier: string;
}

export interface ContentAngle {
  title: string;
  source: string;
  multiplier: string;
}

export interface InfluencerCandidate {
  id: string;
  name: string;
  avatarInitials: string;
  followers: number;
  reach: number; // avg. per-post/video reach — "Views" on YouTube, "Reach" on Instagram/Facebook, see lib/platform.ts's PLATFORM_INFLUENCER_METRIC_LABELS
  postsPublished: number; // last 28 days
  engagementRate: string;
  costTier: CostTier;
  matchReason: string;
  contactEmail: string | null;
  viralVideos: ViralVideo[];
  status: InfluencerStatus;
}

export interface PlatformDetailDummyData {
  channelIdentity: ChannelIdentity;
  channelMetrics: ChannelMetrics;
  checklist: ChannelChecklistItem[];
  contentAngles: ContentAngle[];
  influencerCandidates: InfluencerCandidate[];
}

// Only youtube/instagram/facebook are populated for now — this task's
// scope. Adding twitter/linkedin later (if that's ever decided) is just
// adding another entry here; components/apps/platform-detail/* read this
// map generically by platform and don't hardcode which platforms exist.
export const PLATFORM_DETAIL_DUMMY_DATA: Partial<Record<ContentPlatform, PlatformDetailDummyData>> = {
  youtube: {
    channelIdentity: {
      avatarInitials: "AS",
      avatarUrl: null,
      handle: "@AiSkillsGuard",
      connected: true,
      // TODO: replace with real OAuth connection status + avatar URL from
      // the YouTube Data API once the connect flow exists. If `connected`
      // is false, the identity strip should show a "Connect your YouTube
      // account" prompt with a connect button instead (already built —
      // see components/apps/platform-channel-identity.tsx).
    },
    channelMetrics: {
      viewsLabel: "Views (28 days)",
      views: 2140,
      engagementRate: "3.2%",
      publishedLabel: "Videos published",
      published: 3,
      growthLabel: "Subscriber growth",
      growth: "+41",
      // TODO: replace with real values pulled from the social-performance
      // sync job against the YouTube Analytics API once it exists.
    },
    checklist: [
      { label: "Business contact email listed", pass: true },
      { label: "No pinned video set", pass: false },
      { label: "Channel description missing link to app", pass: false },
      // TODO: replace with real checks run against the connected channel's
      // public profile data (YouTube Data API `channels` resource) once the
      // channel-checklist job exists.
    ],
    contentAngles: [
      { title: "I automated my marketing to 1hr/week", source: "DevReview, 340K views", multiplier: "4.1x" },
      { title: "Reviewing every AI marketing tool so you don't have to", source: "HealthGeekTV, 210K views", multiplier: "3.4x" },
      // TODO: replace with real output from the YouTube topic-mining job
      // once built. Each row's "Generate this" action should eventually
      // queue trigger/content-generation.ts with this angle as a seed —
      // stubbed as a disabled button with a "Coming soon" tooltip for now,
      // see the Suggested Content Angles section in
      // components/apps/platform-my-channel-tab.tsx.
    ],
    influencerCandidates: [
      {
        id: "cand_yt_1",
        name: "DevReview",
        avatarInitials: "DR",
        followers: 218000,
        reach: 156000,
        postsPublished: 5,
        engagementRate: "6.2%",
        costTier: "Micro",
        matchReason: "Matches your dev-tools category, US audience. Their \"automate your stack\" video hit 4.1x their normal views.",
        contactEmail: "partnerships@devreview.example",
        viralVideos: [
          { title: "I automated my entire stack", views: 340000, multiplier: "4.1x" },
          { title: "5 tools every founder needs", views: 210000, multiplier: "2.3x" },
        ],
        status: "not_contacted",
      },
      {
        id: "cand_yt_2",
        name: "HealthGeekTV",
        avatarInitials: "HG",
        followers: 94000,
        reach: 88000,
        postsPublished: 4,
        engagementRate: "8.1%",
        costTier: "Nano",
        matchReason: "Reviews health apps weekly, India-based audience matches your target region.",
        contactEmail: null,
        viralVideos: [{ title: "Every health app I tried this year", views: 210000, multiplier: "3.4x" }],
        status: "not_contacted",
      },
      {
        id: "cand_yt_3",
        name: "IndieStackDaily",
        avatarInitials: "IS",
        followers: 61000,
        reach: 64000,
        postsPublished: 6,
        engagementRate: "9.4%",
        costTier: "Nano",
        matchReason: "Covers solo-founder tooling exclusively — smallest, most engaged audience match in this niche.",
        contactEmail: "hello@indiestackdaily.example",
        viralVideos: [{ title: "The only 3 tools I pay for as a solo founder", views: 88000, multiplier: "2.8x" }],
        status: "contacted",
      },
      {
        id: "cand_yt_4",
        name: "SaaS Teardown",
        avatarInitials: "ST",
        followers: 402000,
        reach: 298000,
        postsPublished: 4,
        engagementRate: "4.7%",
        costTier: "Mid",
        matchReason: "Reviews new SaaS launches weekly; strong track record of driving signups for tools it features.",
        contactEmail: "booking@saasteardown.example",
        viralVideos: [
          { title: "I tried 20 AI marketing tools so you don't have to", views: 512000, multiplier: "3.1x" },
          { title: "Ranking every code review tool in 2026", views: 276000, multiplier: "1.9x" },
        ],
        status: "responded",
      },
      {
        id: "cand_yt_5",
        name: "The Builder's Desk",
        avatarInitials: "BD",
        followers: 1200000,
        reach: 640000,
        postsPublished: 8,
        engagementRate: "2.9%",
        costTier: "Macro",
        matchReason: "Large general dev audience — lower engagement rate but significant reach for a launch moment.",
        contactEmail: "sponsorships@buildersdesk.example",
        viralVideos: [{ title: "The state of AI dev tools in 2026", views: 890000, multiplier: "1.6x" }],
        status: "booked",
      },
      // TODO: replace with real results from the niche-influencer-discovery
      // job once built, joined with contact status from whatever table
      // tracks outreach progress (e.g. an `influencer_candidates` table).
    ],
  },
  instagram: {
    channelIdentity: {
      avatarInitials: "AS",
      avatarUrl: null,
      handle: "@aiskillsguard",
      connected: true,
      // TODO: replace with real OAuth connection status + avatar URL from
      // the Instagram Graph API (Business Login) once the connect flow
      // exists.
    },
    channelMetrics: {
      viewsLabel: "Reach (28 days)",
      views: 5860,
      engagementRate: "4.8%",
      publishedLabel: "Posts published",
      published: 6,
      growthLabel: "Follower growth",
      growth: "+89",
      // TODO: replace with real values pulled from the social-performance
      // sync job against Instagram Business Insights once it exists.
    },
    checklist: [
      { label: "Business contact listed", pass: true },
      { label: "Bio link points to your app", pass: true },
      { label: "No highlight covers set", pass: false },
      { label: "Fewer than 9 grid posts", pass: false },
      // TODO: replace with real checks run against the connected account's
      // public profile data (Instagram Graph API) once the
      // channel-checklist job exists.
    ],
    contentAngles: [
      { title: "The 3-second hook every dev tool demo needs", source: "buildinpublic.sara, 180K views", multiplier: "3.6x" },
      { title: "POV: you finally automated your launch checklist", source: "indiehacker.tools, 95K views", multiplier: "2.7x" },
      // TODO: replace with real output from the Instagram topic-mining job
      // once built. Each row's "Generate this" action should eventually
      // queue trigger/content-generation.ts with this angle as a seed —
      // stubbed as disabled for now.
    ],
    influencerCandidates: [
      {
        id: "cand_ig_1",
        name: "buildinpublic.sara",
        avatarInitials: "BS",
        followers: 132000,
        reach: 98000,
        postsPublished: 12,
        engagementRate: "7.4%",
        costTier: "Micro",
        matchReason: "Build-in-public dev creator, audience overlaps heavily with early-stage SaaS founders.",
        contactEmail: "sara@buildinpublic.example",
        viralVideos: [{ title: "3-second hook every dev tool demo needs", views: 180000, multiplier: "3.6x" }],
        status: "not_contacted",
      },
      {
        id: "cand_ig_2",
        name: "indiehacker.tools",
        avatarInitials: "IT",
        followers: 48000,
        reach: 51000,
        postsPublished: 9,
        engagementRate: "9.9%",
        costTier: "Nano",
        matchReason: "Small, extremely engaged audience of exactly the solo-founder ICP.",
        contactEmail: null,
        viralVideos: [{ title: "POV: you finally automated your launch checklist", views: 95000, multiplier: "2.7x" }],
        status: "not_contacted",
      },
      {
        id: "cand_ig_3",
        name: "shipfast.daily",
        avatarInitials: "SF",
        followers: 276000,
        reach: 187000,
        postsPublished: 20,
        engagementRate: "5.1%",
        costTier: "Mid",
        matchReason: "Daily shipping/productivity content for developers, consistent brand-deal cadence.",
        contactEmail: "deals@shipfastdaily.example",
        viralVideos: [{ title: "I shipped 12 features this month using only AI", views: 210000, multiplier: "2.2x" }],
        status: "contacted",
      },
      {
        id: "cand_ig_4",
        name: "thecodecloset",
        avatarInitials: "TC",
        followers: 890000,
        reach: 412000,
        postsPublished: 15,
        engagementRate: "3.3%",
        costTier: "Macro",
        matchReason: "Broad developer-lifestyle audience — reach play rather than a tight ICP match.",
        contactEmail: "partnerships@thecodecloset.example",
        viralVideos: [{ title: "Every AI tool on my home screen", views: 640000, multiplier: "1.8x" }],
        status: "not_contacted",
      },
      // TODO: replace with real results from the niche-influencer-discovery
      // job once built, joined with contact status from whatever table
      // tracks outreach progress.
    ],
  },
  facebook: {
    channelIdentity: {
      avatarInitials: "AS",
      avatarUrl: null,
      handle: "AiSkillsGuard",
      connected: false,
      // TODO: replace with real OAuth connection status + avatar URL from
      // the Facebook Pages API once the connect flow exists. This entry is
      // deliberately `connected: false` so the "not connected" identity
      // strip state (connect prompt + button) has real dummy data to show
      // too, not just the connected state.
    },
    channelMetrics: {
      viewsLabel: "Reach (28 days)",
      views: 1320,
      engagementRate: "2.1%",
      publishedLabel: "Posts published",
      published: 1,
      growthLabel: "Page follower growth",
      growth: "+12",
      // TODO: replace with real values pulled from the social-performance
      // sync job against Facebook Pages Insights once it exists.
    },
    checklist: [
      { label: "Page category set correctly", pass: true },
      { label: "About section missing app link", pass: false },
      { label: "No call-to-action button configured", pass: false },
      // TODO: replace with real checks run against the connected Page's
      // public profile data (Facebook Pages API) once the
      // channel-checklist job exists.
    ],
    contentAngles: [
      { title: "A founder's honest review of their own launch week", source: "SaaS Weekly, 76K views", multiplier: "2.4x" },
      // TODO: replace with real output from the Facebook topic-mining job
      // once built. The "Generate this" action is stubbed as disabled for
      // now.
    ],
    influencerCandidates: [
      {
        id: "cand_fb_1",
        name: "SaaS Weekly",
        avatarInitials: "SW",
        followers: 156000,
        reach: 92000,
        postsPublished: 8,
        engagementRate: "3.8%",
        costTier: "Micro",
        matchReason: "Weekly SaaS roundup page with an engaged founder/operator audience.",
        contactEmail: "editor@saasweekly.example",
        viralVideos: [{ title: "A founder's honest review of their own launch week", views: 76000, multiplier: "2.4x" }],
        status: "not_contacted",
      },
      {
        id: "cand_fb_2",
        name: "Founders Coffee Chat",
        avatarInitials: "FC",
        followers: 42000,
        reach: 38000,
        postsPublished: 6,
        engagementRate: "6.6%",
        costTier: "Nano",
        matchReason: "Small, highly engaged community page of early-stage founders swapping tool recommendations.",
        contactEmail: null,
        viralVideos: [{ title: "Tools we all quietly switched to this year", views: 31000, multiplier: "1.9x" }],
        status: "not_contacted",
      },
      {
        id: "cand_fb_3",
        name: "The Startup Digest",
        avatarInitials: "TD",
        followers: 610000,
        reach: 254000,
        postsPublished: 10,
        engagementRate: "2.4%",
        costTier: "Mid",
        matchReason: "Broad startup-news page — good reach, moderate audience-fit match.",
        contactEmail: "ads@startupdigest.example",
        viralVideos: [{ title: "The AI tools startups actually pay for", views: 198000, multiplier: "1.5x" }],
        status: "not_contacted",
      },
      // TODO: replace with real results from the niche-influencer-discovery
      // job once built, joined with contact status from whatever table
      // tracks outreach progress.
    ],
  },
};

export function getPlatformDetailDummyData(platform: ContentPlatform): PlatformDetailDummyData | null {
  return PLATFORM_DETAIL_DUMMY_DATA[platform] ?? null;
}
