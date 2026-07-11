// Next-run computation for the platform's fixed automations
// (trigger/weekly-research-scan.ts, trigger/weekly-research-reset.ts,
// trigger/monthly-competitor-scan.ts). These are simple fixed UTC crons,
// not user-configurable, so a small hand-rolled calculator is enough — no
// need for a cron-parsing dependency.

export interface WeeklyAutomation {
  id: string;
  label: string;
  description: string;
  dayOfWeekUTC: number; // 0 = Sunday ... 6 = Saturday
  hourUTC: number;
  minuteUTC: number;
}

// Keep in sync with the cron patterns in trigger/weekly-research-scan.ts
// ("0 23 * * 0") and trigger/weekly-research-reset.ts ("0 0 * * 1").
export const WEEKLY_AUTOMATIONS: WeeklyAutomation[] = [
  {
    id: "weekly-research-scan",
    label: "Research & Opportunities Scan",
    description:
      "Refreshes Topic Research, Problem Discovery, and Opportunities findings for active apps.",
    dayOfWeekUTC: 0,
    hourUTC: 23,
    minuteUTC: 0,
  },
  {
    id: "weekly-research-reset",
    label: "Manual Run Allowance Reset",
    description: "Resets your weekly \"Run Research Now\" allowance.",
    dayOfWeekUTC: 1,
    hourUTC: 0,
    minuteUTC: 0,
  },
];

export function getNextWeeklyOccurrence(
  automation: Pick<WeeklyAutomation, "dayOfWeekUTC" | "hourUTC" | "minuteUTC">,
  from: Date = new Date()
): Date {
  const next = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      automation.hourUTC,
      automation.minuteUTC,
      0,
      0
    )
  );
  const dayDiff = (automation.dayOfWeekUTC - from.getUTCDay() + 7) % 7;
  next.setUTCDate(next.getUTCDate() + dayDiff);
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 7);
  }
  return next;
}

export interface MonthlyAutomation {
  id: string;
  label: string;
  description: string;
  dayOfMonthUTC: number;
  hourUTC: number;
  minuteUTC: number;
}

// Keep in sync with the cron pattern in trigger/monthly-competitor-scan.ts
// ("0 23 1 * *"). Competitor Gap Analysis runs monthly, not weekly — see
// that file for why.
export const MONTHLY_AUTOMATIONS: MonthlyAutomation[] = [
  {
    id: "monthly-competitor-scan",
    label: "Competitor Gap Analysis",
    description: "Refreshes Competitor Gap findings for active apps.",
    dayOfMonthUTC: 1,
    hourUTC: 23,
    minuteUTC: 0,
  },
];

export function getNextMonthlyOccurrence(
  automation: Pick<MonthlyAutomation, "dayOfMonthUTC" | "hourUTC" | "minuteUTC">,
  from: Date = new Date()
): Date {
  const next = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      automation.dayOfMonthUTC,
      automation.hourUTC,
      automation.minuteUTC,
      0,
      0
    )
  );
  if (next.getTime() <= from.getTime()) {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}
