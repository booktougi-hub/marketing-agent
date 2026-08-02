"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Cpu,
  FileText,
  Fingerprint,
  Globe,
  ListChecks,
  Loader2,
  Radar,
  Share2,
  Sparkles,
  SquareArrowOutUpRight,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AutoAnalysisErrorBanner,
  EMPTY_FIELD_CLASS,
  EMPTY_PLACEHOLDER,
  FieldLabel,
  MarkdownField,
  ProcessingCard,
  SectionCard,
  SUNKEN_INPUT_CLASS,
  TagInput,
} from "@/components/apps/extraction-field-controls";
import { CompetitorProfileCard } from "@/components/apps/competitor-profile-card";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { parseApiError } from "@/lib/errors/parseApiError";
import { useIsStale } from "@/lib/hooks/useIsStale";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { AGENT_ACTION_COST, UNLIMITED_AGENT_CREDIT_PLANS, getRemainingCredits } from "@/lib/agentCredits";
import type {
  AppDna,
  AppDnaBusinessModel,
  AppDnaTechSignals,
  AppStatus,
  AppTone,
  CompetitorProfileStatus,
  CompetitorResearch,
  DnaExtractionSource,
  DnaReextractionStatus,
  PlanTier,
  ProductType,
} from "@/types";

// Duplicated from lib/discovery-query-builder.ts's PRODUCT_TYPE_LABEL rather
// than imported — that module is "server-only" (it also contains real
// discovery-query business logic), and this is a client component. Keep
// this in sync with that file's copy if the label wording ever changes.
const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  developer_tool: "developer tool",
  mobile_app: "mobile app",
  web_app: "web app",
  saas: "SaaS tool",
  browser_extension: "browser extension",
  other: "tool",
};

const TONE_OPTIONS: { value: AppTone; label: string }[] = [
  { value: "casual", label: "Casual" },
  { value: "professional", label: "Professional" },
  { value: "technical", label: "Technical" },
];

const EMPTY_TECH_SIGNALS: AppDnaTechSignals = {
  model_or_stack_used: null,
  supported_formats_or_languages: [],
  integrations: [],
  architecture_description: null,
};

const EMPTY_BUSINESS_MODEL: AppDnaBusinessModel = { narrative: null, source: null };

// DNA rows extracted before the 2026-07-29 depth change won't have these
// optional fields — normalized to their empty-collection equivalent so the
// form never needs a fallback at render time (same convention as
// brand-identity-section.tsx's toFormState).
function normalizeDna(dna: AppDna): AppDna {
  return {
    ...dna,
    competitors: dna.competitors ?? [],
    additional_urls: dna.additional_urls ?? [],
    what_it_does: dna.what_it_does ?? null,
    key_features: dna.key_features ?? [],
    product_category: dna.product_category ?? [],
    product_type: dna.product_type ?? null,
    target_customers: dna.target_customers ?? null,
    primary_cta: dna.primary_cta ?? null,
    tech_signals: dna.tech_signals ?? EMPTY_TECH_SIGNALS,
    business_model: dna.business_model ?? EMPTY_BUSINESS_MODEL,
  };
}

// Own component (not inlined) so its useIsStale() call has a stable hook
// order independent of the parent's own early returns — only mounted while
// competitor_profile_status === "processing".
function CompetitorResearchProcessingNotice() {
  const stale = useIsStale();
  return stale ? (
    <p className="text-sm text-muted-foreground">
      This is taking longer than expected. It may have been interrupted — try refreshing the page.
    </p>
  ) : (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Researching competitors — this can take a minute or two.
    </div>
  );
}

function businessModelSourceHint(source: AppDnaBusinessModel["source"]): string | null {
  if (source === "brand_information") {
    return "Summarized from your Brand Identity pricing data.";
  }
  if (source === "dna_extraction_fallback") {
    return "Estimated from your site — confirm once Brand Identity is analyzed for verified pricing.";
  }
  return null;
}

