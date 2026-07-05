"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Flag, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/time";
import type { ColdEmailProspect, EmailInteraction, EmailType, ProspectStatus } from "@/types";

type OutreachTab = "prospects" | "sequences" | "replies";

const EMAIL_SEQUENCE_ORDER: EmailType[] = [
  "initial",
  "follow_up_1",
  "follow_up_2",
  "breakup",
];

const EMAIL_SEQUENCE_STEP_LABEL: Record<EmailType, string> = {
  initial: "Email 1",
  follow_up_1: "Email 2",
  follow_up_2: "Email 3",
  breakup: "Email 4",
};

const EMAIL_TYPE_LABEL: Record<EmailType, string> = {
  initial: "Initial email",
  follow_up_1: "Follow-up 1",
  follow_up_2: "Follow-up 2",
  breakup: "Breakup email",
};

const PROSPECT_STATUS_LABEL: Record<ProspectStatus, string> = {
  researched: "Researched",
  verified: "Verified",
  personalised: "Personalised",
  approved: "Approved",
  sent: "Sent",
  replied: "Replied",
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
};

const PROSPECT_STATUS_VARIANT: Record<
  ProspectStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  researched: "outline",
  verified: "secondary",
  personalised: "secondary",
  approved: "default",
  sent: "default",
  replied: "default",
  unsubscribed: "destructive",
  bounced: "destructive",
};

const STATUS_FILTERS: { value: "all" | ProspectStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "researched", label: "Researched" },
  { value: "verified", label: "Verified" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
];

