"use client";

import { useState } from "react";
import { ChevronDown, SquareArrowOutUpRight, ThumbsDown, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownContent } from "@/components/apps/markdown-content";
import { cn } from "@/lib/utils";
import type { CompetitorResearch } from "@/types";

// Read-only — competitor profiles are machine-researched facts about a
// third party, not something the founder hand-edits field by field the way
// their own DNA is. Refresh via the "Research Competitors" button in the
// parent section, not inline editing here.

function TagList({ values }: { values: string[] | undefined }) {
  if (!values || values.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value, i) => (
        <Badge key={i} variant="secondary" className="font-normal">
          {value}
        </Badge>
      ))}
    </div>
  );
}

function SubField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function CompetitorProfileCard({ competitor }: { competitor: CompetitorResearch }) {
  const [open, setOpen] = useState(false);

  const hasDeepProfile = !!competitor.profile_generated_at;
  const glanceItems = [
    competitor.founded_year && `Founded ${competitor.founded_year}`,
    competitor.headquarters,
    competitor.team_size_estimate,
    competitor.positioning_angle,
  ].filter(Boolean) as string[];

  return (
    <Card className="py-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-heading text-base font-medium">{competitor.competitor_name}</p>
            {competitor.competitor_url && (
              <a
                href={competitor.competitor_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {new URL(competitor.competitor_url).hostname.replace(/^www\./, "")}
                <SquareArrowOutUpRight className="h-3 w-3" />
              </a>
            )}
            {!hasDeepProfile && (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                Basic info only
              </Badge>
            )}
          </div>
          {competitor.tagline && <p className="text-sm text-muted-foreground">{competitor.tagline}</p>}
          {glanceItems.length > 0 && (
            <p className="text-xs text-muted-foreground">{glanceItems.join(" · ")}</p>
          )}
        </div>
        <ChevronDown
          className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
        />
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <CardContent className="flex flex-col gap-4 border-t pt-4 pb-5">
            <SubField label="Summary">
              <MarkdownContent
                content={competitor.scraped_summary || "No summary available."}
                className="text-muted-foreground"
              />
            </SubField>

            {(competitor.positioning_notes || competitor.target_audience || (competitor.key_messaging_themes?.length ?? 0) > 0) && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SubField label="Positioning">
                  <p className="text-muted-foreground">{competitor.positioning_notes}</p>
                </SubField>
                {competitor.target_audience && (
                  <SubField label="Target Audience">
                    <p className="text-muted-foreground">{competitor.target_audience}</p>
                  </SubField>
                )}
              </div>
            )}
            {(competitor.key_messaging_themes?.length ?? 0) > 0 && (
              <SubField label="Key Messaging Themes">
                <TagList values={competitor.key_messaging_themes} />
              </SubField>
            )}

            {((competitor.core_features?.length ?? 0) > 0 ||
              (competitor.notable_differentiators?.length ?? 0) > 0 ||
              (competitor.integrations?.length ?? 0) > 0) && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(competitor.core_features?.length ?? 0) > 0 && (
                  <SubField label="Core Features">
                    <TagList values={competitor.core_features} />
                  </SubField>
                )}
                {(competitor.notable_differentiators?.length ?? 0) > 0 && (
                  <SubField label="Notable Differentiators">
                    <TagList values={competitor.notable_differentiators} />
                  </SubField>
                )}
                {(competitor.integrations?.length ?? 0) > 0 && (
                  <SubField label="Integrations">
                    <TagList values={competitor.integrations} />
                  </SubField>
                )}
              </div>
            )}

            <SubField label="Pricing">
              {(competitor.pricing_tiers?.length ?? 0) > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-muted">
                        <th className="border border-border px-3 py-1.5 text-left font-semibold">Tier</th>
                        <th className="border border-border px-3 py-1.5 text-left font-semibold">Price</th>
                        <th className="border border-border px-3 py-1.5 text-left font-semibold">Key Inclusions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {competitor.pricing_tiers!.map((tier, i) => (
                        <tr key={i}>
                          <td className="border border-border px-3 py-1.5 align-top">{tier.tier_name}</td>
                          <td className="border border-border px-3 py-1.5 align-top">{tier.price}</td>
                          <td className="border border-border px-3 py-1.5 align-top text-muted-foreground">
                            {tier.key_inclusions}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted-foreground">{competitor.pricing_notes || "No pricing information found."}</p>
              )}
              {(competitor.billing_notes || competitor.free_trial) && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {[competitor.billing_notes, competitor.free_trial].filter(Boolean).join(" · ")}
                </p>
              )}
            </SubField>

            {((competitor.strengths?.length ?? 0) > 0 || (competitor.weaknesses?.length ?? 0) > 0) && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(competitor.strengths?.length ?? 0) > 0 && (
                  <SubField label="Strengths">
                    <ul className="flex flex-col gap-1">
                      {competitor.strengths!.map((s, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                          <ThumbsUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </SubField>
                )}
                {(competitor.weaknesses?.length ?? 0) > 0 && (
                  <SubField label="Weaknesses">
                    <ul className="flex flex-col gap-1">
                      {competitor.weaknesses!.map((w, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                          <ThumbsDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                          {w}
                        </li>
                      ))}
                    </ul>
                  </SubField>
                )}
              </div>
            )}

            {competitor.competitive_implications &&
              Object.values(competitor.competitive_implications).some(Boolean) && (
                <SubField label="Competitive Implications">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {competitor.competitive_implications.where_they_win && (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">Where they win: </span>
                        {competitor.competitive_implications.where_they_win}
                      </p>
                    )}
                    {competitor.competitive_implications.where_we_win && (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">Where we win: </span>
                        {competitor.competitive_implications.where_we_win}
                      </p>
                    )}
                    {competitor.competitive_implications.opportunities && (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">Opportunities: </span>
                        {competitor.competitive_implications.opportunities}
                      </p>
                    )}
                    {competitor.competitive_implications.threats && (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">Threats: </span>
                        {competitor.competitive_implications.threats}
                      </p>
                    )}
                  </div>
                </SubField>
              )}
          </CardContent>
        </div>
      </div>
    </Card>
  );
}
