"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Every "app icon" spot in the dashboard (switcher, strategy header, app
// list cards) renders this instead of hand-rolling its own letter avatar —
// shows the real favicon/logo resolved during DNA extraction
// (apps.icon_url, see trigger/dna-extraction.ts) when there is one, and
// falls back to a first-letter avatar otherwise. The onError handler covers
// the case where a previously-good icon URL stops loading later (site
// changed its favicon, took the file down, etc.), not just a missing URL.
export function AppIcon({
  name,
  iconUrl,
  className,
}: {
  name: string;
  iconUrl?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (iconUrl && !failed) {
    return (
      // Arbitrary third-party domains — next/image would need every one allowlisted.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl}
        alt=""
        className={cn("shrink-0 rounded-lg object-contain bg-white", className)}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white",
        className
      )}
      style={{ background: "linear-gradient(135deg, var(--chart-1), var(--chart-5))" }}
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}
