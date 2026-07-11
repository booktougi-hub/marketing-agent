"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronsLeft, ChevronsRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AppSwitcher } from "@/components/dashboard/AppSwitcher";
import {
  NAV_ITEMS,
  PRIMARY_NAV_LABEL,
  SOCIAL_NAV_ITEMS,
  SOCIAL_NAV_LABEL,
  useDashboardApp,
  type NavItem,
} from "@/components/dashboard/AppContext";
import { PLATFORM_COLOR_VAR } from "@/lib/platform";
import type { ContentPlatform } from "@/types";

const COLLAPSE_STORAGE_KEY = "agentmark-sidebar-collapsed";

const SOCIAL_ABBREVIATION: Partial<Record<ContentPlatform, string>> = {
  youtube: "YT",
  instagram: "IG",
  facebook: "FB",
};

function NavRow({
  item,
  href,
  isActive,
  collapsed,
}: {
  item: NavItem;
  href: string;
  isActive: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const abbreviation = item.platformFilter ? SOCIAL_ABBREVIATION[item.platformFilter] : undefined;
  const accentColor = item.platformFilter ? PLATFORM_COLOR_VAR[item.platformFilter] : undefined;

  const rowClassName = cn(
    "group/nav-row relative flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition-colors",
    collapsed ? "justify-center px-2" : "px-2.5",
    isActive
      ? "bg-accent text-accent-foreground"
      : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
  );

  const content = (
    <>
      <span
        className={cn(
          "absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary transition-opacity",
          isActive ? "opacity-100" : "opacity-0"
        )}
      />
      {abbreviation ? (
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold"
          style={{
            backgroundColor: `color-mix(in oklch, ${accentColor} 18%, transparent)`,
            color: accentColor,
          }}
        >
          {abbreviation}
        </span>
      ) : (
        <Icon className="h-4 w-4 shrink-0" />
      )}
      {!collapsed && <span className="truncate">{item.label}</span>}
    </>
  );

  if (!collapsed) {
    return (
      <Link href={href} className={rowClassName}>
        {content}
      </Link>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger render={<Link href={href} className={rowClassName} />}>
        {content}
      </TooltipTrigger>
      <TooltipContent>{item.label}</TooltipContent>
    </Tooltip>
  );
}

function NavGroupLabel({ children, collapsed }: { children: React.ReactNode; collapsed: boolean }) {
  if (collapsed) {
    return <Separator className="my-1" />;
  }
  return (
    <p className="px-2.5 pt-3 pb-1 font-mono text-[10px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
      {children}
    </p>
  );
}

export function AppSidebar() {
  const { selectedApp, activeSection } = useDashboardApp();
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
    setHydrated(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const sectionItems = NAV_ITEMS.filter((item) => item.section !== "settings");
  const settingsItem = NAV_ITEMS.find((item) => item.section === "settings")!;
  const settingsHref = selectedApp
    ? settingsItem.href(selectedApp.id)
    : "/dashboard/settings";

  return (
    <aside
      className={cn(
        "hidden h-screen shrink-0 flex-col border-r bg-sidebar md:flex",
        // Skip the width transition on first paint so there's no visible
        // snap from expanded (SSR default) to the persisted collapsed state.
        hydrated && "transition-[width] duration-200 ease-out",
        collapsed ? "w-[72px]" : "w-60"
      )}
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center justify-between border-b",
          collapsed ? "px-2" : "px-4"
        )}
      >
        <Link
          href="/dashboard/apps"
          className="flex min-w-0 items-center gap-2 font-heading text-base font-semibold tracking-tight"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          {!collapsed && <span className="truncate">AgentMark</span>}
        </Link>
        {/* Always in the same spot regardless of collapsed state, so it's
            predictable where to find it — it used to jump to the footer
            when collapsed and users couldn't find it again. */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  aria-label="Expand sidebar"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                />
              }
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className={cn("border-b p-2", collapsed && "flex justify-center")}>
        <AppSwitcher collapsed={collapsed} />
      </div>

      {selectedApp ? (
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          <NavGroupLabel collapsed={collapsed}>{PRIMARY_NAV_LABEL}</NavGroupLabel>
          {sectionItems.map((item) => (
            <NavRow
              key={item.section}
              item={item}
              href={item.href(selectedApp.id)}
              isActive={item.section === activeSection}
              collapsed={collapsed}
            />
          ))}

          <NavGroupLabel collapsed={collapsed}>{SOCIAL_NAV_LABEL}</NavGroupLabel>
          {SOCIAL_NAV_ITEMS.map((item) => (
            <NavRow
              key={item.section}
              item={item}
              href={item.href(selectedApp.id)}
              isActive={item.section === activeSection}
              collapsed={collapsed}
            />
          ))}
        </nav>
      ) : (
        <div className="flex-1" />
      )}

      <Separator />
      <div className="flex flex-col gap-0.5 p-2">
        <NavRow
          item={settingsItem}
          href={settingsHref}
          isActive={activeSection === "settings"}
          collapsed={collapsed}
        />
      </div>
    </aside>
  );
}
