"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, Pencil, Sparkles, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownContent } from "@/components/apps/markdown-content";
import { useIsStale } from "@/lib/hooks/useIsStale";
import { cn } from "@/lib/utils";

// Drop-in replacement for a bare "processing..." spinner Card — same visual
// shell, but swaps to a "this is taking longer than expected" message with
// a manual refresh action once `useIsStale` trips, instead of spinning
// indefinitely with no way out if the backend job never reports back.
export function ProcessingCard({
  title,
  description,
  onRefresh,
}: {
  title: string;
  description: string;
  onRefresh: () => void;
}) {
  const stale = useIsStale();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        {stale ? (
          <>
            <AlertTriangle className="size-6 text-muted-foreground" />
            <p className="max-w-sm text-sm text-muted-foreground">
              This is taking longer than expected. It may have been interrupted — try refreshing.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
              Refresh
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Shared auto-filled/manual field UI — originally built for Brand Identity
// (components/apps/brand-identity-section.tsx), pulled out here so the
// Product Information page reuses the exact same components rather than a
// second copy. Any visual change to this pattern should happen once, here.

export function AutoBadge({ source }: { source: "auto" | "manual" | undefined }) {
  if (source !== "auto") return null;
  return (
    <Badge variant="outline" className="gap-1">
      <Sparkles className="h-2.5 w-2.5" />
      Auto-filled
    </Badge>
  );
}

// Small uppercase, letter-spaced label — matches DESIGN.md's "label-sm"
// (Geist, tracked, uppercase) treatment for field labels/tags, distinct
// from prose body text.
export function FieldLabel({
  htmlFor,
  source,
  suffix,
  children,
}: {
  htmlFor?: string;
  source?: "auto" | "manual" | undefined;
  suffix?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label
        htmlFor={htmlFor}
        className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase"
      >
        {children}
      </Label>
      {suffix ?? <AutoBadge source={source} />}
    </div>
  );
}

// Applied to any input/textarea whose current value is empty, so an
// unfilled field reads as "waiting for input" rather than "broken" — an
// empty auto-extractable field must look deliberately empty, not blank/
// glitched.
export const EMPTY_FIELD_CLASS = "border-dashed";
export const EMPTY_PLACEHOLDER = "Not found — add manually";

// Every field input sits visibly recessed below its card's own surface
// (DESIGN.md: "Input Fields: ...dark background #0A0A0A" against a #171717
// card) — the shared Input/Textarea primitives default to a transparent
// background so they inherit whatever they're placed on, so callers opt in
// explicitly wherever a field renders.
export const SUNKEN_INPUT_CLASS = "bg-background";

// Free-text tag/chip input — add via Enter, remove via the x on each chip.
export function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setDraft("");
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-lg border border-input p-1.5",
        SUNKEN_INPUT_CLASS,
        values.length === 0 && EMPTY_FIELD_CLASS
      )}
    >
      {values.map((value) => (
        <span
          key={value}
          className="flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground"
        >
          {value}
          <button
            type="button"
            onClick={() => onChange(values.filter((v) => v !== value))}
            aria-label={`Remove ${value}`}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder={values.length === 0 ? placeholder ?? EMPTY_PLACEHOLDER : "Add another..."}
        className="min-w-24 flex-1 bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

// One card per schema group, each independently collapsible — full bordered
// Card per section (not a divider inside one shared card) with a leading
// icon.
export function SectionCard({
  icon: Icon,
  title,
  description,
  open,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="py-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-6 py-5 text-left"
      >
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-heading text-base font-medium">{title}</p>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-4 border-t px-6 pt-4 pb-6">{children}</div>
        </div>
      </div>
    </Card>
  );
}

// The prominent failure banner shown when the last extraction attempt
// errored — deliberately louder than a generic inline error message used
// for save/upload failures elsewhere, since a failed auto-analysis is the
// reason some fields below may be stale or empty, not a small transient
// mistake.
export function AutoAnalysisErrorBanner({ websiteUrl, message }: { websiteUrl: string | null; message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-destructive">Auto-analysis failed</p>
        <p className="text-sm text-muted-foreground">
          {message}
          {websiteUrl && (
            <>
              {" "}
              <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="underline">
                {websiteUrl}
              </a>
              .
            </>
          )}{" "}
          Please fill in the details manually below.
        </p>
      </div>
    </div>
  );
}

// Long-form free-text fields (a paragraph of extracted description, not a
// short label) read as a dense, hard-to-scan block in a plain textarea —
// this renders the current value through the app's existing MarkdownContent
// styling (proper paragraph spacing, bold/list support if the text has any)
// by default, and swaps to a real Textarea only while actively editing.
// Click the rendered text or the Edit toggle to start editing; blurring the
// textarea (or clicking Done) switches back to the rendered view.
export function MarkdownField({
  id,
  label,
  source,
  value,
  onChange,
  rows = 3,
  placeholder = EMPTY_PLACEHOLDER,
}: {
  id: string;
  label: string;
  source?: "auto" | "manual" | undefined;
  value: string | null;
  onChange: (next: string | null) => void;
  rows?: number;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel
        htmlFor={id}
        suffix={
          <div className="flex items-center gap-2">
            <AutoBadge source={source} />
            <button
              type="button"
              onClick={() => setEditing((prev) => !prev)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
              {editing ? "Done" : "Edit"}
            </button>
          </div>
        }
      >
        {label}
      </FieldLabel>
      {editing ? (
        <Textarea
          id={id}
          rows={rows}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          onBlur={() => setEditing(false)}
          autoFocus
          placeholder={placeholder}
          className={cn(SUNKEN_INPUT_CLASS, !value && EMPTY_FIELD_CLASS)}
        />
      ) : value ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn(
            "cursor-text rounded-lg border border-input p-3 text-left",
            SUNKEN_INPUT_CLASS
          )}
        >
          <MarkdownContent content={value} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn(
            "rounded-lg border p-3 text-left text-sm text-muted-foreground",
            SUNKEN_INPUT_CLASS,
            EMPTY_FIELD_CLASS
          )}
        >
          {placeholder}
        </button>
      )}
    </div>
  );
}
