"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
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
import type { AppStatus } from "@/types";

export interface DashboardApp {
  id: string;
  name: string | null;
  source_url: string;
  status: AppStatus;
}

export type DashboardSection =
  | "overview"
  | "content"
  | "opportunities"
  | "outreach"
  | "research"
  | "strategy"
  | "settings";

export interface NavItem {
  section: DashboardSection;
  label: string;
  href: (appId: string) => string;
  icon: LucideIcon;
}

// Order here drives the order rendered in the app sidebar.
export const NAV_ITEMS: NavItem[] = [
  { section: "overview", label: "Overview", href: (id) => `/dashboard/apps/${id}/overview`, icon: LayoutDashboard },
  { section: "content", label: "Content", href: (id) => `/dashboard/apps/${id}/content`, icon: FileText },
  { section: "opportunities", label: "Opportunities", href: (id) => `/dashboard/apps/${id}/opportunities`, icon: Compass },
  { section: "outreach", label: "Outreach", href: (id) => `/dashboard/apps/${id}/outreach`, icon: Send },
  { section: "research", label: "Research", href: (id) => `/dashboard/apps/${id}/research`, icon: Search },
  { section: "strategy", label: "Strategy", href: (id) => `/dashboard/apps/${id}/strategy`, icon: Target },
  { section: "settings", label: "Settings", href: (id) => `/dashboard/apps/${id}/settings`, icon: Settings },
];

// Maps the URL segment right after /dashboard/apps/[id]/ to a section.
// No segment (i.e. the legacy strategy-approval index route) has no nav match.
const SEGMENT_TO_SECTION: Record<string, DashboardSection> = {
  overview: "overview",
  content: "content",
  opportunities: "opportunities",
  outreach: "outreach",
  research: "research",
  strategy: "strategy",
  settings: "settings",
};

interface AppContextValue {
  apps: DashboardApp[];
  selectedApp: DashboardApp | null;
  selectedAppId: string | null;
  activeSection: DashboardSection | null;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppContextProvider({
  apps,
  children,
}: {
  apps: DashboardApp[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { selectedAppId, activeSection } = useMemo(() => {
    const match = pathname.match(/^\/dashboard\/apps\/([^/]+)(?:\/([^/]+))?/);
    if (!match || match[1] === "new") {
      return { selectedAppId: null, activeSection: null };
    }
    const [, appId, segment] = match;
    const section = segment ? SEGMENT_TO_SECTION[segment] ?? null : null;
    return { selectedAppId: appId, activeSection: section };
  }, [pathname]);

  const selectedApp = useMemo(
    () => apps.find((app) => app.id === selectedAppId) ?? null,
    [apps, selectedAppId]
  );

  const value: AppContextValue = {
    apps,
    selectedApp,
    selectedAppId,
    activeSection,
    sidebarCollapsed,
    setSidebarCollapsed,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useDashboardApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useDashboardApp must be used within an AppContextProvider");
  }
  return ctx;
}
