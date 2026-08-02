import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Compass,
  DollarSign,
  FileText,
  HeartHandshake,
  LayoutDashboard,
  MousePointerClick,
  Palette,
  Search,
  Send,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
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
  | "content-facebook"
  | "onboarding"
  | "retention"
  | "conversion"
  | "pricing"
  | "google-analytics"
  | "seo"
  | "geo"
  | "product-information"
  | "brand-information";

export interface NavItem {
  section: DashboardSection;
  label: string;
  href: (appId: string) => string;
  icon: LucideIcon;
  // Only set on shortcuts into the Content tab pre-filtered to one platform
  // (the "Social Content" group) — AppContext uses this to tell those apart
  // from the plain "Content" link, which shares the same URL segment.
  platformFilter?: ContentPlatform;
  // Short monochromatic tag rendered at the row's trailing edge (e.g. "GA").
  // Distinct from platformFilter's colored abbreviation chip.
  badge?: string;
}

// Order here drives the order rendered in the app sidebar's primary group.
// Labels for the working, agent-driven sections carry an "Agent" suffix
// (Content Agent, Strategy Agent, ...) — this SaaS's whole pitch is
// autonomous agents doing the marketing work, and app-services-view.tsx's
// descriptions already refer to e.g. "the onboarding-audit agent"; the
// suffix just makes that framing visible in the nav too. Overview and
// Settings aren't agents themselves, so they keep plain labels.
export const NAV_ITEMS: NavItem[] = [
  { section: "overview", label: "Overview", href: (id) => `/dashboard/apps/${id}/overview`, icon: LayoutDashboard },
  { section: "content", label: "Content Agent", href: (id) => `/dashboard/apps/${id}/content`, icon: FileText },
  { section: "opportunities", label: "Opportunities Agent", href: (id) => `/dashboard/apps/${id}/opportunities`, icon: Compass },
  { section: "outreach", label: "Outreach Agent", href: (id) => `/dashboard/apps/${id}/outreach`, icon: Send },
  { section: "research", label: "Research Agent", href: (id) => `/dashboard/apps/${id}/research`, icon: Search },
  { section: "strategy", label: "Strategy Agent", href: (id) => `/dashboard/apps/${id}/strategy`, icon: Target },
  { section: "settings", label: "Settings", href: (id) => `/dashboard/apps/${id}/settings`, icon: Settings },
];

// The "Documentation" family (as opposed to Strategy, which is the
// actionable/approve-regenerate workflow). Product Information is a static,
// read-only mirror of the raw DNA facts extracted from the app's own site.
// Brand Information is the full editable Brand Identity feature
// (components/apps/brand-identity-section.tsx) — auto-extracted via
// trigger/brand-info-extraction.ts into the brand_information table, then
// reviewed/edited/confirmed here; this used to be a read-only DNA-derived
// summary and a separate editable "Brand Identity" Settings section, but
// having the same concept live in two places under two different names was
// confusing, so it's now one page. Kept separate from NAV_ITEMS, same
// reason SOCIAL_NAV_ITEMS is: only AppSidebar renders this group under its
// own label.
export const DOCUMENTATION_NAV_ITEMS: NavItem[] = [
  {
    section: "product-information",
    label: "Product Information",
    href: (id) => `/dashboard/apps/${id}/product-information`,
    icon: BookOpen,
  },
  {
    section: "brand-information",
    label: "Brand Information",
    href: (id) => `/dashboard/apps/${id}/brand-information`,
    icon: Palette,
  },
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

// The "Audits" family — onboarding, retention, conversion, and pricing
// (see PHASES.md Notes Log, 2026-07-22 for all four). This "pricing"
// section audits the END USER'S app pricing/packaging — unrelated to this
// SaaS's own billing/plan_tier (workspaces.plan_tier, /dashboard/settings)
// even though the label is similar; the URL segments never collide since
// this one is scoped under /dashboard/apps/[id]/. Kept separate from
// NAV_ITEMS, same reason SOCIAL_NAV_ITEMS is: only AppSidebar renders this
// group under its own label.
export const AUDIT_NAV_ITEMS: NavItem[] = [
  {
    section: "onboarding",
    label: "Onboarding",
    href: (id) => `/dashboard/apps/${id}/onboarding`,
    icon: ClipboardCheck,
  },
  {
    section: "retention",
    label: "Retention",
    href: (id) => `/dashboard/apps/${id}/retention`,
    icon: HeartHandshake,
  },
  {
    section: "conversion",
    label: "Conversion",
    href: (id) => `/dashboard/apps/${id}/conversion`,
    icon: MousePointerClick,
  },
  {
    section: "pricing",
    label: "Pricing",
    href: (id) => `/dashboard/apps/${id}/pricing`,
    icon: DollarSign,
  },
];

// The "Analytics" family — Google Analytics, SEO, and GEO. SEO and GEO are
// both real, working pages now (SCORING.md's two evaluation tracks, one
// engine — see trigger/seo-geo-audit.ts), so in the sidebar they render as
// agent rows alongside the other working agents. Google Analytics is still
// an honest "not built yet" placeholder (see its page.tsx) rather than a
// broken link, pending a Google Cloud OAuth client — it renders on its own
// under the sidebar's Performance section, badged "GA". Kept as one array
// (only AppSidebar consumes it, and it iterates all three) rather than
// splitting the export, so the split lives in the one place that cares
// about presentation grouping.
export const ANALYTICS_NAV_ITEMS: NavItem[] = [
  {
    section: "google-analytics",
    label: "Analytics",
    href: (id) => `/dashboard/apps/${id}/google-analytics`,
    icon: BarChart3,
    badge: "GA",
  },
  {
    section: "seo",
    label: "SEO Agent",
    href: (id) => `/dashboard/apps/${id}/seo`,
    icon: TrendingUp,
  },
  {
    section: "geo",
    label: "GEO Agent",
    href: (id) => `/dashboard/apps/${id}/geo`,
    icon: Sparkles,
  },
];

// The sidebar's three top-level sections tell the product's growth story
// top to bottom: get set up (Core), let the agents do the work (AI
// Agents), then watch the numbers (Performance). Unlike the old
// Documentation/Growth/Social Content/Audits/Analytics groups, these three
// are always visible (no accordion) — only individual agent rows with
// children expand/collapse.
export const CORE_NAV_LABEL = "Core";
export const AGENTS_NAV_LABEL = "AI Agents";
export const PERFORMANCE_NAV_LABEL = "Performance";
// Label for the synthetic "Audit Agents" tree row that groups
// AUDIT_NAV_ITEMS under one expandable parent in the sidebar — it has no
// page of its own (no combined /audits route), so it's assembled directly
// in AppSidebar rather than added as a NAV_ITEMS entry.
export const AUDIT_AGENTS_LABEL = "Audit Agents";

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
  onboarding: "onboarding",
  retention: "retention",
  conversion: "conversion",
  pricing: "pricing",
  "google-analytics": "google-analytics",
  seo: "seo",
  geo: "geo",
  "product-information": "product-information",
  "brand-information": "brand-information",
};

// Maps the `?platform=` query param on the content page to the matching
// Social Content sidebar entry, so that group highlights correctly even
// though it shares the "content" URL segment with the plain Content link.
export const PLATFORM_TO_SECTION: Partial<Record<string, DashboardSection>> = {
  youtube: "content-youtube",
  instagram: "content-instagram",
  facebook: "content-facebook",
};
