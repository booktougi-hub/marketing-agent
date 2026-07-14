import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// Renders an error consistently everywhere an error currently gets shown
// inline (forms, settings sections, danger-zone flows) — same icon, color,
// and spacing every time, instead of each place writing its own
// `<p className="text-sm text-destructive">{error}</p>`.
export function ErrorMessage({
  message,
  code,
  className,
}: {
  message: string;
  code?: string;
  className?: string;
}) {
  return (
    <p
      role="alert"
      className={cn(
        "flex items-start gap-1.5 text-sm text-destructive",
        className
      )}
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {message}
        {code && <span className="ml-1 text-xs text-destructive/70">({code})</span>}
      </span>
    </p>
  );
}
