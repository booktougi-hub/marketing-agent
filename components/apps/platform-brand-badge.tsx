import { PLATFORM_BRAND_COLOR, PLATFORM_BRAND_ICON, PLATFORM_LABEL } from "@/lib/platform";
import type { ContentPlatform } from "@/types";

// Real, recognizable brand mark (red YouTube play button, Instagram camera,
// Facebook "f") at the top of the platform detail view — distinct from
// PLATFORM_COLOR_VAR's abstract chart-categorical colors used for charts/
// filter chips elsewhere, since this specifically needs to be identifiable
// at a glance as "this is the YouTube/Instagram/Facebook section."
export function PlatformBrandBadge({ platform }: { platform: ContentPlatform }) {
  const Icon = PLATFORM_BRAND_ICON[platform];
  const color = PLATFORM_BRAND_COLOR[platform];

  if (!Icon || !color) return null;

  return (
    <div className="flex items-center gap-3">
      <div
        className="flex size-10 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)` }}
      >
        <Icon className="size-5" style={{ color }} />
      </div>
      <span className="text-lg font-semibold tracking-tight">{PLATFORM_LABEL[platform]}</span>
    </div>
  );
}
