import {
  Compass,
  FileText,
  LayoutDashboard,
  Search,
  Send,
  Settings,
  Target,
  type LucideIcon,
} from "lucide-react";
import type { ContentPlatform } from "@/types";

export type DashboardSection =
  | "overview"
  | "content"
  | "opportunities"
  | "outreach"
  | "research"
  | "strategy"
  | "settings"
  | "services"
  | "chat"
  | "content-youtube"
  | "content-instagram"
  | "content-facebook";

export interface NavItem {
  section: DashboardSection;
  label: string;
  href: (appId: string) => string;
  icon: LucideIcon;
  // Only set on shortcuts into the Content tab pre-filtered to one platform
  // (the "Social Content" group) — AppContext uses this to tell those apart
  // from the plain "Content" link, which shares the same URL segment.
  platformFilter?: ContentPlatform;
}

// Order here drives the order rendered in the app sidebar's primary group.
export const NAV_ITEMS: NavItem[] = [
  { section: "overview", label: "Overview", href: (id) => `/dashboard/apps/${id}/overview`, icon: LayoutDashboard },
  { section: "content", label: "Content", href: (id) => `/dashboard/apps/${id}/content`, icon: FileText },
  { section: "opportunities", label: "Opportunities", href: (id) => `/dashboard/apps/${id}/opportunities`, icon: Compass },
  { section: "outreach", label: "Outreach", href: (id) => `/dashboard/apps/${id}/outreach`, icon: Send },
  { section: "research", label: "Research", href: (id) => `/dashboard/apps/${id}/research`, icon: Search },
  { section: "strategy", label: "Strategy", href: (id) => `/dashboard/apps/${id}/strategy`, icon: Target },
  { section: "settings", label: "Settings", href: (id) => `/dashboard/apps/${id}/settings`, icon: Settings },
];

// Direct shortcuts into the Content tab, pre-filtered to one platform. Kept
// separate from NAV_ITEMS so the generic consumers of that flat list (the
// Services grid, breadcrumb label lookup, mobile nav) don't pick these up —
// only AppSidebar renders this group.
export const SOCIAL_NAV_ITEMS: NavItem[] = [
  {
    section: "content-youtube",
    label: "YouTube",
    href: (id) => `/dashboard/apps/${id}/content?platform=youtube`,
    icon: FileText,
    platformFilter: "youtube",
  },
  {
    section: "content-instagram",
    label: "Instagram",
    href: (id) => `/dashboard/apps/${id}/content?platform=instagram`,
    icon: FileText,
    platformFilter: "instagram",
  },
  {
    section: "content-facebook",
    label: "Facebook",
    href: (id) => `/dashboard/apps/${id}/content?platform=facebook`,
    icon: FileText,
    platformFilter: "facebook",
  },
];

export const PRIMARY_NAV_LABEL = "Growth";
export const SOCIAL_NAV_LABEL = "Social Content";

// Maps the URL segment right after /dashboard/apps/[id]/ to a section.
// No segment (i.e. the legacy strategy-approval index route) has no nav match.
export const SEGMENT_TO_SECTION: Record<string, DashboardSection> = {
  overview: "overview",
  content: "content",
  opportunities: "opportunities",
  outreach: "outreach",
  research: "research",
  strategy: "strategy",
  settings: "settings",
  services: "services",
};

// Maps the `?platform=` query param on the content page to the matching
// Social Content sidebar entry, so that group highlights correctly even
// though it shares the "content" URL segment with the plain Content link.
export const PLATFORM_TO_SECTION: Partial<Record<string, DashboardSection>> = {
  youtube: "content-youtube",
  instagram: "content-instagram",
  facebook: "content-facebook",
};
