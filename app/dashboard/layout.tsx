"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AppWindow, LogOut, Menu, Settings, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard/apps", label: "Apps", icon: AppWindow },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b bg-card px-4 py-3 md:hidden">
        <span className="font-heading text-base font-semibold">
          Marketing Agent
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
          onClick={() => setMobileNavOpen((open) => !open)}
        >
          {mobileNavOpen ? <X /> : <Menu />}
        </Button>
      </div>

      {/* Sidebar */}
      <aside
        className={cn(
          "flex-col justify-between border-r bg-card md:flex md:h-screen md:w-[240px] md:shrink-0 md:sticky md:top-0",
          mobileNavOpen ? "flex" : "hidden"
        )}
      >
        <div className="flex flex-col gap-4 p-4">
          <span className="hidden font-heading text-base font-semibold md:block">
            Marketing Agent
          </span>

          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileNavOpen(false)}
                  className={cn(
                    buttonVariants({
                      variant: isActive ? "secondary" : "ghost",
                    }),
                    "justify-start"
                  )}
                >
                  <Icon />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <Separator />
          <p className="truncate text-sm text-muted-foreground">
            {email ?? "Loading..."}
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start"
            onClick={handleSignOut}
          >
            <LogOut />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
