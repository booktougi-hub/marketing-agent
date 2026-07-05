"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { AppStatus } from "@/types";
import { NAV_ITEMS, useDashboardApp } from "@/components/dashboard/AppContext";

const STATUS_LABELS: Record<AppStatus, string> = {
  pending: "Pending",
  extracting: "Extracting app DNA...",
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
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4">
      <div className="flex min-w-0 items-center gap-3">
        {selectedApp ? (
          <>
            <p className="truncate text-sm font-semibold">
              {selectedApp.name || selectedApp.source_url}
            </p>
            <Badge
              variant={selectedApp.status === "error" ? "destructive" : "secondary"}
            >
              {STATUS_LABELS[selectedApp.status]}
            </Badge>
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

      <div className="flex shrink-0 items-center gap-3">
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
