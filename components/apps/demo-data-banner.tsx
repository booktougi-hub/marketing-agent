import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Shared across every not-yet-integrated Analytics tab (Google Analytics,
// GEO) and SEO's no-real-audit-yet fallback — makes it visually unmistakable
// that the numbers on screen are illustrative, not real, so nobody mistakes
// a UI preview for a live result. Swapping any of these tabs to real data
// later is just: stop passing demo data into the same view components and
// stop rendering this banner — no data migration, since none of this is
// ever written to the database.
export function DemoDataBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2">
      <Badge
        variant="outline"
        className="shrink-0 gap-1 border-transparent font-medium"
        style={{
          backgroundColor: "color-mix(in oklch, var(--chart-3) 18%, transparent)",
          color: "var(--chart-3)",
        }}
      >
        <FlaskConical className="size-3" />
        Demo data
      </Badge>
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
