"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ContentPlatform } from "@/types";
import { PLATFORM_COLOR_VAR, PLATFORM_LABEL, PLATFORM_ORDER } from "@/lib/platform";

export interface WeeklyActivityDatum {
  day: string;
  [platform: string]: string | number;
}

export function WeeklyActivityChart({
  data,
  platforms,
}: {
  data: WeeklyActivityDatum[];
  platforms: ContentPlatform[];
}) {
  if (platforms.length === 0) {
    return (
      <div className="flex h-[280px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
        <p className="text-sm text-muted-foreground">
          Posts will appear here as they publish
        </p>
      </div>
    );
  }

  const orderedPlatforms = PLATFORM_ORDER.filter((platform) =>
    platforms.includes(platform)
  );

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} barCategoryGap={16} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="day"
          axisLine={{ stroke: "var(--color-muted-foreground)" }}
          tickLine={false}
          tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
          width={28}
        />
        <Tooltip
          cursor={{ fill: "var(--color-muted)" }}
          contentStyle={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
          }}
        />
        {orderedPlatforms.length > 1 && (
          <Legend
            formatter={(value) => (
              <span style={{ color: "var(--color-muted-foreground)" }}>{value}</span>
            )}
          />
        )}
        {orderedPlatforms.map((platform, index) => (
          <Bar
            key={platform}
            dataKey={platform}
            name={PLATFORM_LABEL[platform]}
            stackId="posts"
            fill={PLATFORM_COLOR_VAR[platform]}
            maxBarSize={24}
            radius={index === orderedPlatforms.length - 1 ? [4, 4, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
