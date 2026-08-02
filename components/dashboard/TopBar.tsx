"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { AppStatus } from "@/types";
import { NAV_ITEMS, useDashboardApp } from "@/components/dashboard/AppContext";
import { AppSwitcher } from "@/components/dashboard/AppSwitcher";
import { AppIcon } from "@/components/apps/app-icon";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";

const STATUS_LABELS: Record<AppStatus, string> = {
  pending: "Pending",
  extracting: "Extracting app DNA...",
  competitor_research_pending: "Researching competitors...",
  diagnosis_pending: "Diagnosing growth bottleneck...",
  diagnosis_ready: "Diagnosis ready for review",
  strategy_pending: "Generating marketing strategy...",
  awaiting_approval: "Awaiting your approval",
  active: "Active",
  paused: "Paused",
  error: "Error",
  deleted: "Deleted",
};

export function TopBar({ userEmail }: { userEmail: string | null }) {
  const router = useRouter();
  const { selectedApp, activeSection } = useDashboardApp();

  const sectionLabel = NAV_ITEMS.find((item) => item.section === activeSection)?.label;

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-card px-4">
      <div className="hidden min-w-0 items-center gap-3 md:flex">
        {selectedApp ? (
          <>
            <Link
              href={`/dashboard/apps/${selectedApp.id}/content`}
              className="flex min-w-0 items-center gap-2 rounded-md hover:opacity-80"
            >
              <AppIcon
                name={selectedApp.name || selectedApp.source_url}
                iconUrl={selectedApp.icon_url}
                className="h-6 w-6 text-[10px]"
              />
              <p className="truncate text-sm font-semibold">
                {selectedApp.name || selectedApp.source_url}
              </p>
              <Badge
                variant={selectedApp.status === "error" ? "destructive" : "secondary"}
              >
                {STATUS_LABELS[selectedApp.status]}
              </Badge>
            </Link>
            {sectionLabel && (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="truncate text-sm text-muted-foreground">
                  {sectionLabel}
                </span>
              </>
            )}
          </>
        ) : (
          <p className="truncate text-sm font-semibold text-muted-foreground">
            Select an app
          </p>
        )}
      </div>

      <div className="min-w-0 flex-1 md:hidden">
        <AppSwitcher id="app-switcher-mobile" />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle />
        <Avatar size="sm">
          <AvatarFallback>{userEmail?.slice(0, 2).toUpperCase() ?? "?"}</AvatarFallback>
        </Avatar>
        <Button type="button" variant="ghost" size="icon" aria-label="Sign out" onClick={handleSignOut}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
