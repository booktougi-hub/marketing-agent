"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ListChecks,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AppSwitcher } from "@/components/dashboard/AppSwitcher";
import {
  ANALYTICS_NAV_ITEMS,
  AGENTS_NAV_LABEL,
  AUDIT_AGENTS_LABEL,
  AUDIT_NAV_ITEMS,
  CORE_NAV_LABEL,
  DOCUMENTATION_NAV_ITEMS,
  NAV_ITEMS,
  PERFORMANCE_NAV_LABEL,
  SOCIAL_NAV_ITEMS,
  useDashboardApp,
  type DashboardSection,
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
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && item.badge && (
        <Badge variant="secondary" className="shrink-0">
          {item.badge}
        </Badge>
      )}
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
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

// A nav row that owns a set of children rendered as a tree underneath it —
// e.g. "Content Agent" over its per-platform shortcuts, or "Audit Agents"
// over the four audit pages. Only rendered in the expanded sidebar; the
// collapsed icon rail flattens these via flattenEntries() instead, since
// there's no room for indentation in a 72px rail.
interface TreeParent {
  id: string;
  label: string;
  icon: LucideIcon;
  // Set only when the parent itself is a real page (e.g. Content Agent ->
  // /content). Parents with no page of their own (e.g. Audit Agents, which
  // has no combined /audits route) omit both and the row is toggle-only.
  section?: DashboardSection;
  href?: (appId: string) => string;
  badge?: string;
  children: NavItem[];
}

type AgentEntry = NavItem | TreeParent;

function isTreeParent(entry: AgentEntry): entry is TreeParent {
  return "children" in entry;
}