function maskEmail(email: string | null) {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 1)}***@${domain}`;
}

function prospectDisplayName(prospect: Pick<ColdEmailProspect, "first_name" | "last_name">) {
  const name = [prospect.first_name, prospect.last_name].filter(Boolean).join(" ");
  return name || "Unnamed prospect";
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

function ProspectCard({
  prospect,
  expanded,
  approving,
  error,
  onToggleExpand,
  onApprove,
}: {
  prospect: ColdEmailProspect;
  expanded: boolean;
  approving: boolean;
  error?: string;
  onToggleExpand: () => void;
  onApprove: () => void;
}) {
  const hasDraft = Boolean(prospect.personalised_email);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {prospectDisplayName(prospect)}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {[prospect.title, prospect.company].filter(Boolean).join(" at ")}
            </p>
          </div>
          <Badge variant={PROSPECT_STATUS_VARIANT[prospect.status]}>
            {PROSPECT_STATUS_LABEL[prospect.status]}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          {maskEmail(prospect.email) ?? "No email on file"}
        </p>

        {prospect.personalisation_score !== null && (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Personalisation score</span>
              <span>{prospect.personalisation_score}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${prospect.personalisation_score}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasDraft}
            onClick={onToggleExpand}
          >
            <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
            View Email
          </Button>

          {prospect.status === "personalised" && (
            <Button type="button" size="sm" disabled={approving} onClick={onApprove}>
              {approving && <Loader2 className="animate-spin" />}
              Approve
            </Button>
          )}
        </div>

        {expanded && hasDraft && (
          <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
            {prospect.personalised_email}
          </p>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ProspectsTab({
  appId,
  prospects,
  onProspectUpdate,
}: {
  appId: string;
  prospects: ColdEmailProspect[];
  onProspectUpdate: (prospectId: string, patch: Partial<ColdEmailProspect>) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | ProspectStatus>("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const counts = useMemo(
    () => ({
      researched: prospects.filter((p) => p.status === "researched").length,
      verified: prospects.filter((p) => p.status === "verified").length,
      approved: prospects.filter((p) => p.status === "approved").length,
      sent: prospects.filter((p) => p.status === "sent").length,
    }),
    [prospects]
  );

  const filtered = useMemo(() => {
    if (statusFilter === "all") return prospects;
    return prospects.filter((p) => p.status === statusFilter);
  }, [prospects, statusFilter]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setRowError(id: string, message: string | null) {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  async function handleApprove(prospectId: string) {
    setApprovingId(prospectId);
    setRowError(prospectId, null);
    try {
      const res = await fetch(`/api/apps/${appId}/prospects/${prospectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setRowError(prospectId, json?.error ?? "Failed to approve prospect.");
        return;
      }
      onProspectUpdate(prospectId, { status: "approved" });
    } catch {
      setRowError(prospectId, "Failed to approve prospect.");
    } finally {
      setApprovingId(null);
    }
  }

  if (prospects.length === 0) {
    return (
      <EmptyState message="No prospects yet. Prospects will appear here once Apollo research finds contacts for your app." />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricTile label="Researched" value={counts.researched} />
        <MetricTile label="Verified" value={counts.verified} />
        <MetricTile label="Approved" value={counts.approved} />
        <MetricTile label="Sent" value={counts.sent} />
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setStatusFilter(filter.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              statusFilter === filter.value
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No prospects match this filter." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filtered.map((prospect) => (
            <ProspectCard
              key={prospect.id}
              prospect={prospect}
              expanded={expandedIds.has(prospect.id)}
              approving={approvingId === prospect.id}
              error={rowErrors[prospect.id]}
              onToggleExpand={() => toggleExpand(prospect.id)}
              onApprove={() => handleApprove(prospect.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SequencesTab({
  prospectById,
  interactions,
}: {
  prospectById: Map<string, ColdEmailProspect>;
  interactions: EmailInteraction[];
}) {
  const sequences = useMemo(() => {
    const byProspect = new Map<string, EmailInteraction[]>();
    for (const interaction of interactions) {
      const list = byProspect.get(interaction.prospect_id) ?? [];
      list.push(interaction);
      byProspect.set(interaction.prospect_id, list);
    }

    return Array.from(byProspect.entries()).map(([prospectId, prospectInteractions]) => {
      const byType = new Map(prospectInteractions.map((i) => [i.email_type, i]));
      const steps = EMAIL_SEQUENCE_ORDER.map((type) => ({
        type,
        label: EMAIL_SEQUENCE_STEP_LABEL[type],
        interaction: byType.get(type) ?? null,
      }));

      let latestSent: EmailInteraction | null = null;
      for (const step of steps) {
        if (step.interaction?.sent_at) latestSent = step.interaction;
      }

      const hasReply = prospectInteractions.some((i) => i.replied_at);

      return {
        prospectId,
        prospect: prospectById.get(prospectId) ?? null,
        steps,
        latestSent,
        hasReply,
      };
    });
  }, [interactions, prospectById]);

  if (sequences.length === 0) {
    return (
      <EmptyState message="Sequence progress will show up here once the first outreach email sends." />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {sequences.map((sequence) => (
        <Card key={sequence.prospectId}>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">
                  {sequence.prospect
                    ? prospectDisplayName(sequence.prospect)
                    : "Unknown prospect"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {sequence.prospect?.company ?? "—"}
                </p>
              </div>
              {sequence.hasReply ? (
                <Badge>Replied</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">No reply yet</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {sequence.steps.map((step, index) => (
                <div key={step.type} className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      step.interaction?.sent_at
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {step.label} {step.interaction?.sent_at ? "sent" : "pending"}
                  </span>
                  {index < sequence.steps.length - 1 && (
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-4 border-t pt-3 text-xs text-muted-foreground">
              <span>
                Sent: {sequence.latestSent?.sent_at
                  ? formatDateTime(sequence.latestSent.sent_at)
                  : "—"}
              </span>
              <span>{sequence.latestSent?.opened_at ? "Opened" : "Not opened"}</span>
              <span>{sequence.hasReply ? "Replied" : "No reply"}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RepliesTab({
  appId,
  prospectById,
  interactions,
  onInteractionUpdate,
}: {
  appId: string;
  prospectById: Map<string, ColdEmailProspect>;
  interactions: EmailInteraction[];
  onInteractionUpdate: (interactionId: string, patch: Partial<EmailInteraction>) => void;
}) {
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const replies = useMemo(
    () =>
      interactions
        .filter((i) => i.replied_at !== null)
        .sort((a, b) => new Date(b.replied_at!).getTime() - new Date(a.replied_at!).getTime()),
    [interactions]
  );

  function setRowError(id: string, message: string | null) {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  async function handleToggleActioned(interactionId: string, nextActioned: boolean) {
    setActioningId(interactionId);
    setRowError(interactionId, null);
    try {
      const res = await fetch(`/api/apps/${appId}/replies/${interactionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actioned: nextActioned }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setRowError(interactionId, json?.error ?? "Failed to update this reply.");
        return;
      }
      onInteractionUpdate(interactionId, {
        actioned_at: nextActioned ? new Date().toISOString() : null,
      });
    } catch {
      setRowError(interactionId, "Failed to update this reply.");
    } finally {
      setActioningId(null);
    }
  }

  if (replies.length === 0) {
    return (
      <EmptyState message="Replies will show up here as soon as a prospect responds to an outreach email." />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {replies.map((reply) => {
        const prospect = prospectById.get(reply.prospect_id) ?? null;
        const isActioned = Boolean(reply.actioned_at);
        return (
          <Card key={reply.id}>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {prospect ? prospectDisplayName(prospect) : "Unknown prospect"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {prospect
                      ? [prospect.title, prospect.company].filter(Boolean).join(" at ")
                      : "—"}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatTimeAgo(reply.replied_at!)}
                </span>
              </div>

              <p className="text-xs text-muted-foreground">
                Replied to {EMAIL_TYPE_LABEL[reply.email_type]}
              </p>

              <div>
                <Button
                  type="button"
                  variant={isActioned ? "secondary" : "outline"}
                  size="sm"
                  disabled={actioningId === reply.id}
                  onClick={() => handleToggleActioned(reply.id, !isActioned)}
                >
                  {actioningId === reply.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Flag className={cn(isActioned && "fill-current")} />
                  )}
                  {isActioned ? "Actioned" : "Mark as actioned"}
                </Button>
              </div>

              {rowErrors[reply.id] && (
                <p className="text-xs text-destructive">{rowErrors[reply.id]}</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function AppOutreachView({
  appId,
  initialProspects,
  initialInteractions,
}: {
  appId: string;
  initialProspects: ColdEmailProspect[];
  initialInteractions: EmailInteraction[];
}) {
  const [tab, setTab] = useState<OutreachTab>("prospects");
  const [prospects, setProspects] = useState(initialProspects);
  const [interactions, setInteractions] = useState(initialInteractions);

  const prospectById = useMemo(
    () => new Map(prospects.map((p) => [p.id, p])),
    [prospects]
  );

  function updateProspect(prospectId: string, patch: Partial<ColdEmailProspect>) {
    setProspects((prev) =>
      prev.map((p) => (p.id === prospectId ? { ...p, ...patch } : p))
    );
  }

  function updateInteraction(interactionId: string, patch: Partial<EmailInteraction>) {
    setInteractions((prev) =>
      prev.map((i) => (i.id === interactionId ? { ...i, ...patch } : i))
    );
  }

  const TABS: { value: OutreachTab; label: string }[] = [
    { value: "prospects", label: "Prospects" },
    { value: "sequences", label: "Sequences" },
    { value: "replies", label: "Replies" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-6 border-b">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setTab(item.value)}
            className={cn(
              "-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
              tab === item.value
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "prospects" && (
        <ProspectsTab
          appId={appId}
          prospects={prospects}
          onProspectUpdate={updateProspect}
        />
      )}
      {tab === "sequences" && (
        <SequencesTab prospectById={prospectById} interactions={interactions} />
      )}
      {tab === "replies" && (
        <RepliesTab
          appId={appId}
          prospectById={prospectById}
          interactions={interactions}
          onInteractionUpdate={updateInteraction}
        />
      )}
    </div>
  );
}
