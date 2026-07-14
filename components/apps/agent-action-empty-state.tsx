"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AGENT_ACTION_COST,
  canAffordAction,
  getCooldownHoursRemaining,
  getRemainingCredits,
} from "@/lib/agentCredits";
import type { AgentActionType } from "@/lib/agentCredits";
import type { PlanTier } from "@/types";

function formatLocal(date: Date) {
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Shared "no results yet" state for every research-agent-produced tab
// (Topics, Problems, Competitors, Opportunities) and the cold-email
// Prospects tab — same informative, dated, credit-aware pattern
// everywhere instead of a generic "no data yet" string, with a "Run Now"
// button that goes through the unified agent-action credit system.
export function AgentActionEmptyState({
  appId,
  actionType,
  planTier,
  agentCreditsUsedThisWeek,
  agentCreditsResetAt,
  lastAgentActionAt,
  firstRun,
  nextRunAt,
}: {
  appId: string;
  actionType: AgentActionType;
  planTier: PlanTier;
  agentCreditsUsedThisWeek: number;
  agentCreditsResetAt: string | null;
  lastAgentActionAt: string | null;
  // Only meaningful for actions that also fire automatically on approval —
  // omit for actions with no first-run concept (cold email prospecting).
  firstRun?: { completed: boolean; completedAt: string | null };
  // Next scheduled automatic run for this action, if it's on a cron at all.
  nextRunAt: Date | null;
}) {
  const router = useRouter();
  const [triggering, setTriggering] = useState(false);
  const [localNextRun, setLocalNextRun] = useState<string | null>(null);

  // Deferred to a client-only effect so server-rendered markup never
  // mismatches the client's first paint on the visitor's actual timezone —
  // same guard used by ResearchScheduleSection's AutomationRow.
  useEffect(() => {
    setLocalNextRun(nextRunAt ? formatLocal(nextRunAt) : null);
  }, [nextRunAt]);

  const creditFields = {
    agent_credits_used_this_week: agentCreditsUsedThisWeek,
    agent_credits_reset_at: agentCreditsResetAt,
  };
  const { remaining } = getRemainingCredits(creditFields, planTier);
  const afford = canAffordAction(creditFields, actionType, planTier);
  const cooldownHoursRemaining = getCooldownHoursRemaining(lastAgentActionAt);
  const cost = AGENT_ACTION_COST[actionType];

  async function handleRun() {
    setTriggering(true);
    try {
      const res = await fetch(`/api/apps/${appId}/agent-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error ?? "Failed to start this scan.");
        return;
      }
      toast.success("Started — results will appear in a few minutes");
      router.refresh();
    } catch {
      toast.error("Failed to start this scan.");
    } finally {
      setTriggering(false);
    }
  }

  // Tier-gated action (currently only cold_email_prospecting on free/solo)
  // — no dated pattern or button, just the upgrade message.
  if (!afford.allowed && afford.reason?.startsWith("Cold email outreach")) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="max-w-md text-sm text-muted-foreground">
            {afford.reason}{" "}
            <span className="font-medium text-primary">Upgrade to unlock</span>
          </p>
        </CardContent>
      </Card>
    );
  }

  if (firstRun && !firstRun.completed) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="max-w-md text-sm text-muted-foreground">
            Your first research scan is running now. This usually takes a few minutes.
          </p>
        </CardContent>
      </Card>
    );
  }

  const dateLabel = firstRun?.completedAt
    ? new Date(firstRun.completedAt).toLocaleDateString("en-US", { dateStyle: "medium" })
    : null;

  const disabledReason = !afford.allowed
    ? afford.reason
    : cooldownHoursRemaining > 0
      ? `Available again in ${cooldownHoursRemaining} hour${cooldownHoursRemaining === 1 ? "" : "s"}.`
      : undefined;

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <p className="max-w-md text-sm text-muted-foreground">
          {dateLabel
            ? `Your first scan completed on ${dateLabel} but found no results yet — this can happen for very new products with limited public discussion. `
            : "No results yet. "}
          {nextRunAt && (
            <>Your next automatic scan runs {localNextRun ?? "soon"}. </>
          )}
          You have {remaining} agent credit{remaining === 1 ? "" : "s"} remaining this week if
          you&apos;d like to check again sooner.
        </p>
        <Button
          type="button"
          onClick={handleRun}
          disabled={triggering || !afford.allowed || cooldownHoursRemaining > 0}
          title={disabledReason}
          variant={!afford.allowed || cooldownHoursRemaining > 0 ? "outline" : "default"}
        >
          {triggering && <Loader2 className="animate-spin" />}
          Run Now ({cost} credit{cost === 1 ? "" : "s"})
        </Button>
      </CardContent>
    </Card>
  );
}