function NavTreeRow({
  parent,
  appId,
  activeSection,
  open,
  onToggle,
}: {
  parent: TreeParent;
  appId: string;
  activeSection: DashboardSection | null;
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = parent.icon;
  const isActive = parent.section != null && activeSection === parent.section;
  const href = parent.href?.(appId);

  const rowClassName = cn(
    "group/nav-row relative flex flex-1 items-center gap-2.5 rounded-lg py-2 px-2.5 text-sm font-medium transition-colors",
    isActive
      ? "bg-accent text-accent-foreground"
      : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
  );

  const mainContent = (
    <>
      <span
        className={cn(
          "absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary transition-opacity",
          isActive ? "opacity-100" : "opacity-0"
        )}
      />
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate text-left">{parent.label}</span>
      {parent.badge && (
        <Badge variant="secondary" className="shrink-0">
          {parent.badge}
        </Badge>
      )}
    </>
  );

  return (
    <div>
      <div className="flex items-center gap-0.5">
        {href ? (
          <Link href={href} className={rowClassName}>
            {mainContent}
          </Link>
        ) : (
          <button type="button" onClick={onToggle} className={rowClassName}>
            {mainContent}
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? `Collapse ${parent.label}` : `Expand ${parent.label}`}
          aria-expanded={open}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} />
        </button>
      </div>
      <NavGroupContent open={open}>
        {/* Indented one icon-width in, with a hairline connecting each
            child back up to the parent row — the "tree" look. */}
        <div className="ml-[19px] flex flex-col gap-0.5 border-l border-sidebar-border py-0.5 pl-3">
          {parent.children.map((child) => (
            <NavRow
              key={child.section}
              item={child}
              href={child.href(appId)}
              isActive={child.section === activeSection}
              collapsed={false}
            />
          ))}
        </div>
      </NavGroupContent>
    </div>
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

// Flattens tree parents back into a plain list of leaf items — used by the
// collapsed icon rail, where there's no room to show a tree, but every
// route still needs to stay reachable.
function flattenEntries(entries: AgentEntry[]): NavItem[] {
  return entries.flatMap((entry): NavItem[] => {
    if (!isTreeParent(entry)) return [entry];
    const parentAsItem: NavItem[] =
      entry.href && entry.section
        ? [{ section: entry.section, label: entry.label, href: entry.href, icon: entry.icon }]
        : [];
    return [...parentAsItem, ...entry.children];
  });
}

interface NavSection {
  id: string;
  label: string;
  entries: AgentEntry[];
}

function bySection(items: NavItem[], section: DashboardSection): NavItem {
  const item = items.find((i) => i.section === section);
  if (!item) throw new Error(`nav item not found for section "${section}"`);
  return item;
}

const OVERVIEW_ITEM = bySection(NAV_ITEMS, "overview");
const CONTENT_ITEM = bySection(NAV_ITEMS, "content");
const OPPORTUNITIES_ITEM = bySection(NAV_ITEMS, "opportunities");
const OUTREACH_ITEM = bySection(NAV_ITEMS, "outreach");
const RESEARCH_ITEM = bySection(NAV_ITEMS, "research");
const STRATEGY_ITEM = bySection(NAV_ITEMS, "strategy");
const SETTINGS_ITEM = bySection(NAV_ITEMS, "settings");
const SEO_ITEM = bySection(ANALYTICS_NAV_ITEMS, "seo");
const GEO_ITEM = bySection(ANALYTICS_NAV_ITEMS, "geo");
const GOOGLE_ANALYTICS_ITEM = bySection(ANALYTICS_NAV_ITEMS, "google-analytics");

const CONTENT_AGENT_PARENT: TreeParent = {
  id: "content",
  label: CONTENT_ITEM.label,
  icon: CONTENT_ITEM.icon,
  section: CONTENT_ITEM.section,
  href: CONTENT_ITEM.href,
  children: SOCIAL_NAV_ITEMS,
};

// No page of its own — there's no combined /audits route, just the four
// pages it groups — so unlike CONTENT_AGENT_PARENT this row only toggles.
const AUDIT_AGENTS_PARENT: TreeParent = {
  id: "audit-agents",
  label: AUDIT_AGENTS_LABEL,
  icon: ListChecks,
  badge: String(AUDIT_NAV_ITEMS.length),
  children: AUDIT_NAV_ITEMS,
};

// The story top to bottom: get set up (Core), let the agents work (AI
// Agents), then watch the numbers (Performance). Static across the app's
// lifetime — computed once at module scope, same reasoning as the old
// SECTION_ITEMS constant this replaces.
const NAV_SECTIONS: NavSection[] = [
  {
    id: "core",
    label: CORE_NAV_LABEL,
    entries: [OVERVIEW_ITEM, ...DOCUMENTATION_NAV_ITEMS],
  },
  {
    id: "agents",
    label: AGENTS_NAV_LABEL,
    entries: [
      STRATEGY_ITEM,
      CONTENT_AGENT_PARENT,
      OPPORTUNITIES_ITEM,
      OUTREACH_ITEM,
      RESEARCH_ITEM,
      SEO_ITEM,
      GEO_ITEM,
      AUDIT_AGENTS_PARENT,
    ],
  },
  {
    id: "performance",
    label: PERFORMANCE_NAV_LABEL,
    entries: [GOOGLE_ANALYTICS_ITEM],
  },
];

const ALL_TREE_PARENTS = NAV_SECTIONS.flatMap((s) => s.entries).filter(isTreeParent);

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

  // Each tree row (Content Agent, Audit Agents, ...) expands independently
  // — unlike the old single-open accordion, several can be open at once.
  // Whenever the active page changes, auto-open whichever row contains it
  // (itself or one of its children) so the current location is never
  // hidden inside a collapsed row — a manual click still always wins
  // afterward, this only ever adds to the open set, never removes.
  const [openParents, setOpenParents] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!activeSection) return;
    const match = ALL_TREE_PARENTS.find(
      (p) => p.section === activeSection || p.children.some((c) => c.section === activeSection)
    );
    if (!match) return;
    setOpenParents((prev) => (prev.has(match.id) ? prev : new Set(prev).add(match.id)));
  }, [activeSection]);

  function toggleParent(id: string) {
    setOpenParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "hidden h-screen shrink-0 flex-col border-r bg-sidebar md:flex",
        // Skip the width transition on first paint so there's no visible
        // snap from expanded (SSR default) to the persisted collapsed state.
        hydrated && "transition-[width] duration-200 ease-out",
        collapsed ? "w-[72px]" : "w-64"
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
        <AppSwitcher collapsed={collapsed} id="app-switcher-desktop" />
      </div>

      {selectedApp ? (
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {NAV_SECTIONS.map((section, index) => (
            <div key={section.id}>
              {collapsed ? (
                <Separator className={cn(index > 0 && "my-1")} />
              ) : (
                <div className={cn("px-2.5 pb-1.5", index === 0 ? "pt-1" : "pt-4")}>
                  <span className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
                    {section.label}
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {collapsed
                  ? flattenEntries(section.entries).map((item) => (
                      <NavRow
                        key={item.section}
                        item={item}
                        href={item.href(selectedApp.id)}
                        isActive={item.section === activeSection}
                        collapsed
                      />
                    ))
                  : section.entries.map((entry) =>
                      isTreeParent(entry) ? (
                        <NavTreeRow
                          key={entry.id}
                          parent={entry}
                          appId={selectedApp.id}
                          activeSection={activeSection}
                          open={openParents.has(entry.id)}
                          onToggle={() => toggleParent(entry.id)}
                        />
                      ) : (
                        <NavRow
                          key={entry.section}
                          item={entry}
                          href={entry.href(selectedApp.id)}
                          isActive={entry.section === activeSection}
                          collapsed={false}
                        />
                      )
                    )}
              </div>
            </div>
          ))}
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
