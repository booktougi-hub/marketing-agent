"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Flag,
  Layers,
  Lightbulb,
  Loader2,
  Megaphone,
  Mic2,
  MapPin,
  RefreshCw,
  Rocket,
  Users,
  type LucideIcon,
} from "lucide-react";
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
import { StrategyRoadmap } from "@/components/apps/strategy-roadmap";
import { AppIcon } from "@/components/apps/app-icon";
import { cn } from "@/lib/utils";
import { PLATFORM_COLOR_VAR, PLATFORM_LABEL } from "@/lib/platform";
import { useDashboardApp } from "@/components/dashboard/AppContext";
import type { AppDna, AppStatus, Strategy, StrategyContentPillar, StrategyPersona } from "@/types";

// Cycled across personas/pillars so each card gets a distinct accent color
// instead of every card looking identical.
const ACCENT_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-4)",
];

const PILLAR_ICONS: LucideIcon[] = [Lightbulb, Megaphone, Layers, Rocket, Flag];

// Long LLM-generated topics/hangouts were overflowing the fixed-height,
// nowrap Badge — this lets a badge wrap onto multiple lines instead.
const WRAP_BADGE_CLASS = "h-auto max-w-full whitespace-normal break-words py-1 text-left leading-snug";

function formatDateTime(value: string) {
  // Locale pinned so server-rendered and client-rendered text match exactly
  // (an `undefined` locale falls back to the runtime's locale, which can
  // differ between server and browser and trigger a hydration mismatch).
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

function PersonaCard({ persona, index }: { persona: StrategyPersona; index: number }) {
  const colorVar = ACCENT_COLORS[index % ACCENT_COLORS.length];
  const initials = initialsFor(persona.name);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            style={{
              backgroundColor: `color-mix(in oklch, ${colorVar} 18%, transparent)`,
              color: colorVar,
            }}
          >
            {initials || <Users className="size-4" />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{persona.name}</p>
            <p className="truncate text-xs text-muted-foreground">{persona.role}</p>
          </div>
        </div>

        {persona.pain_points?.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <AlertTriangle className="size-3" />
              Pain points
            </p>
            <ul className="flex flex-col gap-1">
              {persona.pain_points.map((point, i) => (
                <li
                  key={i}
                  className="rounded-md bg-muted/60 px-2 py-1 text-xs leading-snug break-words"
                >
                  {point}
                </li>
              ))}
            </ul>
          </div>
        )}

        {persona.where_they_hang_out?.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <MapPin className="size-3" />
              Hangs out
            </p>
            <div className="flex flex-wrap gap-1.5">
              {persona.where_they_hang_out.map((place, i) => (
                <Badge key={i} variant="outline" className={WRAP_BADGE_CLASS}>
                  {place}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PillarCard({ pillar, index }: { pillar: StrategyContentPillar; index: number }) {
  const colorVar = ACCENT_COLORS[index % ACCENT_COLORS.length];
  const Icon = PILLAR_ICONS[index % PILLAR_ICONS.length];

  return (
    <Card>
      <CardContent className="flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{
              backgroundColor: `color-mix(in oklch, ${colorVar} 18%, transparent)`,
              color: colorVar,
            }}
          >
            <Icon className="size-4" />
          </span>
          <p className="text-sm font-semibold">{pillar.name}</p>
        </div>
        <p className="text-sm text-muted-foreground">{pillar.description}</p>

        {pillar.example_topics?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pillar.example_topics.map((topic, i) => (
              <Badge key={i} variant="secondary" className={WRAP_BADGE_CLASS}>
                {topic}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChannelCard({ platform, text }: { platform: "twitter" | "linkedin"; text: string }) {
  const colorVar = PLATFORM_COLOR_VAR[platform];
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            style={{
              backgroundColor: `color-mix(in oklch, ${colorVar} 18%, transparent)`,
              color: colorVar,
            }}
          >
            {platform === "twitter" ? "X" : "in"}
          </span>
          <p className="text-sm font-semibold">{PLATFORM_LABEL[platform]}</p>
        </div>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}

function InfoTile({
  icon: Icon,
  label,
  value,
  colorVar,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  colorVar: string;
  className?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-muted/40 p-3">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor: `color-mix(in oklch, ${colorVar} 18%, transparent)`,
          color: colorVar,
        }}
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={cn("text-sm break-words", className)}>{value}</p>
      </div>
    </div>
  );
}

function EmptyState({ appId }: { appId: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          No active strategy yet. Approve a generated strategy to see it here.
        </p>
        <a
          href={`/dashboard/apps/${appId}/content`}
          className="text-sm font-medium text-primary hover:underline"
        >
          Review strategy
        </a>
      </CardContent>
    </Card>
  );
}

export function AppStrategyView({
  appId,
  appStatus,
  dna,
  strategy,
}: {
  appId: string;
  appStatus: AppStatus;
  dna: AppDna | null;
  strategy: Strategy | null;
}) {
  const router = useRouter();
  const { selectedApp } = useDashboardApp();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirmRegenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/strategy/regenerate`, {
        method: "POST",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Failed to start regeneration.");
        setRegenerating(false);
        return;
      }
      router.push(`/dashboard/apps/${appId}`);
    } catch {
      setError("Failed to start regeneration.");
      setRegenerating(false);
    }
  }

  if (!strategy) {
    return <EmptyState appId={appId} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              Version {strategy.version}
            </h2>
            <Badge>Active</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Generated {formatDateTime(strategy.created_at)}
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={appStatus !== "active"}
          onClick={() => setConfirmOpen(true)}
        >
          <RefreshCw />
          Regenerate Strategy
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <AppIcon
              name={dna?.name ?? "?"}
              iconUrl={selectedApp?.icon_url}
              className="h-12 w-12 rounded-xl text-lg"
            />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{dna?.name ?? "App name unknown"}</p>
              {dna?.tagline && (
                <p className="truncate text-sm text-muted-foreground">{dna.tagline}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <InfoTile
              icon={Lightbulb}
              label="Problem it solves"
              value={dna?.problem ?? "—"}
              colorVar="var(--chart-3)"
            />
            <InfoTile
              icon={Users}
              label="Target audience"
              value={dna?.target_audience ?? "—"}
              colorVar="var(--chart-1)"
            />
            <InfoTile
              icon={Mic2}
              label="Tone of voice"
              value={dna?.tone ?? "—"}
              colorVar="var(--chart-5)"
              className="capitalize"
            />
          </div>
        </CardContent>
      </Card>

      <StrategyRoadmap appId={appId} />

      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold tracking-tight">Personas</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(strategy.personas ?? []).map((persona, index) => (
            <PersonaCard key={index} persona={persona} index={index} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold tracking-tight">Content Pillars</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(strategy.content_pillars ?? []).map((pillar, index) => (
            <PillarCard key={index} pillar={pillar} index={index} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold tracking-tight">Channel Strategy</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {strategy.twitter_strategy && (
            <ChannelCard platform="twitter" text={strategy.twitter_strategy} />
          )}
          {strategy.linkedin_strategy && (
            <ChannelCard platform="linkedin" text={strategy.linkedin_strategy} />
          )}
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate strategy?</DialogTitle>
            <DialogDescription>
              This replaces your current active strategy with a new AI-generated
              one. You&apos;ll need to review and approve it again before it goes
              live.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={regenerating}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirmRegenerate} disabled={regenerating}>
              {regenerating && <Loader2 className="animate-spin" />}
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
