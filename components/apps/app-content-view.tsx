"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Loader2, Rows3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { Content, ContentPlatform } from "@/types";
import { ContentCalendarView } from "@/components/apps/content-calendar-view";
import {
  DraftPostCard,
  PlannedPostCard,
  PublishedPostCard,
} from "@/components/apps/content-post-card";

export interface ContentWithAnalytics extends Content {
  analytics: { impressions: number; clicks: number; likes: number } | null;
}

type DateRangeTab = "week" | "month" | "all";
type PlatformFilter = "all" | ContentPlatform;
type ContentSubTab = "drafts" | "planned" | "published";
type ViewMode = "list" | "calendar";

const VALID_SUB_TABS = new Set<string>(["drafts", "planned", "published"]);

const DATE_TABS: { value: DateRangeTab; label: string }[] = [
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
];

const PLATFORM_FILTERS: { value: PlatformFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "twitter", label: "Twitter" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "devto", label: "Dev.to" },
  { value: "youtube", label: "YouTube" },
];

const VALID_PLATFORM_FILTERS = new Set<string>(PLATFORM_FILTERS.map((f) => f.value));

const DAY_MS = 24 * 60 * 60 * 1000;

// Planned dates are in the future ("this week" = the next 7 days); published
// dates are in the past ("this week" = the last 7 days) — same tab, opposite
// direction depending which list it's scoping.
function withinRange(
  dateStr: string | null,
  tab: DateRangeTab,
  direction: "past" | "future"
) {
  if (tab === "all") return true;
  if (!dateStr) return false;
  const date = new Date(dateStr).getTime();
  const now = Date.now();
  const windowMs = (tab === "week" ? 7 : 30) * DAY_MS;
  return direction === "future" ? date <= now + windowMs : date >= now - windowMs;
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

export function AppContentView({
  appId,
  initialContent,
}: {
  appId: string;
  initialContent: ContentWithAnalytics[];
}) {
  const searchParams = useSearchParams();
  const platformParam = searchParams.get("platform");
  const initialPlatformFilter: PlatformFilter =
    platformParam && VALID_PLATFORM_FILTERS.has(platformParam)
      ? (platformParam as PlatformFilter)
      : "all";
  const tabParam = searchParams.get("tab");
  const initialSubTab: ContentSubTab =
    tabParam && VALID_SUB_TABS.has(tabParam) ? (tabParam as ContentSubTab) : "planned";

  const [content, setContent] = useState(initialContent);
  // Arriving via a platform-specific sidebar link (e.g. YouTube) should show
  // that platform's content regardless of when it's scheduled, not just
  // what falls in the default "This Week" window.
  const [dateTab, setDateTab] = useState<DateRangeTab>(
    initialPlatformFilter === "all" ? "week" : "all"
  );
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>(initialPlatformFilter);
  const [subTab, setSubTab] = useState<ContentSubTab>(initialSubTab);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const [deleteTarget, setDeleteTarget] = useState<ContentWithAnalytics | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // content-generation runs in the background after approval — this page
  // (and initialContent) can render before that job finishes, so without a
  // subscription the newly-generated posts never show up until a manual
  // reload. Mirrors the INSERT-subscription pattern already used for
  // research findings in components/apps/app-research-view.tsx.
  useEffect(() => {
    const channel = supabase
      .channel(`app-content-${appId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "content",
          filter: `app_id=eq.${appId}`,
        },
        (payload) => {
          const row = payload.new as Content;
          setContent((prev) =>
            prev.some((c) => c.id === row.id) ? prev : [...prev, { ...row, analytics: null }]
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [appId]);

  function setRowError(id: string, message: string | null) {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  const drafts = useMemo(() => {
    return content
      .filter((item) => item.status === "draft")
      .filter((item) => platformFilter === "all" || item.platform === platformFilter)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [content, platformFilter]);

  const planned = useMemo(() => {
    return content
      .filter((item) => item.status === "scheduled")
      .filter((item) => platformFilter === "all" || item.platform === platformFilter)
      .filter((item) => withinRange(item.scheduled_at, dateTab, "future"))
      .sort((a, b) => {
        const aTime = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const bTime = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        return aTime - bTime;
      });
  }, [content, platformFilter, dateTab]);

  const published = useMemo(() => {
    return content
      .filter((item) => item.status === "published")
      .filter((item) => platformFilter === "all" || item.platform === platformFilter)
      .filter((item) => withinRange(item.published_at, dateTab, "past"))
      .sort((a, b) => {
        const aTime = a.published_at ? new Date(a.published_at).getTime() : 0;
        const bTime = b.published_at ? new Date(b.published_at).getTime() : 0;
        return bTime - aTime;
      });
  }, [content, platformFilter, dateTab]);

  // Calendar view navigates by month on its own, so it ignores the
  // week/month/all-time tab and only applies the platform + status filters.
  const calendarPlanned = useMemo(() => {
    return content
      .filter((item) => item.status === "scheduled")
      .filter((item) => platformFilter === "all" || item.platform === platformFilter);
  }, [content, platformFilter]);

  const calendarPublished = useMemo(() => {
    return content
      .filter((item) => item.status === "published")
      .filter((item) => platformFilter === "all" || item.platform === platformFilter);
  }, [content, platformFilter]);

  function startEdit(item: ContentWithAnalytics) {
    setEditingId(item.id);
    setEditingBody(item.body);
    setRowError(item.id, null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingBody("");
  }

  async function saveEdit(contentId: string) {
    setSavingId(contentId);
    setRowError(contentId, null);
    try {
      const res = await fetch(`/api/apps/${appId}/content/${contentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: editingBody }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setRowError(contentId, json?.error ?? "Failed to save changes.");
        return;
      }
      setContent((prev) =>
        prev.map((item) =>
          item.id === contentId ? { ...item, body: editingBody } : item
        )
      );
      setEditingId(null);
    } catch {
      setRowError(contentId, "Failed to save changes.");
    } finally {
      setSavingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const contentId = deleteTarget.id;
    setDeletingId(contentId);
    try {
      const res = await fetch(`/api/apps/${appId}/content/${contentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setRowError(contentId, json?.error ?? "Failed to delete post.");
        setDeleteTarget(null);
        return;
      }
      setContent((prev) => prev.filter((item) => item.id !== contentId));
      setDeleteTarget(null);
    } catch {
      setRowError(contentId, "Failed to delete post.");
      setDeleteTarget(null);
    } finally {
      setDeletingId(null);
    }
  }

  const editProps = {
    editingId,
    editingBody,
    onEditingBodyChange: setEditingBody,
    savingId,
    rowErrors,
    onStartEdit: startEdit,
    onCancelEdit: cancelEdit,
    onSave: saveEdit,
    onDelete: (item: ContentWithAnalytics) => setDeleteTarget(item),
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {viewMode === "list" && subTab !== "drafts" && (
            <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
              {DATE_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setDateTab(tab.value)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    dateTab === tab.value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {subTab !== "drafts" && (
            <div className="ml-auto flex w-fit gap-1 rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                aria-label="List view"
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  viewMode === "list"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Rows3 className="size-4" />
                <span className="hidden sm:inline">List</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("calendar")}
                aria-label="Calendar view"
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  viewMode === "calendar"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <CalendarDays className="size-4" />
                <span className="hidden sm:inline">Calendar</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {PLATFORM_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setPlatformFilter(filter.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                platformFilter === filter.value
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-6 border-b">
        <button
          type="button"
          onClick={() => setSubTab("drafts")}
          className={cn(
            "-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
            subTab === "drafts"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Drafts ({drafts.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab("planned")}
          className={cn(
            "-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
            subTab === "planned"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Planned ({viewMode === "calendar" ? calendarPlanned.length : planned.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab("published")}
          className={cn(
            "-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
            subTab === "published"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Published ({viewMode === "calendar" ? calendarPublished.length : published.length})
        </button>
      </div>

      {subTab === "drafts" ? (
        drafts.length === 0 ? (
          <EmptyState message="No drafts yet. Create one from a Research finding — Topics, Problems, or Competitors — or wait for the next research scan." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {drafts.map((item) => (
              <DraftPostCard
                key={item.id}
                appId={appId}
                item={item}
                isEditing={editingId === item.id}
                editingBody={editingBody}
                onEditingBodyChange={setEditingBody}
                saving={savingId === item.id}
                error={rowErrors[item.id] ?? null}
                onStartEdit={() => startEdit(item)}
                onCancelEdit={cancelEdit}
                onSave={() => saveEdit(item.id)}
                onDelete={() => setDeleteTarget(item)}
              />
            ))}
          </div>
        )
      ) : viewMode === "calendar" ? (
        (subTab === "planned" ? calendarPlanned : calendarPublished).length === 0 ? (
          <EmptyState
            message={`No ${subTab} posts match these filters.`}
          />
        ) : (
          <ContentCalendarView
            appId={appId}
            items={subTab === "planned" ? calendarPlanned : calendarPublished}
            dateField={subTab === "planned" ? "scheduled_at" : "published_at"}
            editProps={subTab === "planned" ? editProps : null}
          />
        )
      ) : subTab === "planned" ? (
        planned.length === 0 ? (
          <EmptyState message="No planned posts match these filters." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {planned.map((item) => (
              <PlannedPostCard
                key={item.id}
                appId={appId}
                item={item}
                isEditing={editingId === item.id}
                editingBody={editingBody}
                onEditingBodyChange={setEditingBody}
                saving={savingId === item.id}
                error={rowErrors[item.id] ?? null}
                onStartEdit={() => startEdit(item)}
                onCancelEdit={cancelEdit}
                onSave={() => saveEdit(item.id)}
                onDelete={() => setDeleteTarget(item)}
              />
            ))}
          </div>
        )
      ) : published.length === 0 ? (
        <EmptyState message="No published posts match these filters." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {published.map((item) => (
            <PublishedPostCard key={item.id} item={item} />
          ))}
        </div>
      )}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this post?</DialogTitle>
            <DialogDescription>
              This {deleteTarget?.status === "draft" ? "draft" : "scheduled post"} will be
              permanently removed. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deletingId !== null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={deletingId !== null}
            >
              {deletingId !== null && <Loader2 className="animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
