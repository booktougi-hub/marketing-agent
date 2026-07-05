"use client";

import { cn } from "@/lib/utils";

function ToggleSwitch({
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  label?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      {label && <span className="text-sm font-medium">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-primary" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform",
            checked && "translate-x-4"
          )}
        />
      </button>
    </div>
  );
}

export { ToggleSwitch };
