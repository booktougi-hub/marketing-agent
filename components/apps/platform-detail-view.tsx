"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PlatformMyChannelTab } from "@/components/apps/platform-my-channel-tab";
import { PlatformTopInfluencersTab } from "@/components/apps/platform-top-influencers-tab";
import { PlatformBrandBadge } from "@/components/apps/platform-brand-badge";
import { getPlatformDetailDummyData } from "@/lib/dummy-data/platform-detail";
import type { ContentPlatform } from "@/types";

type PlatformDetailTab = "my_channel" | "top_influencers";

// New center-panel content for the Social Content sidebar shortcuts
// (YouTube/Instagram/Facebook) — replaces the old Drafts/Planned/Published
// content list for these platforms specifically. Structured to read
// generically off `platform` + lib/dummy-data/platform-detail.ts, so adding
// another platform later (if that's ever decided) is just adding a new
// entry to that data file, not new component architecture.
export function PlatformDetailView({ platform }: { platform: ContentPlatform }) {
  // TODO: default to "my_channel" if a real connection exists and has
  // synced data; default to "top_influencers" otherwise. For this UI-only
  // pass, always default to "My Channel" and show the connected dummy
  // state — wire the actual conditional once connection status is real
  // (see components/apps/platform-channel-identity.tsx's `connected` flag).
  const [tab, setTab] = useState<PlatformDetailTab>("my_channel");

  const data = getPlatformDetailDummyData(platform);

  if (!data) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No detail view is configured for this platform yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PlatformBrandBadge platform={platform} />

      {/* Same underline-active-state tab pattern as the Drafts/Planned/
          Published tabs this replaces (components/apps/app-content-view.tsx). */}
      <div className="flex gap-6 border-b">
        <button
          type="button"
          onClick={() => setTab("my_channel")}
          className={cn(
            "-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
            tab === "my_channel"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          My Channel
        </button>
        <button
          type="button"
          onClick={() => setTab("top_influencers")}
          className={cn(
            "-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
            tab === "top_influencers"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Top Influencers
        </button>
      </div>

      {tab === "my_channel" ? (
        <PlatformMyChannelTab platform={platform} data={data} />
      ) : (
        <PlatformTopInfluencersTab platform={platform} candidates={data.influencerCandidates} />
      )}
    </div>
  );
}
