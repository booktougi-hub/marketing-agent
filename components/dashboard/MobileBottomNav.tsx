"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, LayoutGrid, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboardApp } from "@/components/dashboard/AppContext";

export function MobileBottomNav() {
  const pathname = usePathname();
  const { selectedAppId, activeSection } = useDashboardApp();

  const items = [
    {
      key: "dashboard",
      label: "Dashboard",
      href: "/dashboard/apps",
      icon: LayoutDashboard,
      isActive: pathname === "/dashboard/apps",
    },
    {
      key: "services",
      label: "Services",
      href: selectedAppId ? `/dashboard/apps/${selectedAppId}/services` : "/dashboard/apps",
      icon: LayoutGrid,
      isActive: activeSection === "services",
    },
    {
      key: "settings",
      label: "Settings",
      href: selectedAppId ? `/dashboard/apps/${selectedAppId}/settings` : "/dashboard/settings",
      icon: Settings,
      isActive: activeSection === "settings" || pathname === "/dashboard/settings",
    },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch justify-around border-t bg-sidebar md:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            className="relative flex flex-1 flex-col items-center justify-center gap-0.5 text-muted-foreground"
          >
            <span
              className={cn(
                "absolute top-0 h-0.5 w-8 rounded-full bg-primary transition-opacity",
                item.isActive ? "opacity-100" : "opacity-0"
              )}
            />
            <Icon
              className={cn("h-5 w-5", item.isActive && "text-primary")}
            />
            <span
              className={cn(
                "font-mono text-[10px] uppercase tracking-wide",
                item.isActive && "text-primary"
              )}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
