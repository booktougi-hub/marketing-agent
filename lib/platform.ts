import { FaDev, FaFacebook, FaInstagram, FaLinkedin, FaXTwitter, FaYoutube } from "react-icons/fa6";
import type { IconType } from "react-icons";
import type { ContentPlatform } from "@/types";

// Fixed categorical order/identity for every platform, shared by any chart
// or badge in the app — color must follow the entity, never shift with
// filters or which platforms happen to appear in a given data set.
export const PLATFORM_ORDER: ContentPlatform[] = [
  "twitter",
  "linkedin",
  "instagram",
  "facebook",
  "devto",
  "youtube",
];

export const PLATFORM_COLOR_VAR: Record<ContentPlatform, string> = {
  twitter: "var(--chart-1)",
  linkedin: "var(--chart-2)",
  instagram: "var(--chart-3)",
  facebook: "var(--chart-4)",
  devto: "var(--chart-5)",
  youtube: "var(--chart-6)",
};

export const PLATFORM_LABEL: Record<ContentPlatform, string> = {
  twitter: "Twitter",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  devto: "Dev.to",
  youtube: "YouTube",
};

// Real brand colors (not the abstract chart-categorical PLATFORM_COLOR_VAR
// above) — used only where the platform's own visual identity needs to be
// literally recognizable, e.g. the brand icon badge on the platform detail
// view, or the Settings > Connected Platforms integration cards. Extended
// to cover every ContentPlatform (twitter/linkedin/devto added alongside
// the original three) since Connected Platforms needs a real brand icon
// for all of them, not just the three the platform detail view used.
export const PLATFORM_BRAND_COLOR: Partial<Record<ContentPlatform, string>> = {
  youtube: "#FF0000",
  instagram: "#E4405F",
  facebook: "#1877F2",
  twitter: "#000000",
  linkedin: "#0A66C2",
  devto: "#0A0A0A",
};

export const PLATFORM_BRAND_ICON: Partial<Record<ContentPlatform, IconType>> = {
  youtube: FaYoutube,
  instagram: FaInstagram,
  facebook: FaFacebook,
  twitter: FaXTwitter,
  linkedin: FaLinkedin,
  devto: FaDev,
};

// Terminology for the Top Influencers candidate stat row
// (components/apps/platform-influencer-candidate-card.tsx) — real,
// permanent labels (unlike the numbers behind them, which are still dummy
// data — see lib/dummy-data/platform-detail.ts). "Reach" reads naturally
// for Instagram/Facebook; YouTube's closer real equivalent is "Views".
export interface PlatformInfluencerMetricLabels {
  reach: string;
  engagement: string;
  published: string;
  followers: string;
}

export const PLATFORM_INFLUENCER_METRIC_LABELS: Partial<Record<ContentPlatform, PlatformInfluencerMetricLabels>> = {
  youtube: { reach: "Views", engagement: "Engagement rate", published: "Videos published", followers: "Subscribers" },
  instagram: { reach: "Reach", engagement: "Engagement rate", published: "Posts published", followers: "Followers" },
  facebook: { reach: "Reach", engagement: "Engagement rate", published: "Posts published", followers: "Followers" },
};
