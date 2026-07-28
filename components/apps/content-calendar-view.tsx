"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { stripMarkdownSyntax } from "@/lib/markdown";
import { PLATFORM_COLOR_VAR } from "@/lib/platform";
import type { ContentWithAnalytics } from "@/components/apps/app-content-view";
import { PlannedPostCard, PublishedPostCard } from "@/components/apps/content-post-card";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// A month calendar is always shown as a fixed 6-week (42-day) grid so the
// layout never reflows as the user navigates between shorter/longer months.
function startOfGrid(date: Date) {
  const first = startOfMonth(date);
  const grid = new Date(first);
  grid.setDate(first.getDate() - first.getDay());
  return grid;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

interface PlannedEditProps {
  editingId: string | null;
  editingBody: string;
  onEditingBodyChange: (value: string) => void;
  editingDate: string;
  editingTime: string;
  onEditingDateChange: (value: string) => void;
  onEditingTimeChange: (value: string) => void;
  savingId: string | null;
  rowErrors: Record<string, string>;
  onStartEdit: (item: ContentWithAnalytics) => void;
  onCancelEdit: () => void;
  onSave: (id: string) => void;
  onDelete: (item: ContentWithAnalytics) => void;
}

export function ContentCalendarView({
  appId,
  items,
  dateField,
  editProps,
}: {
  appId: string;
  items: ContentWithAnalytics[];
  dateField: "scheduled_at" | "published_at";
  // Only present for the planned tab — published posts render read-only.
  editProps: PlannedEditProps | null;
}) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const days = useMemo(() => {
    const gridStart = startOfGrid(month);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [month]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, ContentWithAnalytics[]>();
    for (const item of items) {
      const raw = dateField === "scheduled_at" ? item.scheduled_at : item.published_at;
      if (!raw) continue;
      const key = dayKey(new Date(raw));
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const aTime = new Date((dateField === "scheduled_at" ? a.scheduled_at : a.published_at)!).getTime();
        const bTime = new Date((dateField === "scheduled_at" ? b.scheduled_at : b.published_at)!).getTime();
        return aTime - bTime;
      });
    }
    return map;
  }, [items, dateField]);

  const today = new Date();
  const selectedItems = selectedDay ? itemsByDay.get(dayKey(selectedDay)) ?? [] : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            aria-label="Previous month"
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setMonth(startOfMonth(new Date()))}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            aria-label="Next month"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="bg-muted py-1.5 text-center text-[11px] font-medium text-muted-foreground sm:text-xs"
          >
            <span className="sm:hidden">{label[0]}</span>
            <span className="hidden sm:inline">{label}</span>
          </div>
        ))}

        {days.map((day) => {
          const inMonth = day.getMonth() === month.getMonth();
          const dayItems = itemsByDay.get(dayKey(day)) ?? [];
          const isToday = isSameDay(day, today);

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => setSelectedDay(day)}
              disabled={dayItems.length === 0}
              className={cn(
                "flex min-h-14 flex-col items-start gap-1 bg-card p-1 text-left transition-colors sm:min-h-24 sm:p-2",
                !inMonth && "bg-muted/40 text-muted-foreground",
                dayItems.length > 0 ? "cursor-pointer hover:bg-accent" : "cursor-default"
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px] sm:text-xs",
                  isToday && "bg-primary font-semibold text-primary-foreground"
                )}
              >
                {day.getDate()}
              </span>

              {/* Compact dots on mobile, labelled pills from sm up. */}
              {dayItems.length > 0 && (
                <div className="flex w-full flex-1 flex-col gap-0.5 overflow-hidden">
                  <div className="flex flex-wrap gap-0.5 sm:hidden">
                    {dayItems.slice(0, 4).map((it) => (
                      <span
                        key={it.id}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: PLATFORM_COLOR_VAR[it.platform] }}
                      />
                    ))}
                  </div>
                  {dayItems.slice(0, 2).map((it) => (
                    <span
                      key={it.id}
                      className="hidden truncate rounded px-1 py-0.5 text-[10px] font-medium sm:block"
                      style={{
                        backgroundColor: `color-mix(in oklch, ${PLATFORM_COLOR_VAR[it.platform]} 16%, transparent)`,
                        color: PLATFORM_COLOR_VAR[it.platform],
                      }}
                    >
                      {stripMarkdownSyntax(it.body).slice(0, 24)}
                    </span>
                  ))}
                  {dayItems.length > 2 && (
                    <span className="hidden text-[10px] text-muted-foreground sm:block">
                      +{dayItems.length - 2} more
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <Dialog
        open={selectedDay !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedDay(null);
        }}
      >
        {/* Sharper corners than the default dialog (rounded-xl) — matches
            the rounded-lg cards it holds instead of introducing a rounder,
            more-rounded frame around them. */}
        <DialogContent className="max-h-[80vh] max-w-full gap-0 overflow-y-auto rounded-lg p-0 sm:max-w-lg">
          <DialogHeader className="flex-row items-center gap-2.5 border-b p-4 pr-10">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarDays className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle>
                {selectedDay?.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {selectedItems.length} {selectedItems.length === 1 ? "post" : "posts"}
              </p>
            </div>
          </DialogHeader>
          <div className="flex flex-col gap-3 p-4">
            {selectedItems.map((item) =>
              editProps ? (
                <PlannedPostCard
                  key={item.id}
                  appId={appId}
                  item={item}
                  isEditing={editProps.editingId === item.id}
                  editingBody={editProps.editingBody}
                  onEditingBodyChange={editProps.onEditingBodyChange}
                  editingDate={editProps.editingDate}
                  editingTime={editProps.editingTime}
                  onEditingDateChange={editProps.onEditingDateChange}
                  onEditingTimeChange={editProps.onEditingTimeChange}
                  saving={editProps.savingId === item.id}
                  error={editProps.rowErrors[item.id] ?? null}
                  onStartEdit={() => editProps.onStartEdit(item)}
                  onCancelEdit={editProps.onCancelEdit}
                  onSave={() => editProps.onSave(item.id)}
                  onDelete={() => editProps.onDelete(item)}
                />
              ) : (
                <PublishedPostCard key={item.id} item={item} />
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
