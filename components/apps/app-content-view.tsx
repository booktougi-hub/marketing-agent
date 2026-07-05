"use client";

import { useMemo, useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { PLATFORM_COLOR_VAR, PLATFORM_LABEL } from "@/lib/platform";
import type { Content, ContentPlatform } from "@/types";

export interface ContentWithAnalytics extends Content {
  analytics: { impressions: number; clicks: number; likes: number } | null;
}

type DateRangeTab = "week" | "month" | "all";
type PlatformFilter = "all" | ContentPlatform;
type ContentSubTab = "planned" | "published";

const DATE_TABS: { value: DateRangeTab; label: string }[] = [
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
];

// Dev.to and every filterable platform except youtube, per spec — youtube
// isn't part of the V1 content pipeline yet.
const PLATFORM_FILTERS: { value: PlatformFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "twitter", label: "Twitter" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "devto", label: "Dev.to" },
];

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

function formatDateTime(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function PlatformBadge({ platform }: { platform: ContentPlatform }) {
  const colorVar = PLATFORM_COLOR_VAR[platform];
  return (
    <Badge
      variant="outline"
      className="border-transparent font-medium"
      style={{
        backgroundColor: `color-mix(in oklch, ${colorVar} 16%, transparent)`,
        color: colorVar,
      }}
    >
      {PLATFORM_LABEL[platform]}
    </Badge>
  );
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
  const [content, setContent] = useState(initialContent);
  const [dateTab, setDateTab] = useState<DateRangeTab>("week");
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [subTab, setSubTab] = useState<ContentSubTab>("planned");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const [deleteTarget, setDeleteTarget] = useState<ContentWithAnalytics | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function setRowError(id: string, message: string | null) {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

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

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
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
          onClick={() => setSubTab("planned")}
          className={cn(
            "-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
            subTab === "planned"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Planned ({planned.length})
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
          Published ({published.length})
        </button>
      </div>

      {subTab === "planned" ? (
        planned.length === 0 ? (
          <EmptyState message="No planned posts match these filters." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {planned.map((item) => (
              <Card key={item.id}>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <PlatformBadge platform={item.platform} />
                    {item.pillar && (
                      <span className="truncate text-xs text-muted-foreground">
                        {item.pillar}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(item.scheduled_at)}
                  </p>

                  {editingId === item.id ? (
                    <Textarea
                      value={editingBody}
                      onChange={(e) => setEditingBody(e.target.value)}
                      rows={4}
                      autoFocus
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm">{item.body}</p>
                  )}

                  {rowErrors[item.id] && (
                    <p className="text-xs text-destructive">{rowErrors[item.id]}</p>
                  )}

                  <div className="flex justify-end gap-2">
                    {editingId === item.id ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={cancelEdit}
                          disabled={savingId === item.id}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => saveEdit(item.id)}
                          disabled={
                            savingId === item.id || editingBody.trim().length === 0
                          }
                        >
                          {savingId === item.id && <Loader2 className="animate-spin" />}
                          Save
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => startEdit(item)}
                        >
                          <Pencil />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeleteTarget(item)}
                        >
                          <Trash2 />
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : published.length === 0 ? (
        <EmptyState message="No published posts match these filters." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {published.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <PlatformBadge platform={item.platform} />
                  {item.pillar && (
                    <span className="truncate text-xs text-muted-foreground">
                      {item.pillar}
                    </span>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  {formatDateTime(item.published_at)}
                </p>

                <p className="whitespace-pre-wrap text-sm">{item.body}</p>

                {item.analytics ? (
                  <div className="flex gap-4 border-t pt-3 text-xs text-muted-foreground">
                    <span>{item.analytics.impressions.toLocaleString()} impressions</span>
                    <span>{item.analytics.likes.toLocaleString()} likes</span>
                    <span>{item.analytics.clicks.toLocaleString()} clicks</span>
                  </div>
                ) : (
                  <p className="border-t pt-3 text-xs text-muted-foreground">
                    Fetching metrics...
                  </p>
                )}
              </CardContent>
            </Card>
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
              This scheduled post will be permanently removed from the queue.
              This can&apos;t be undone.
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
