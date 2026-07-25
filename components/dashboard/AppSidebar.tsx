"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronsLeft, ChevronsRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AppSwitcher } from "@/components/dashboard/AppSwitcher";
import {
  ANALYTICS_NAV_ITEMS,
  ANALYTICS_NAV_LABEL,
  AUDIT_NAV_ITEMS,
  AUDITS_NAV_LABEL,
  DOCUMENTATION_NAV_ITEMS,
  DOCUMENTATION_NAV_LABEL,
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

// Accordion header for a collapsible nav group — clicking it opens that
// group (see AppSidebar's openGroup state). In the icon-only collapsed
// sidebar there's no room for a label or the accordion interaction at all,
// so every group just stays visible, separated by a divider, same as before.
function NavGroupHeader({
  label,
  collapsed,
  open,
  onToggle,
}: {
  label: string;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  if (collapsed) {
    return <Separator className="my-1" />;
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center justify-between rounded-md px-2.5 pt-3 pb-1 text-left font-mono text-[10px] font-semibold tracking-wider text-muted-foreground/70 uppercase transition-colors hover:text-muted-foreground"
    >
      {label}
      <ChevronDown className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")} />
    </button>
  );
}

// CSS-only expand/collapse (grid-template-rows 0fr -> 1fr) — no JS height
// measurement needed, and no children unmount so state inside a group's
// rows never resets when it collapses.
function NavGroupContent({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-200 ease-out",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      )}
    >
      <div className="flex flex-col gap-0.5 overflow-hidden">{children}</div>
    </div>
  );
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

// Static across the app's lifetime — computed once at module scope so
// every consumer (and the effect below that keys off it) sees the exact
// same array reference on every render, not a new one from re-filtering
// NAV_ITEMS inline. A reference that changes every render would re-fire
// that effect on every render too, fighting any manual accordion click.
const SECTION_ITEMS = NAV_ITEMS.filter((item) => item.section !== "settings");
const SETTINGS_ITEM = NAV_ITEMS.find((item) => item.section === "settings")!;
const NAV_GROUPS: NavGroup[] = [
  { id: "documentation", label: DOCUMENTATION_NAV_LABEL, items: DOCUMENTATION_NAV_ITEMS },
  { id: "primary", label: PRIMARY_NAV_LABEL, items: SECTION_ITEMS },
  { id: "social", label: SOCIAL_NAV_LABEL, items: SOCIAL_NAV_ITEMS },
  { id: "audits", label: AUDITS_NAV_LABEL, items: AUDIT_NAV_ITEMS },
  { id: "analytics", label: ANALYTICS_NAV_LABEL, items: ANALYTICS_NAV_ITEMS },
];

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

  const settingsHref = selectedApp
    ? SETTINGS_ITEM.href(selectedApp.id)
    : "/dashboard/settings";

  // Accordion: exactly one group open at a time. Whenever the active page
  // changes (navigation, app switch, direct URL), auto-open whichever group
  // contains it so the current location is never hidden inside a collapsed
  // section — a manual click always wins until the active section moves.
  const [openGroup, setOpenGroup] = useState(NAV_GROUPS[0].id);

  useEffect(() => {
    if (!activeSection) return;
    const match = NAV_GROUPS.find((group) =>
      group.items.some((item) => item.section === activeSection)
    );
    if (match) setOpenGroup(match.id);
  }, [activeSection]);

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
          {NAV_GROUPS.map((group) => {
            const isOpen = openGroup === group.id;
            const rows = group.items.map((item) => (
              <NavRow
                key={item.section}
                item={item}
                href={item.href(selectedApp.id)}
                isActive={item.section === activeSection}
                collapsed={collapsed}
              />
            ));
            return (
              <div key={group.id}>
                <NavGroupHeader
                  label={group.label}
                  collapsed={collapsed}
                  open={isOpen}
                  onToggle={() => setOpenGroup(group.id)}
                />
                {collapsed ? rows : <NavGroupContent open={isOpen}>{rows}</NavGroupContent>}
              </div>
            );
          })}
        </nav>
      ) : (
        <div className="flex-1" />
      )}

      <Separator />
      <div className="flex flex-col gap-0.5 p-2">
        <NavRow
          item={SETTINGS_ITEM}
          href={settingsHref}
          isActive={activeSection === "settings"}
          collapsed={collapsed}
        />
      </div>
    </aside>
  );
}
