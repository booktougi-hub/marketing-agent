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
