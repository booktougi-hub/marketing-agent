"use client";

import { BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PLATFORM_COLOR_VAR, PLATFORM_LABEL } from "@/lib/platform";
import type { ChannelIdentity } from "@/lib/dummy-data/platform-detail";
import type { ContentPlatform } from "@/types";

// Identity strip at the top of the My Channel tab — avatar, handle, and
// connection status, or a connect prompt if not connected. Both states are
// built now even though only the connected state has dummy data to show
// for most platforms (see lib/dummy-data/platform-detail.ts).
export function PlatformChannelIdentity({
  platform,
  identity,
}: {
  platform: ContentPlatform;
  identity: ChannelIdentity;
}) {
  const accentColor = PLATFORM_COLOR_VAR[platform];

  if (!identity.connected) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
              style={{
                backgroundColor: `color-mix(in oklch, ${accentColor} 14%, transparent)`,
                color: accentColor,
              }}
            >
              {identity.avatarInitials}
            </div>
            <p className="text-sm text-muted-foreground">
              Connect your {PLATFORM_LABEL[platform]} account to see your channel&apos;s real
              performance here.
            </p>
          </div>
          <Button type="button" size="sm">
            Connect {PLATFORM_LABEL[platform]}
          </Button>
          {/* TODO: wire to the real OAuth connect flow for this platform
              (same shape as the existing Twitter/LinkedIn
              platform_credentials pattern) once it exists. */}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3">
          {identity.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={identity.avatarUrl}
              alt={identity.handle}
              className="size-10 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
              style={{
                backgroundColor: `color-mix(in oklch, ${accentColor} 14%, transparent)`,
                color: accentColor,
              }}
            >
              {identity.avatarInitials}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{identity.handle}</span>
            <Badge
              variant="outline"
              className="w-fit gap-1 border-transparent font-medium"
              style={{
                backgroundColor: "color-mix(in oklch, var(--chart-2) 16%, transparent)",
                color: "var(--chart-2)",
              }}
            >
              <BadgeCheck className="size-3" />
              Connected
            </Badge>
          </div>
        </div>
        <button type="button" className="text-sm font-medium text-primary hover:underline">
          Manage connection
        </button>
        {/* TODO: link to the real connection-management screen (revoke/
            reconnect) for this platform once the OAuth connect flow
            exists. */}
      </CardContent>
    </Card>
  );
}
