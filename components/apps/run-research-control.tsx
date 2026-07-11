"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RunResearchControl({
  remaining,
  cooldownHoursRemaining,
  isUnlimited,
  triggering,
  onRun,
}: {
  remaining: number;
  cooldownHoursRemaining: number;
  isUnlimited: boolean;
  triggering: boolean;
  onRun: () => void;
}) {
  // Cooldown applies to every plan, including unlimited ones — the trigger
  // route enforces it unconditionally, so it takes priority here too.
  if (cooldownHoursRemaining > 0) {
    return (
      <Button type="button" disabled variant="outline">
        Available again in {cooldownHoursRemaining} hour{cooldownHoursRemaining === 1 ? "" : "s"}
      </Button>
    );
  }

  if (isUnlimited) {
    return (
      <Button type="button" onClick={onRun} disabled={triggering}>
        {triggering && <Loader2 className="animate-spin" />}
        Run Research Now
      </Button>
    );
  }

  if (remaining <= 0) {
    return (
      <Button
        type="button"
        disabled
        variant="outline"
        title="No manual runs left this week. Upgrade for more, or your next automatic scan runs Sunday night."
      >
        Run Research Now
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" onClick={onRun} disabled={triggering}>
        {triggering && <Loader2 className="animate-spin" />}
        Run Research Now
      </Button>
      <p className="text-xs text-muted-foreground">
        ({remaining} manual run{remaining === 1 ? "" : "s"} remaining this week)
      </p>
    </div>
  );
}
