"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GaDailySessions } from "@/lib/demoData/googleAnalyticsDemoData";

// Same recharts styling conventions as components/dashboard/WeeklyActivityChart.tsx.
export function GaSessionsChart({ data }: { data: GaDailySessions[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
          width={40}
        />
        <Tooltip
          cursor={{ stroke: "var(--color-muted-foreground)", strokeDasharray: "4 4" }}
          contentStyle={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
          }}
        />
        <Line
          type="monotone"
          dataKey="sessions"
          name="Sessions"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--chart-1)" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
