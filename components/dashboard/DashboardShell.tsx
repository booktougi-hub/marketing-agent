"use client";

import { AppSidebar } from "@/components/dashboard/AppSidebar";
import { MobileBottomNav } from "@/components/dashboard/MobileBottomNav";
import { TopBar } from "@/components/dashboard/TopBar";

export function DashboardShell({
  userEmail,
  children,
}: {
  userEmail: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar userEmail={userEmail} />
        <main className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">{children}</main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
