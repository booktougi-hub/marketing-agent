"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, useDashboardApp } from "@/components/dashboard/AppContext";

export function AppSidebar() {
  const { selectedApp, activeSection, sidebarCollapsed, setSidebarCollapsed } =
    useDashboardApp();

  if (!selectedApp) {
    return null;
  }

  if (sidebarCollapsed) {
    return (
      <aside className="flex h-screen w-8 shrink-0 flex-col items-center border-r bg-card py-3 transition-all duration-200">
        <button
          type="button"
          aria-label="Expand app sidebar"
          onClick={() => setSidebarCollapsed(false)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-screen w-[220px] shrink-0 flex-col border-r bg-card transition-all duration-200">
      <div className="flex items-start justify-between gap-2 border-b p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {selectedApp.name || "Unnamed app"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {selectedApp.source_url}
          </p>
        </div>
        <button
          type="button"
          aria-label="Collapse app sidebar"
          onClick={() => setSidebarCollapsed(true)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex flex-col gap-1 p-2">
        {NAV_ITEMS.map((item) => {
          const isActive = item.section === activeSection;
          const Icon = item.icon;
          return (
            <Link
              key={item.section}
              href={item.href(selectedApp.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-secondary-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
