"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PlatformChannelIdentity } from "@/components/apps/platform-channel-identity";
import type { PlatformDetailDummyData } from "@/lib/dummy-data/platform-detail";
import type { ContentPlatform } from "@/types";

const numberFormatter = new Intl.NumberFormat();

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tracking-tight">
          {typeof value === "number" ? numberFormatter.format(value) : value}
        </p>
      </CardContent>
    </Card>
  );
}

// Same pass/fail row pattern as the SEO/GEO "show all checks" breakdown
// (components/apps/seo-score-summary.tsx, geo-score-summary.tsx) — reused
// here rather than inventing a new checklist visual.
function ChannelChecklist({ items }: { items: PlatformDetailDummyData["checklist"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Channel checklist</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {items.map((item) => {
          const Icon = item.pass ? CheckCircle2 : XCircle;
          const color = item.pass ? "var(--chart-2)" : "var(--destructive)";
          return (
            <div key={item.label} className="flex items-center gap-2 border-t py-2 first:border-t-0">
              <Icon className="size-4 shrink-0" style={{ color }} />
              <span className="text-sm">{item.label}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ContentAngles({ angles }: { angles: PlatformDetailDummyData["contentAngles"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Suggested content angles</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {angles.map((angle) => (
          <div
            key={angle.title}
            className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium leading-snug">{angle.title}</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{angle.source}</span>
                <Badge
                  variant="outline"
                  className="border-transparent font-medium"
                  style={{
                    backgroundColor: "color-mix(in oklch, var(--chart-3) 16%, transparent)",
                    color: "var(--chart-3)",
                  }}
                >
                  {angle.multiplier}
                </Badge>
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button type="button" size="sm" variant="outline" disabled className="shrink-0" />
                }
              >
                Generate this
              </TooltipTrigger>
              <TooltipContent>Coming soon</TooltipContent>
            </Tooltip>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function PlatformMyChannelTab({
  platform,
  data,
}: {
  platform: ContentPlatform;
  data: PlatformDetailDummyData;
}) {
  const { channelIdentity, channelMetrics, checklist, contentAngles } = data;

  return (
    <div className="flex flex-col gap-4">
      <PlatformChannelIdentity platform={platform} identity={channelIdentity} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label={channelMetrics.viewsLabel} value={channelMetrics.views} />
        <MetricCard label="Engagement rate" value={channelMetrics.engagementRate} />
        <MetricCard label={channelMetrics.publishedLabel} value={channelMetrics.published} />
        <MetricCard label={channelMetrics.growthLabel} value={channelMetrics.growth} />
      </div>

      <ChannelChecklist items={checklist} />
      <ContentAngles angles={contentAngles} />
    </div>
  );
}
