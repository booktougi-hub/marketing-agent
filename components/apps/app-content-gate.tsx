"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import {
  AppContentView,
  type ContentWithAnalytics,
} from "@/components/apps/app-content-view";
import type { AppDna, AppStatus, StrategyContentPillar, StrategyPersona } from "@/types";

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

type AddResult = { ok: true } | { ok: false; error: string };

function AddPersonaCard({
  onAdd,
}: {
  onAdd: (persona: {
    name: string;
    role: string;
    pain_points: string[];
    where_they_hang_out: string[];
  }) => Promise<AddResult>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [painPoints, setPainPoints] = useState("");
  const [hangouts, setHangouts] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setRole("");
    setPainPoints("");
    setHangouts("");
    setError(null);
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    const result = await onAdd({
      name: name.trim(),
      role: role.trim(),
      pain_points: splitLines(painPoints),
      where_they_hang_out: splitLines(hangouts),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        <Plus className="h-5 w-5" />
        Add Persona
      </button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New Persona</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-persona-name">Name</Label>
          <Input id="new-persona-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-persona-role">Role</Label>
          <Input id="new-persona-role" value={role} onChange={(e) => setRole(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-persona-pain-points">Pain points (one per line)</Label>
          <Textarea
            id="new-persona-pain-points"
            rows={3}
            value={painPoints}
            onChange={(e) => setPainPoints(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-persona-hangouts">Where they hang out (one per line)</Label>
          <Textarea
            id="new-persona-hangouts"
            rows={2}
            value={hangouts}
            onChange={(e) => setHangouts(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              reset();
              setOpen(false);
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={saving || !name.trim() || !role.trim()}
          >
            {saving && <Loader2 className="animate-spin" />}
            Add Persona
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddPillarCard({
  onAdd,
}: {
  onAdd: (pillar: {
    name: string;
    description: string;
    example_topics: string[];
  }) => Promise<AddResult>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [exampleTopics, setExampleTopics] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setDescription("");
    setExampleTopics("");
    setError(null);
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    const result = await onAdd({
      name: name.trim(),
      description: description.trim(),
      example_topics: splitLines(exampleTopics),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        <Plus className="h-5 w-5" />
        Add Content Pillar
      </button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New Content Pillar</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-pillar-name">Name</Label>
          <Input id="new-pillar-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-pillar-description">Description</Label>
          <Textarea
            id="new-pillar-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-pillar-topics">Example topics (one per line)</Label>
          <Textarea
            id="new-pillar-topics"
            rows={3}
            value={exampleTopics}
            onChange={(e) => setExampleTopics(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              reset();
              setOpen(false);
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={saving || !name.trim() || !description.trim()}
          >
            {saving && <Loader2 className="animate-spin" />}
            Add Pillar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const LOADING_STATUSES = new Set<AppStatus>(["pending", "extracting", "strategy_pending"]);

const STATUS_LABELS: Record<AppStatus, string> = {
  pending: "Getting ready...",
  extracting: "Extracting app DNA...",
  strategy_pending: "Generating marketing strategy...",
  awaiting_approval: "Awaiting your approval",
  active: "Active",
  paused: "Paused",
  error: "Error",
  deleted: "Deleted",
};

interface StrategyPreview {
  id: string;
  personas: StrategyPersona[];
  content_pillars: StrategyContentPillar[];
  tone: string;
  channels: string[];
}

export function AppContentGate({
  appId,
  workspaceId,
  initialStatus,
  initialDna,
  initialStrategy,
  initialErrorMessage,
  initialContent,
}: {
  appId: string;
  workspaceId: string;
  initialStatus: AppStatus;
  initialDna: AppDna | null;
  initialStrategy: StrategyPreview | null;
  initialErrorMessage: string | null;
  initialContent: ContentWithAnalytics[];
}) {
  const [status, setStatus] = useState(initialStatus);
  const [dna, setDna] = useState(initialDna);
  const [strategy, setStrategy] = useState(initialStrategy);
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    const channel = supabase
      .channel(`app-content-gate-${appId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "apps",
          filter: `id=eq.${appId}`,
        },
        async (payload) => {
          const updated = payload.new as {
            status: AppStatus;
            dna: AppDna | null;
            error_message: string | null;
          };
          setStatus(updated.status);
          setDna(updated.dna);
          setErrorMessage(updated.error_message);

          if (updated.status === "awaiting_approval") {
            const { data } = await supabase
              .from("strategies")
              .select("id, personas, content_pillars, tone, channels")
              .eq("app_id", appId)
              .eq("workspace_id", workspaceId)
              .eq("status", "draft")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            setStrategy(data as StrategyPreview | null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [appId, workspaceId]);

  async function handleApprove() {
    setActionError(null);
    setApproving(true);
    try {
      const response = await fetch(`/api/apps/${appId}/approve`, { method: "PATCH" });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to approve strategy.");
      }
      // Optimistic: the realtime subscription above will also confirm this,
      // but flipping immediately avoids a flash of the loading state while
      // waiting for that event to arrive.
      setStatus("active");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to approve strategy.");
    } finally {
      setApproving(false);
    }
  }

  async function handleRegenerate() {
    setActionError(null);
    setRegenerating(true);
    try {
      const response = await fetch(`/api/apps/${appId}/regenerate`, { method: "POST" });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to regenerate strategy.");
      }
      setStrategy(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to regenerate strategy.");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleAddPersona(persona: {
    name: string;
    role: string;
    pain_points: string[];
    where_they_hang_out: string[];
  }): Promise<AddResult> {
    try {
      const response = await fetch(`/api/apps/${appId}/strategy/draft/personas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(persona),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        return { ok: false, error: data?.error ?? "Failed to add persona." };
      }
      setStrategy(data.strategy as StrategyPreview);
      return { ok: true };
    } catch {
      return { ok: false, error: "Failed to add persona." };
    }
  }

  async function handleAddPillar(pillar: {
    name: string;
    description: string;
    example_topics: string[];
  }): Promise<AddResult> {
    try {
      const response = await fetch(`/api/apps/${appId}/strategy/draft/pillars`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pillar),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        return { ok: false, error: data?.error ?? "Failed to add content pillar." };
      }
      setStrategy(data.strategy as StrategyPreview);
      return { ok: true };
    } catch {
      return { ok: false, error: "Failed to add content pillar." };
    }
  }

  if (LOADING_STATUSES.has(status)) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{STATUS_LABELS[status]}</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            This runs in the background — feel free to explore the other tabs
            while you wait, we&apos;ll bring you back here automatically.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Badge variant="destructive">{STATUS_LABELS[status]}</Badge>
          <p className="max-w-sm text-sm text-muted-foreground">
            {errorMessage || "Something went wrong while setting up this app."}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status === "awaiting_approval" && strategy) {
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
            <Badge variant="secondary">{STATUS_LABELS[status]}</Badge>
            <p className="max-w-md text-sm text-muted-foreground">
              Review the AI-generated strategy below. Approve it to start
              publishing content automatically, or regenerate for a different
              take.
            </p>
            {dna?.tagline && (
              <p className="text-sm italic text-muted-foreground">&ldquo;{dna.tagline}&rdquo;</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tone</CardTitle>
            <CardDescription>{strategy.tone}</CardDescription>
          </CardHeader>
        </Card>

        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Personas</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {strategy.personas.map((persona, i) => (
              <Card key={i}>
                <CardHeader>
                  <CardTitle className="text-base">{persona.name}</CardTitle>
                  <CardDescription>{persona.role}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <div>
                    <p className="font-medium text-foreground">Pain points</p>
                    <ul className="list-inside list-disc text-muted-foreground">
                      {persona.pain_points.map((point, j) => (
                        <li key={j}>{point}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Where they hang out</p>
                    <ul className="list-inside list-disc text-muted-foreground">
                      {persona.where_they_hang_out.map((place, j) => (
                        <li key={j}>{place}</li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            ))}
            <AddPersonaCard onAdd={handleAddPersona} />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Content Pillars</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {strategy.content_pillars.map((pillar, i) => (
              <Card key={i}>
                <CardHeader>
                  <CardTitle className="text-base">{pillar.name}</CardTitle>
                  <CardDescription>{pillar.description}</CardDescription>
                </CardHeader>
                <CardContent className="text-sm">
                  <p className="font-medium text-foreground">Example topics</p>
                  <ul className="list-inside list-disc text-muted-foreground">
                    {pillar.example_topics.map((topic, j) => (
                      <li key={j}>{topic}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
            <AddPillarCard onAdd={handleAddPillar} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-3">
            <Button onClick={handleApprove} disabled={approving || regenerating}>
              {approving && <Loader2 className="animate-spin" />}
              {approving ? "Approving..." : "Approve"}
            </Button>
            <Button
              variant="outline"
              onClick={handleRegenerate}
              disabled={approving || regenerating}
            >
              {regenerating && <Loader2 className="animate-spin" />}
              {regenerating ? "Regenerating..." : "Regenerate"}
            </Button>
          </div>
          {actionError && (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          )}
        </div>
      </div>
    );
  }

  // active, paused, or awaiting_approval with no draft strategy found yet
  // (edge case right after a regenerate) — show the content calendar, which
  // already renders a graceful empty state when there's nothing to show yet.
  return <AppContentView appId={appId} initialContent={initialContent} />;
}