export function AppProductInformationView({
  appId,
  planTier,
  agentCreditsUsedThisWeek,
  agentCreditsResetAt,
  sourceUrl,
  productType,
  status,
  dna: initialDna,
  dnaExtractionSource: initialDnaExtractionSource,
  dnaReextractionStatus: initialDnaReextractionStatus,
  dnaReextractionError: initialDnaReextractionError,
  competitors: initialCompetitors,
  competitorProfileStatus: initialCompetitorProfileStatus,
  competitorProfileError: initialCompetitorProfileError,
  competitorProfileLastGeneratedAt,
}: {
  appId: string;
  planTier: PlanTier;
  agentCreditsUsedThisWeek: number;
  agentCreditsResetAt: string | null;
  sourceUrl: string;
  productType: ProductType;
  status: AppStatus;
  dna: AppDna | null;
  dnaExtractionSource: DnaExtractionSource | null;
  dnaReextractionStatus: DnaReextractionStatus;
  dnaReextractionError: string | null;
  competitors: CompetitorResearch[];
  competitorProfileStatus: CompetitorProfileStatus;
  competitorProfileError: string | null;
  competitorProfileLastGeneratedAt: string | null;
}) {
  const router = useRouter();
  const [appStatus, setAppStatus] = useState(status);
  const [form, setForm] = useState<AppDna | null>(initialDna ? normalizeDna(initialDna) : null);
  const [source, setSource] = useState<DnaExtractionSource>(initialDnaExtractionSource ?? {});
  const [reextractionStatus, setReextractionStatus] = useState(initialDnaReextractionStatus);
  const [reextractionError, setReextractionError] = useState(initialDnaReextractionError);
  const [competitorProfileStatus, setCompetitorProfileStatus] = useState(initialCompetitorProfileStatus);
  const [competitorProfileError, setCompetitorProfileError] = useState(initialCompetitorProfileError);
  const competitorProfileStatusRef = useRef(initialCompetitorProfileStatus);

  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(["overview"]));

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [reanalyzeOpen, setReanalyzeOpen] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);

  const [researchCompetitorsOpen, setResearchCompetitorsOpen] = useState(false);
  const [researchingCompetitors, setResearchingCompetitors] = useState(false);
  const [researchCompetitorsError, setResearchCompetitorsError] = useState<string | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel(`product-information-${appId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "apps", filter: `id=eq.${appId}` },
        (payload) => {
          const updated = payload.new as {
            dna: AppDna | null;
            dna_extraction_source: DnaExtractionSource | null;
            dna_reextraction_status: DnaReextractionStatus;
            dna_reextraction_error: string | null;
            status: AppStatus;
            competitor_profile_status: CompetitorProfileStatus;
            competitor_profile_error: string | null;
          };
          setAppStatus(updated.status);
          setForm(updated.dna ? normalizeDna(updated.dna) : null);
          setSource(updated.dna_extraction_source ?? {});
          setReextractionStatus(updated.dna_reextraction_status);
          setReextractionError(updated.dna_reextraction_error);
          // competitor_research rows live in a separate table this
          // subscription doesn't cover — a full refresh picks up the
          // freshly-generated profiles once competitor_profile_status
          // transitions away from "processing". Tracked via a ref (not the
          // state value) since this callback is created once when the
          // effect mounts and would otherwise always see the initial
          // status, never a later one.
          const competitorProfileFinished =
            updated.competitor_profile_status !== "processing" &&
            competitorProfileStatusRef.current === "processing";
          competitorProfileStatusRef.current = updated.competitor_profile_status;
          setCompetitorProfileStatus(updated.competitor_profile_status);
          setCompetitorProfileError(updated.competitor_profile_error);
          if (competitorProfileFinished) {
            router.refresh();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setField<K extends keyof AppDna>(key: K, value: AppDna[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSource((prev) => ({ ...prev, [key]: "manual" }));
  }

  function sourceFor(key: keyof AppDna) {
    return source[key];
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch(`/api/apps/${appId}/dna-information`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          tagline: form.tagline,
          problem: form.problem,
          target_audience: form.target_audience,
          competitors: form.competitors,
          additional_urls: form.additional_urls,
          tone: form.tone,
          what_it_does: form.what_it_does,
          key_features: form.key_features,
          product_category: form.product_category,
          product_type: form.product_type,
          target_customers: form.target_customers,
          primary_cta: form.primary_cta,
          tech_signals: form.tech_signals,
          business_model: { narrative: form.business_model?.narrative ?? null },
        }),
      });
      if (!res.ok) {
        const { message } = await parseApiError(res);
        setSaveError(message);
        return;
      }
      setSaveSuccess(true);
    } catch {
      setSaveError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  // No local state for the competitor list itself — router.refresh() (fired
  // above once competitor-profile-research finishes) re-renders the parent
  // Server Component and this component receives fresh `competitors` props
  // directly, same as any other server-fetched prop.
  const competitors = initialCompetitors;

  async function handleReanalyze() {
    setReanalyzing(true);
    setReanalyzeError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/agent-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType: "dna_reextraction" }),
      });
      if (!res.ok) {
        const { message } = await parseApiError(res);
        setReanalyzeError(message);
        return;
      }
      setReanalyzeOpen(false);
      setReextractionStatus("processing");
    } catch {
      setReanalyzeError("Failed to start re-analysis.");
    } finally {
      setReanalyzing(false);
    }
  }

  async function handleResearchCompetitors() {
    setResearchingCompetitors(true);
    setResearchCompetitorsError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/agent-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType: "competitor_profile_research" }),
      });
      if (!res.ok) {
        const { message } = await parseApiError(res);
        setResearchCompetitorsError(message);
        return;
      }
      setResearchCompetitorsOpen(false);
      competitorProfileStatusRef.current = "processing";
      setCompetitorProfileStatus("processing");
    } catch {
      setResearchCompetitorsError("Failed to start competitor research.");
    } finally {
      setResearchingCompetitors(false);
    }
  }

  if (!form) {
    if (appStatus === "error") {
      return (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Badge variant="destructive">Error</Badge>
            <p className="max-w-sm text-sm text-muted-foreground">
              Something went wrong while extracting this app&apos;s product information.
            </p>
          </CardContent>
        </Card>
      );
    }
    return (
      <ProcessingCard
        title="Product Information"
        description="Extracting product information from your app's website..."
        onRefresh={() => router.refresh()}
      />
    );
  }

  if (reextractionStatus === "processing") {
    return (
      <ProcessingCard
        title="Product Information"
        description="Re-analyzing your product — reading your homepage plus any features, pricing, docs, and about pages we can find. This usually takes under a minute."
        onRefresh={() => router.refresh()}
      />
    );
  }

  const creditFields = {
    agent_credits_used_this_week: agentCreditsUsedThisWeek,
    agent_credits_reset_at: agentCreditsResetAt,
  };
  const { remaining } = getRemainingCredits(creditFields, planTier);
  const isUnlimited = UNLIMITED_AGENT_CREDIT_PLANS.has(planTier);
  const reanalyzeCost = AGENT_ACTION_COST.dna_reextraction;
  const canReanalyze = isUnlimited || remaining >= reanalyzeCost;
  const researchCompetitorsCost = AGENT_ACTION_COST.competitor_profile_research;
  const canResearchCompetitors = isUnlimited || remaining >= researchCompetitorsCost;

  const businessModelHint = businessModelSourceHint(form.business_model?.source ?? null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Reviewed, edited, and confirmed by you — this is what strategy and content generation
          use as ground truth about your product.
        </p>
        <Button
          type="button"
          disabled={!canReanalyze}
          title={!canReanalyze ? "Not enough agent credits remaining" : undefined}
          onClick={() => {
            setReanalyzeError(null);
            setReanalyzeOpen(true);
          }}
        >
          <Sparkles className="h-4 w-4" />
          Re-analyze ({isUnlimited ? "Unlimited" : `${remaining} credits`})
        </Button>
      </div>

      {reextractionStatus === "error" && (
        <AutoAnalysisErrorBanner
          websiteUrl={sourceUrl}
          message={reextractionError ?? "Something went wrong during the last analysis."}
        />
      )}

      <SectionCard
        icon={Fingerprint}
        title="Overview"
        open={openGroups.has("overview")}
        onToggle={() => toggleGroup("overview")}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="dna-name" source={sourceFor("name")}>
              Product Name
            </FieldLabel>
            <Input
              id="dna-name"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              className={SUNKEN_INPUT_CLASS}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="dna-product-type" source={sourceFor("product_type")}>
              Detected Product Type
            </FieldLabel>
            <Input
              id="dna-product-type"
              value={form.product_type ?? ""}
              onChange={(e) => setField("product_type", e.target.value || null)}
              placeholder={EMPTY_PLACEHOLDER}
              className={cn(SUNKEN_INPUT_CLASS, !form.product_type && EMPTY_FIELD_CLASS)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="dna-tagline" source={sourceFor("tagline")}>
            One-liner
          </FieldLabel>
          <Input
            id="dna-tagline"
            value={form.tagline}
            onChange={(e) => setField("tagline", e.target.value)}
            placeholder="What it does, 15 words or fewer."
            className={SUNKEN_INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel source={sourceFor("product_category")}>Product Category</FieldLabel>
          <TagInput
            values={form.product_category ?? []}
            onChange={(next) => setField("product_category", next)}
            placeholder="e.g. AI security scanner"
          />
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <Globe className="h-5 w-5 shrink-0 text-muted-foreground" />
            <CardTitle>Website</CardTitle>
          </CardHeader>
          <CardContent>
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <span className="truncate">{sourceUrl}</span>
              <SquareArrowOutUpRight className="h-3.5 w-3.5 shrink-0" />
            </a>
            <p className="mt-1 text-xs text-muted-foreground">
              Change this in Settings &gt; App Identity.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <Fingerprint className="h-5 w-5 shrink-0 text-muted-foreground" />
            <CardTitle>Product Type (Settings)</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline" className="capitalize">
              {PRODUCT_TYPE_LABEL[productType]}
            </Badge>
            <p className="mt-2 text-xs text-muted-foreground">
              Your own classification, set in Settings &gt; App Identity — separate from the
              &ldquo;Detected Product Type&rdquo; above, which is inferred from your site.
            </p>
          </CardContent>
        </Card>
      </div>

      <SectionCard
        icon={FileText}
        title="What It Does"
        open={openGroups.has("what-it-does")}
        onToggle={() => toggleGroup("what-it-does")}
      >
        <MarkdownField
          id="dna-what-it-does"
          label="Detailed Description"
          source={sourceFor("what_it_does")}
          value={form.what_it_does ?? null}
          onChange={(next) => setField("what_it_does", next)}
          rows={4}
        />
      </SectionCard>

      <SectionCard
        icon={Target}
        title="Positioning"
        open={openGroups.has("positioning")}
        onToggle={() => toggleGroup("positioning")}
      >
        <MarkdownField
          id="dna-problem"
          label="Problem Solved"
          source={sourceFor("problem")}
          value={form.problem}
          onChange={(next) => setField("problem", next ?? "")}
          rows={2}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="dna-target-audience" source={sourceFor("target_audience")}>
              Target Audience
            </FieldLabel>
            <Textarea
              id="dna-target-audience"
              rows={2}
              value={form.target_audience}
              onChange={(e) => setField("target_audience", e.target.value)}
              className={SUNKEN_INPUT_CLASS}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="dna-target-customers" source={sourceFor("target_customers")}>
              Target Customers
            </FieldLabel>
            <Textarea
              id="dna-target-customers"
              rows={2}
              value={form.target_customers ?? ""}
              onChange={(e) => setField("target_customers", e.target.value || null)}
              placeholder={EMPTY_PLACEHOLDER}
              className={cn(SUNKEN_INPUT_CLASS, !form.target_customers && EMPTY_FIELD_CLASS)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="dna-primary-cta" source={sourceFor("primary_cta")}>
            Primary CTA
          </FieldLabel>
          <Input
            id="dna-primary-cta"
            value={form.primary_cta ?? ""}
            onChange={(e) => setField("primary_cta", e.target.value || null)}
            placeholder={EMPTY_PLACEHOLDER}
            className={cn(SUNKEN_INPUT_CLASS, !form.primary_cta && EMPTY_FIELD_CLASS)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel source={sourceFor("competitors")}>Competitors</FieldLabel>
          <TagInput values={form.competitors ?? []} onChange={(next) => setField("competitors", next)} />
        </div>
      </SectionCard>

      <SectionCard
        icon={ListChecks}
        title="Key Features"
        open={openGroups.has("key-features")}
        onToggle={() => toggleGroup("key-features")}
      >
        <div className="flex flex-col gap-1.5">
          <FieldLabel source={sourceFor("key_features")}>Key Features</FieldLabel>
          <TagInput
            values={form.key_features ?? []}
            onChange={(next) => setField("key_features", next)}
            placeholder="e.g. 40+ threat patterns across 19 attack categories"
          />
        </div>
      </SectionCard>

      <SectionCard
        icon={BarChart3}
        title="Business Model & Pricing"
        open={openGroups.has("business-model")}
        onToggle={() => toggleGroup("business-model")}
      >
        <div className="flex flex-col gap-1.5">
          <MarkdownField
            id="dna-business-model"
            label="Business Model"
            source={sourceFor("business_model")}
            value={form.business_model?.narrative ?? null}
            onChange={(next) =>
              setField("business_model", { narrative: next, source: form.business_model?.source ?? null })
            }
            rows={2}
          />
          {businessModelHint && <p className="text-xs text-muted-foreground">{businessModelHint}</p>}
        </div>
      </SectionCard>

      <SectionCard
        icon={Cpu}
        title="Tech Signals"
        open={openGroups.has("tech-signals")}
        onToggle={() => toggleGroup("tech-signals")}
      >
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="dna-tech-stack" source={sourceFor("tech_signals")}>
            Model / Stack Used
          </FieldLabel>
          <Input
            id="dna-tech-stack"
            value={form.tech_signals?.model_or_stack_used ?? ""}
            onChange={(e) =>
              setField("tech_signals", { ...(form.tech_signals ?? EMPTY_TECH_SIGNALS), model_or_stack_used: e.target.value || null })
            }
            placeholder={EMPTY_PLACEHOLDER}
            className={cn(SUNKEN_INPUT_CLASS, !form.tech_signals?.model_or_stack_used && EMPTY_FIELD_CLASS)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Supported Formats / Languages</FieldLabel>
          <TagInput
            values={form.tech_signals?.supported_formats_or_languages ?? []}
            onChange={(next) =>
              setField("tech_signals", { ...(form.tech_signals ?? EMPTY_TECH_SIGNALS), supported_formats_or_languages: next })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Integrations</FieldLabel>
          <TagInput
            values={form.tech_signals?.integrations ?? []}
            onChange={(next) => setField("tech_signals", { ...(form.tech_signals ?? EMPTY_TECH_SIGNALS), integrations: next })}
          />
        </div>
        <MarkdownField
          id="dna-architecture"
          label="Architecture Description"
          value={form.tech_signals?.architecture_description ?? null}
          onChange={(next) =>
            setField("tech_signals", {
              ...(form.tech_signals ?? EMPTY_TECH_SIGNALS),
              architecture_description: next,
            })
          }
          rows={2}
        />
      </SectionCard>

      <SectionCard
        icon={Share2}
        title="Channels & Links"
        open={openGroups.has("channels")}
        onToggle={() => toggleGroup("channels")}
      >
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Additional URLs</FieldLabel>
          <TagInput values={form.additional_urls ?? []} onChange={(next) => setField("additional_urls", next)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel source={sourceFor("tone")}>Tone</FieldLabel>
          <Select items={TONE_OPTIONS} value={form.tone} onValueChange={(value) => setField("tone", value as AppTone)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a tone" />
            </SelectTrigger>
            <SelectContent>
              {TONE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(form.app_store_urls?.play_store || form.app_store_urls?.app_store) && (
          <div className="flex flex-col gap-1.5">
            <FieldLabel>App Store Links</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {form.app_store_urls?.play_store && (
                <Badge
                  variant="outline"
                  render={<a href={form.app_store_urls.play_store} target="_blank" rel="noopener noreferrer" />}
                  className="h-auto gap-1.5 px-3 py-1.5 font-sans text-sm font-normal"
                >
                  Google Play
                </Badge>
              )}
              {form.app_store_urls?.app_store && (
                <Badge
                  variant="outline"
                  render={<a href={form.app_store_urls.app_store} target="_blank" rel="noopener noreferrer" />}
                  className="h-auto gap-1.5 px-3 py-1.5 font-sans text-sm font-normal"
                >
                  App Store
                </Badge>
              )}
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        icon={Radar}
        title="Competitor Information"
        description="Deep profiles of your known competitors — positioning, features, pricing, and how they stack up against you."
        open={openGroups.has("competitors")}
        onToggle={() => toggleGroup("competitors")}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {competitorProfileLastGeneratedAt
              ? `Last researched ${new Date(competitorProfileLastGeneratedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}`
              : "Not researched yet."}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canResearchCompetitors || competitorProfileStatus === "processing"}
            title={!canResearchCompetitors ? "Not enough agent credits remaining" : undefined}
            onClick={() => {
              setResearchCompetitorsError(null);
              setResearchCompetitorsOpen(true);
            }}
          >
            <Radar className="h-3.5 w-3.5" />
            Research Competitors ({isUnlimited ? "Unlimited" : `${remaining} credits`})
          </Button>
        </div>

        {competitorProfileStatus === "processing" && <CompetitorResearchProcessingNotice />}

        {competitorProfileStatus === "error" && (
          <AutoAnalysisErrorBanner
            websiteUrl={null}
            message={competitorProfileError ?? "Something went wrong during the last competitor research run."}
          />
        )}

        {competitorProfileStatus !== "processing" &&
          (competitors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No competitors researched yet. Click &ldquo;Research Competitors&rdquo; to discover and profile
              them — seeded from the competitors named in your Product Information above.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {competitors.map((competitor) => (
                <CompetitorProfileCard key={competitor.id} competitor={competitor} />
              ))}
            </div>
          ))}
      </SectionCard>

      {saveError && <ErrorMessage message={saveError} />}
      {saveSuccess && <p className="text-sm text-muted-foreground">Saved.</p>}

      <div className="flex justify-end">
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Save Changes
        </Button>
      </div>

      <Dialog open={reanalyzeOpen} onOpenChange={setReanalyzeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-analyze this app&apos;s product information?</DialogTitle>
            <DialogDescription>
              This re-crawls your homepage plus any features, pricing, docs, and about pages we
              can find, and refreshes any field you haven&apos;t manually edited. Fields you&apos;ve
              edited yourself are never overwritten. Uses {reanalyzeCost} agent credits.
            </DialogDescription>
          </DialogHeader>
          {reanalyzeError && <ErrorMessage message={reanalyzeError} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReanalyzeOpen(false)} disabled={reanalyzing}>
              Cancel
            </Button>
            <Button type="button" onClick={handleReanalyze} disabled={reanalyzing}>
              {reanalyzing && <Loader2 className="animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={researchCompetitorsOpen} onOpenChange={setResearchCompetitorsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Research your competitors?</DialogTitle>
            <DialogDescription>
              This scrapes each known competitor&apos;s homepage plus pricing, features, and about
              pages, then builds a full profile — positioning, features, pricing, strengths and
              weaknesses, and how they compare to your product. Refreshes any competitors already
              found; discovers some from your Product Information if none are known yet. Uses{" "}
              {researchCompetitorsCost} agent credits.
            </DialogDescription>
          </DialogHeader>
          {researchCompetitorsError && <ErrorMessage message={researchCompetitorsError} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setResearchCompetitorsOpen(false)}
              disabled={researchingCompetitors}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleResearchCompetitors} disabled={researchingCompetitors}>
              {researchingCompetitors && <Loader2 className="animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
