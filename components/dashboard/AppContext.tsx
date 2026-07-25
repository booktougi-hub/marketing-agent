"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { AppStatus } from "@/types";
import {
  PLATFORM_TO_SECTION,
  SEGMENT_TO_SECTION,
  type DashboardSection,
} from "@/components/dashboard/nav-items";

export type { DashboardSection, NavItem } from "@/components/dashboard/nav-items";
export {
  NAV_ITEMS,
  SOCIAL_NAV_ITEMS,
  AUDIT_NAV_ITEMS,
  ANALYTICS_NAV_ITEMS,
  DOCUMENTATION_NAV_ITEMS,
  PRIMARY_NAV_LABEL,
  SOCIAL_NAV_LABEL,
  AUDITS_NAV_LABEL,
  ANALYTICS_NAV_LABEL,
  DOCUMENTATION_NAV_LABEL,
} from "@/components/dashboard/nav-items";

export interface DashboardApp {
  id: string;
  name: string | null;
  source_url: string;
  icon_url: string | null;
  status: AppStatus;
}

interface AppContextValue {
  apps: DashboardApp[];
  selectedApp: DashboardApp | null;
  selectedAppId: string | null;
  activeSection: DashboardSection | null;
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
  const searchParams = useSearchParams();

  const { selectedAppId, activeSection } = useMemo(() => {
    const match = pathname.match(/^\/dashboard\/apps\/([^/]+)(?:\/([^/]+))?/);
    if (!match || match[1] === "new") {
      return { selectedAppId: null, activeSection: null };
    }
    const [, appId, segment] = match;
    let section = segment ? SEGMENT_TO_SECTION[segment] ?? null : null;

    if (section === "content") {
      const platform = searchParams.get("platform");
      section = (platform && PLATFORM_TO_SECTION[platform]) || section;
    }

    return { selectedAppId: appId, activeSection: section };
  }, [pathname, searchParams]);

  const selectedApp = useMemo(
    () => apps.find((app) => app.id === selectedAppId) ?? null,
    [apps, selectedAppId]
  );

  const value: AppContextValue = {
    apps,
    selectedApp,
    selectedAppId,
    activeSection,
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
