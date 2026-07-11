"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppIdentitySection } from "@/components/apps/app-identity-section";
import { PublishingScheduleSection } from "@/components/apps/publishing-schedule-section";
import { ResearchScheduleSection } from "@/components/apps/research-schedule-section";
import { ConnectedPlatformsSection } from "@/components/apps/connected-platforms-section";
import { DangerZoneSection } from "@/components/apps/danger-zone-section";
import { cn } from "@/lib/utils";
import type { PublishingScheduleSettings } from "@/lib/app-settings";
import type { AppStatus, ContentPlatform, PlanTier, ProductType } from "@/types";

interface SettingsSection {
  id: string;
  label: string;
  description: string;
  danger?: boolean;
}

const SECTIONS: SettingsSection[] = [
  {
    id: "app-identity",
    label: "App Identity",
    description: "Update how this app is identified across your dashboard.",
  },
  {
    id: "publishing-schedule",
    label: "Publishing Schedule",
    description: "Control when and how often new content gets published.",
  },
  {
    id: "research-schedule",
    label: "Research Schedule",
    description: "Configure how often the research agent scans for new opportunities.",
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Choose which updates you want to be notified about.",
  },
  {
    id: "connected-platforms",
    label: "Connected Platforms",
    description: "Manage the social accounts this app publishes to.",
  },
  {
    id: "danger-zone",
    label: "Danger Zone",
    description: "Irreversible actions that affect this app.",
    danger: true,
  },
];

// Sticky positioning and IntersectionObserver both need the actual scrolling
// ancestor, which here is DashboardShell's <main overflow-y-auto>, not
// window — so we find it at runtime instead of assuming a fixed DOM shape.
function getScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY)) return el;
    el = el.parentElement;
  }
  return null;
}

export function AppSettingsView({
  appId,
  appName,
  sourceUrl,
  productType,
  additionalContext,
  urlChangedAt,
  planTier,
  reanalysisCreditsUsed,
  reanalysisCreditsResetAt,
  publishingSchedule,
  devtoConnected,
  isPaused,
  appStatus,
  nextScheduledContent,
}: {
  appId: string;
  appName: string | null;
  sourceUrl: string;
  productType: ProductType;
  additionalContext: string | null;
  urlChangedAt: string | null;
  planTier: PlanTier;
  reanalysisCreditsUsed: number;
  reanalysisCreditsResetAt: string | null;
  publishingSchedule: PublishingScheduleSettings;
  devtoConnected: boolean;
  isPaused: boolean;
  appStatus: AppStatus;
  nextScheduledContent: { scheduledAt: string; platform: ContentPlatform } | null;
}) {
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  const navRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    const root = getScrollParent(navRef.current);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b
        );
        const id = topMost.target.getAttribute("data-section-id");
        if (id) setActiveSection(id);
      },
      { root, rootMargin: "-10% 0px -70% 0px", threshold: [0, 1] }
    );

    sectionRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  function handleNavClick(id: string) {
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{appName || sourceUrl}</h1>
        <p className="text-sm text-muted-foreground">{sourceUrl}</p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav ref={navRef} className="flex flex-col gap-1 lg:sticky lg:top-6 lg:w-56 lg:shrink-0">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => handleNavClick(section.id)}
              className={cn(
                "rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors",
                activeSection === section.id
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-secondary-foreground"
              )}
            >
              {section.label}
            </button>
          ))}
        </nav>

        <div className="flex flex-1 flex-col gap-6">
          {SECTIONS.map((section) => (
            <div
              key={section.id}
              data-section-id={section.id}
              ref={(el) => {
                if (el) sectionRefs.current.set(section.id, el);
                else sectionRefs.current.delete(section.id);
              }}
              className="scroll-mt-6"
            >
              {section.id === "app-identity" ? (
                <AppIdentitySection
                  appId={appId}
                  initialName={appName}
                  sourceUrl={sourceUrl}
                  initialProductType={productType}
                  initialAdditionalContext={additionalContext}
                  urlChangedAt={urlChangedAt}
                  planTier={planTier}
                  reanalysisCreditsUsed={reanalysisCreditsUsed}
                  reanalysisCreditsResetAt={reanalysisCreditsResetAt}
                />
              ) : section.id === "publishing-schedule" ? (
                <PublishingScheduleSection appId={appId} initialSchedule={publishingSchedule} />
              ) : section.id === "research-schedule" ? (
                <ResearchScheduleSection
                  appStatus={appStatus}
                  nextScheduledContent={nextScheduledContent}
                />
              ) : section.id === "connected-platforms" ? (
                <ConnectedPlatformsSection appId={appId} initialDevtoConnected={devtoConnected} />
              ) : section.id === "danger-zone" ? (
                <DangerZoneSection
                  appId={appId}
                  appName={appName}
                  sourceUrl={sourceUrl}
                  initialIsPaused={isPaused}
                />
              ) : (
                <Card className={cn(section.danger && "border-destructive")}>
                  <CardHeader>
                    <CardTitle className={cn(section.danger && "text-destructive")}>
                      {section.label}
                    </CardTitle>
                    <CardDescription>{section.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                      Settings for this section are coming soon.
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        disabled
                        variant={section.danger ? "destructive" : "default"}
                      >
                        Save Changes
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
