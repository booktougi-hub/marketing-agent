"use client";

import Link from "next/link";
import { Calendar, Loader2, Pencil, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownContent } from "@/components/apps/markdown-content";
import { getMarkdownPreview } from "@/lib/markdown";
import { PLATFORM_COLOR_VAR, PLATFORM_LABEL } from "@/lib/platform";
import type { ContentPlatform } from "@/types";
import type { ContentWithAnalytics } from "@/components/apps/app-content-view";

export function formatDateTime(value: string | null) {
  if (!value) return null;
  // Locale pinned (not `undefined`) so server and client render identical
  // text — otherwise SSR uses the server's locale and the client re-renders
  // with the browser's, causing a hydration mismatch.
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// `<input type="date">`/`<input type="time">` work in the browser's local
// time (not UTC), so these convert to/from that local wall-clock
// representation — matching what formatDateTime already shows the user via
// toLocaleString, rather than exposing the underlying UTC-stored value.
export function toDateInputValue(value: string): string {
  const d = new Date(value);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function toTimeInputValue(value: string): string {
  const d = new Date(value);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mi}`;
}

export function combineDateAndTime(dateValue: string, timeValue: string): string {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
}

export function PlatformBadge({ platform }: { platform: ContentPlatform }) {
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

// Articles (content_type 'article', currently Dev.to) skip the inline
// plain-text edit entirely — a full split-view Markdown editor needs more
// room than a card allows, so "Edit" links out to a dedicated page instead.
// See app/dashboard/apps/[id]/content/[contentId]/edit/page.tsx.
function ArticlePreview({ body }: { body: string }) {
  return <MarkdownContent content={getMarkdownPreview(body)} />;
}

function ArticleEditLink({ appId, contentId }: { appId: string; contentId: string }) {
  // Button (Base UI) doesn't support an `asChild`/render-as-Link pattern, so
  // the button's own class variants are applied directly to a plain Link.
  return (
    <Link
      href={`/dashboard/apps/${appId}/content/${contentId}/edit`}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      <Pencil />
      Edit
    </Link>
  );
}

export function PlannedPostCard({
  appId,
  item,
  isEditing,
  editingBody,
  onEditingBodyChange,
  editingDate,
  editingTime,
  onEditingDateChange,
  onEditingTimeChange,
  saving,
  error,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  appId: string;
  item: ContentWithAnalytics;
  isEditing: boolean;
  editingBody: string;
  onEditingBodyChange: (value: string) => void;
  editingDate: string;
  editingTime: string;
  onEditingDateChange: (value: string) => void;
  onEditingTimeChange: (value: string) => void;
  saving: boolean;
  error: string | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const isArticle = item.content_type === "article";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <PlatformBadge platform={item.platform} />
          {item.pillar && (
            <span className="truncate text-xs text-muted-foreground">{item.pillar}</span>
          )}
        </div>

        {isEditing ? (
          <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-2.5">
            <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Calendar className="size-3.5" />
              Scheduled for
            </Label>
            <div className="flex gap-2">
              <Input
                type="date"
                value={editingDate}
                onChange={(e) => onEditingDateChange(e.target.value)}
                className="flex-1"
              />
              <Input
                type="time"
                value={editingTime}
                onChange={(e) => onEditingTimeChange(e.target.value)}
                className="w-28 shrink-0"
              />
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="size-3.5" />
            {formatDateTime(item.scheduled_at)}
          </p>
        )}

        {isArticle ? (
          <ArticlePreview body={item.body} />
        ) : isEditing ? (
          <Textarea
            value={editingBody}
            onChange={(e) => onEditingBodyChange(e.target.value)}
            rows={4}
            autoFocus
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm">{item.body}</p>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          {isArticle ? (
            <>
              <ArticleEditLink appId={appId} contentId={item.id} />
              <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
                <Trash2 />
                Delete
              </Button>
            </>
          ) : isEditing ? (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit} disabled={saving}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onSave}
                disabled={saving || editingBody.trim().length === 0 || !editingDate || !editingTime}
              >
                {saving && <Loader2 className="animate-spin" />}
                Save
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onStartEdit}>
                <Pencil />
                Edit
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
                <Trash2 />
                Delete
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function DraftPostCard({
  appId,
  item,
  isEditing,
  editingBody,
  onEditingBodyChange,
  saving,
  error,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  appId: string;
  item: ContentWithAnalytics;
  isEditing: boolean;
  editingBody: string;
  onEditingBodyChange: (value: string) => void;
  saving: boolean;
  error: string | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const isArticle = item.content_type === "article";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PlatformBadge platform={item.platform} />
            {item.source_research_finding_id && (
              <Badge variant="outline" className="gap-1 border-dashed font-normal">
                <Sparkles className="size-3" />
                From Research
              </Badge>
            )}
          </div>
          {item.pillar && (
            <span className="truncate text-xs text-muted-foreground">{item.pillar}</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">Drafted {formatDateTime(item.created_at)}</p>

        {isArticle ? (
          <ArticlePreview body={item.body} />
        ) : isEditing ? (
          <Textarea
            value={editingBody}
            onChange={(e) => onEditingBodyChange(e.target.value)}
            rows={4}
            autoFocus
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm">{item.body}</p>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          {isArticle ? (
            <>
              <ArticleEditLink appId={appId} contentId={item.id} />
              <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
                <Trash2 />
                Delete
              </Button>
            </>
          ) : isEditing ? (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit} disabled={saving}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onSave}
                disabled={saving || editingBody.trim().length === 0}
              >
                {saving && <Loader2 className="animate-spin" />}
                Save
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onStartEdit}>
                <Pencil />
                Edit
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
                <Trash2 />
                Delete
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PublishedPostCard({ item }: { item: ContentWithAnalytics }) {
  const isArticle = item.content_type === "article";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <PlatformBadge platform={item.platform} />
          {item.pillar && (
            <span className="truncate text-xs text-muted-foreground">{item.pillar}</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">{formatDateTime(item.published_at)}</p>

        {isArticle ? (
          <MarkdownContent content={item.body} />
        ) : (
          <p className="whitespace-pre-wrap text-sm">{item.body}</p>
        )}

        {item.analytics ? (
          <div className="flex gap-4 border-t pt-3 text-xs text-muted-foreground">
            <span>{item.analytics.impressions.toLocaleString()} impressions</span>
            <span>{item.analytics.likes.toLocaleString()} likes</span>
            <span>{item.analytics.clicks.toLocaleString()} clicks</span>
          </div>
        ) : (
          <p className="border-t pt-3 text-xs text-muted-foreground">Fetching metrics...</p>
        )}
      </CardContent>
    </Card>
  );
}
