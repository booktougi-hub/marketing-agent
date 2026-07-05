"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
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
import { PLATFORM_COLOR_VAR, PLATFORM_LABEL } from "@/lib/platform";
import type { AppDna, AppStatus, Strategy, StrategyContentPillar, StrategyPersona } from "@/types";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function PersonaCard({ persona }: { persona: StrategyPersona }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-semibold">{persona.name}</p>
          <p className="text-xs text-muted-foreground">{persona.role}</p>
        </div>

        {persona.pain_points?.length > 0 && (
          <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            {persona.pain_points.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        )}

        {persona.where_they_hang_out?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {persona.where_they_hang_out.map((place, index) => (
              <Badge key={index} variant="outline">
                {place}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PillarCard({ pillar }: { pillar: StrategyContentPillar }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm font-semibold">{pillar.name}</p>
        <p className="text-sm text-muted-foreground">{pillar.description}</p>

        {pillar.example_topics?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pillar.example_topics.map((topic, index) => (
              <Badge key={index} variant="secondary">
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
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
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

function EmptyState({ appId }: { appId: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          No active strategy yet. Approve a generated strategy to see it here.
        </p>
        <a
          href={`/dashboard/apps/${appId}`}
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
          <div>
            <p className="text-lg font-semibold">{dna?.name ?? "App name unknown"}</p>
            {dna?.tagline && <p className="text-sm text-muted-foreground">{dna.tagline}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Problem it solves</p>
              <p className="text-sm">{dna?.problem ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Target audience</p>
              <p className="text-sm">{dna?.target_audience ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Tone of voice</p>
              <p className="text-sm capitalize">{dna?.tone ?? "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold tracking-tight">Personas</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(strategy.personas ?? []).map((persona, index) => (
            <PersonaCard key={index} persona={persona} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold tracking-tight">Content Pillars</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(strategy.content_pillars ?? []).map((pillar, index) => (
            <PillarCard key={index} pillar={pillar} />
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
