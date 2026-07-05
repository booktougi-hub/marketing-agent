"use client";

import Link from "next/link";
import { Settings, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboardApp, type DashboardApp } from "@/components/dashboard/AppContext";

function getInitials(app: DashboardApp) {
  const source = app.name?.trim() || app.source_url.replace(/^https?:\/\//, "");
  return source.slice(0, 2).toUpperCase();
}

function RailTooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className={cn(
        "pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background opacity-0 shadow-md transition-opacity",
        "group-hover:opacity-100"
      )}
    >
      {label}
    </span>
  );
}

export function IconRail() {
  const { apps, selectedAppId } = useDashboardApp();

  return (
    <aside className="flex h-screen w-[60px] shrink-0 flex-col items-center justify-between border-r bg-card py-3">
      <div className="flex flex-col items-center gap-3">
        <Link
          href="/dashboard/apps"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"
          title="Marketing Agent"
        >
          <Sparkles className="h-5 w-5" />
        </Link>

        <div className="flex flex-col items-center gap-2">
          {apps.map((app) => {
            const isActive = app.id === selectedAppId;
            return (
              <div key={app.id} className="group relative flex w-full justify-center">
                <span
                  className={cn(
                    "absolute left-0 h-6 w-[3px] rounded-r-full bg-primary transition-opacity",
                    isActive ? "opacity-100" : "opacity-0"
                  )}
                />
                <Link
                  href={`/dashboard/apps/${app.id}/overview`}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg text-xs font-semibold transition-colors",
                    isActive
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
                  )}
                >
                  {getInitials(app)}
                </Link>
                <RailTooltip label={app.name || app.source_url} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="group relative flex w-full justify-center">
        <Link
          href="/dashboard/settings"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground"
        >
          <Settings className="h-5 w-5" />
        </Link>
        <RailTooltip label="Settings" />
      </div>
    </aside>
  );
}
