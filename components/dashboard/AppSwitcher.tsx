"use client";

import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, CircleDot, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AppIcon } from "@/components/apps/app-icon";
import type { AppStatus } from "@/types";
import { NAV_ITEMS, SOCIAL_NAV_ITEMS, useDashboardApp } from "@/components/dashboard/AppContext";

// Shortened relative to the full labels shown in TopBar — this dropdown row
// has limited width and needs to leave room for the app name to stay legible.
const STATUS_LABELS: Record<AppStatus, string> = {
  pending: "Pending",
  extracting: "Extracting",
  strategy_pending: "Strategizing",
  awaiting_approval: "Review",
  active: "Active",
  paused: "Paused",
  error: "Error",
  deleted: "Deleted",
};

const STATUS_DOT_CLASS: Record<AppStatus, string> = {
  pending: "text-muted-foreground",
  extracting: "text-status-warning",
  strategy_pending: "text-status-warning",
  awaiting_approval: "text-status-warning",
  active: "text-status-good",
  paused: "text-muted-foreground",
  error: "text-destructive",
  deleted: "text-muted-foreground",
};

export function AppSwitcher({
  className,
  collapsed = false,
}: {
  className?: string;
  collapsed?: boolean;
}) {
  const router = useRouter();
  const { apps, selectedApp, selectedAppId, activeSection } = useDashboardApp();

  function hrefForApp(appId: string) {
    const allItems = [...NAV_ITEMS, ...SOCIAL_NAV_ITEMS];
    const item = allItems.find((i) => i.section === (activeSection ?? "overview"));
    return (item ?? NAV_ITEMS[0]).href(appId);
  }

  const displayName = selectedApp?.name || selectedApp?.source_url || "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-lg py-1.5 text-left outline-none transition-colors hover:bg-accent/60 data-popup-open:bg-accent/60",
          collapsed ? "justify-center px-1.5" : "px-2",
          className
        )}
      >
        {selectedApp ? (
          <AppIcon name={displayName} iconUrl={selectedApp.icon_url} className="h-7 w-7" />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
            <Plus className="h-3.5 w-3.5" />
          </span>
        )}

        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              {selectedApp ? (
                <>
                  <p className="truncate text-sm font-medium">{displayName}</p>
                  <p className="flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground">
                    <CircleDot className={cn("h-2.5 w-2.5", STATUS_DOT_CLASS[selectedApp.status])} />
                    {STATUS_LABELS[selectedApp.status]}
                  </p>
                </>
              ) : (
                <p className="truncate text-sm font-medium text-muted-foreground">
                  Select an app
                </p>
              )}
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={cn(collapsed ? "w-64" : "w-(--anchor-width)", "min-w-64")}
        align="start"
        side={collapsed ? "right" : "bottom"}
        sideOffset={collapsed ? 8 : 4}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Your apps</DropdownMenuLabel>
          {apps.length === 0 ? (
            <p className="px-1.5 py-2 text-sm text-muted-foreground">No apps yet</p>
          ) : (
            apps.map((app) => {
              const name = app.name || app.source_url;
              const isSelected = app.id === selectedAppId;
              return (
                <DropdownMenuItem
                  key={app.id}
                  onClick={() => router.push(hrefForApp(app.id))}
                  className="gap-2 py-1.5"
                >
                  <AppIcon name={name} iconUrl={app.icon_url} className="h-6 w-6 text-[10px]" />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground">
                    <CircleDot className={cn("h-2.5 w-2.5", STATUS_DOT_CLASS[app.status])} />
                    {STATUS_LABELS[app.status]}
                  </span>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/dashboard/apps/new")} className="gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
            <Plus className="h-3.5 w-3.5" />
          </span>
          Add new app
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
