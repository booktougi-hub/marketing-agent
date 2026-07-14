// Next-run computation for the platform's fixed automations
// (trigger/weekly-research-scan.ts, trigger/weekly-research-reset.ts,
// trigger/monthly-competitor-scan.ts). These are simple fixed UTC crons,
// not user-configurable, so a small hand-rolled calculator is enough — no
// need for a cron-parsing dependency.

import { RESEARCH_DAYS, type ResearchDay } from "@/types";

// weekly-research-scan.ts's cadence per app IS user-configurable
// (preferred_research_day/preferred_research_hour, both stored in UTC) —
// these helpers compute/convert that one occurrence, separate from the
// fixed WEEKLY_AUTOMATIONS below.

const DAY_INDEX: Record<ResearchDay, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function getNextResearchOccurrence(
  day: ResearchDay,
  hourUTC: number,
  from: Date = new Date()
): Date {
  const next = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hourUTC, 0, 0, 0)
  );
  const dayDiff = (DAY_INDEX[day] - from.getUTCDay() + 7) % 7;
  next.setUTCDate(next.getUTCDate() + dayDiff);
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 7);
  }
  return next;
}

// Client-only (uses the browser's local Date methods) — converts a
// UTC day+hour preference into the equivalent day+hour in the browser's
// local timezone, for display. Resolves via the *next real occurrence*
// rather than a flat hour offset, so an offset that crosses midnight
// correctly shifts the day too (e.g. UTC Sunday 23:00 is already Monday
// morning in India).
export function researchDayHourUtcToLocal(
  day: ResearchDay,
  hourUTC: number,
  from: Date = new Date()
): { day: ResearchDay; hour: number } {
  const occurrence = getNextResearchOccurrence(day, hourUTC, from);
  return { day: RESEARCH_DAYS[occurrence.getDay()], hour: occurrence.getHours() };
}

// The inverse — given a day+hour the user picked in their own local
// timezone, returns the UTC day+hour to actually save.
export function researchDayHourLocalToUtc(
  day: ResearchDay,
  hourLocal: number,
  from: Date = new Date()
): { day: ResearchDay; hour: number } {
  const localIndex = DAY_INDEX[day];
  const ref = new Date(from);
  ref.setHours(hourLocal, 0, 0, 0);
  const dayDiff = (localIndex - from.getDay() + 7) % 7;
  ref.setDate(ref.getDate() + dayDiff);
  if (ref.getTime() <= from.getTime()) {
    ref.setDate(ref.getDate() + 7);
  }
  return { day: RESEARCH_DAYS[ref.getUTCDay()], hour: ref.getUTCHours() };
}

export interface WeeklyAutomation {
  id: string;
  label: string;
  description: string;
  dayOfWeekUTC: number; // 0 = Sunday ... 6 = Saturday
  hourUTC: number;
  minuteUTC: number;
}

// Keep in sync with the cron pattern in trigger/weekly-research-reset.ts
// ("0 0 * * 1"). trigger/weekly-research-scan.ts no longer has a single
// fixed time to list here — each app now has its own
// preferred_research_day/preferred_research_hour (see
// getNextResearchOccurrence above), since Settings lets each app pick when
// its weekly scan runs.
export const WEEKLY_AUTOMATIONS: WeeklyAutomation[] = [
  {
    id: "weekly-research-reset",
    label: "Agent Action Credits Reset",
    description: "Resets your weekly Agent Action Credit allowance.",
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
