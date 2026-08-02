"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Fingerprint,
  Globe,
  Loader2,
  MessageSquare,
  Palette,
  Plus,
  Share2,
  Shield,
  Sparkles,
  SquareArrowOutUpRight,
  Target,
  Trash2,
  Upload,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import {
  AutoAnalysisErrorBanner,
  EMPTY_FIELD_CLASS,
  EMPTY_PLACEHOLDER,
  FieldLabel,
  ProcessingCard,
  SectionCard,
  SUNKEN_INPUT_CLASS,
  TagInput,
} from "@/components/apps/extraction-field-controls";
import { parseApiError } from "@/lib/errors/parseApiError";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  AGENT_ACTION_COST,
  UNLIMITED_AGENT_CREDIT_PLANS,
  getRemainingCredits,
} from "@/lib/agentCredits";
import type {
  BrandExtractionSource,
  BrandInformation,
  BrandKeyStat,
  BrandPricingPlan,
  BrandSocialHandles,
  PlanTier,
} from "@/types";

// ---------------------------------------------------------------------------
// Small shared building blocks — AutoBadge/FieldLabel/TagInput/SectionCard
// and the EMPTY_FIELD_CLASS/EMPTY_PLACEHOLDER/SUNKEN_INPUT_CLASS constants
// now live in components/apps/extraction-field-controls.tsx (imported
// above) so the Product Information page reuses the exact same pattern
// instead of a second copy. Everything below here is Brand-Identity-
// specific (structured editors for key stats, pricing, socials, colors).
// ---------------------------------------------------------------------------

function KeyStatsEditor({
  stats,
  onChange,
}: {
  stats: BrandKeyStat[];
  onChange: (next: BrandKeyStat[]) => void;
}) {
  function update(index: number, patch: Partial<BrandKeyStat>) {
    onChange(stats.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  function remove(index: number) {
    onChange(stats.filter((_, i) => i !== index));
  }
  function add() {
    onChange([...stats, { label: "", value: "", source_url: null }]);
  }

  return (
    <div className="flex flex-col gap-2">
      {stats.length === 0 && (
        <p className={cn("rounded-lg border p-3 text-sm text-muted-foreground", SUNKEN_INPUT_CLASS, EMPTY_FIELD_CLASS)}>
          {EMPTY_PLACEHOLDER}
        </p>
      )}
      {stats.map((stat, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={stat.label}
            onChange={(e) => update(i, { label: e.target.value })}
            placeholder="Label, e.g. Active users"
            className={cn("flex-1", SUNKEN_INPUT_CLASS)}
          />
          <Input
            value={stat.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder="Value, e.g. 10,000+"
            className={cn("flex-1", SUNKEN_INPUT_CLASS)}
          />
          <Input
            value={stat.source_url ?? ""}
            onChange={(e) => update(i, { source_url: e.target.value || null })}
            placeholder="Source URL (optional)"
            className={cn("flex-1", SUNKEN_INPUT_CLASS)}
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Remove stat">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="w-fit">
        <Plus className="h-3.5 w-3.5" />
        Add stat
      </Button>
    </div>
  );
}

function PricingSummaryEditor({
  plans,
  onChange,
}: {
  plans: BrandPricingPlan[];
  onChange: (next: BrandPricingPlan[]) => void;
}) {
  function update(index: number, patch: Partial<BrandPricingPlan>) {
    onChange(plans.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }
  function remove(index: number) {
    onChange(plans.filter((_, i) => i !== index));
  }
  function add() {
    onChange([...plans, { plan_name: "", price: "", billing_period: null }]);
  }

  return (
    <div className="flex flex-col gap-2">
      {plans.length === 0 && (
        <p className={cn("rounded-lg border p-3 text-sm text-muted-foreground", SUNKEN_INPUT_CLASS, EMPTY_FIELD_CLASS)}>
          {EMPTY_PLACEHOLDER}
        </p>
      )}
      {plans.map((plan, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={plan.plan_name}
            onChange={(e) => update(i, { plan_name: e.target.value })}
            placeholder="Plan name"
            className={cn("flex-1", SUNKEN_INPUT_CLASS)}
          />
          <Input
            value={plan.price}
            onChange={(e) => update(i, { price: e.target.value })}
            placeholder="Price, e.g. $29"
            className={cn("flex-1", SUNKEN_INPUT_CLASS)}
          />
          <Input
            value={plan.billing_period ?? ""}
            onChange={(e) => update(i, { billing_period: e.target.value || null })}
            placeholder="Billing period (optional)"
            className={cn("flex-1", SUNKEN_INPUT_CLASS)}
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Remove plan">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="w-fit">
        <Plus className="h-3.5 w-3.5" />
        Add plan
      </Button>
    </div>
  );
}

function SocialHandlesEditor({
  handles,
  onChange,
}: {
  handles: BrandSocialHandles;
  onChange: (next: BrandSocialHandles) => void;
}) {
  const rows = Object.entries(handles);

  function update(index: number, patch: { platform?: string; handle?: string }) {
    const next = [...rows];
    next[index] = [patch.platform ?? next[index][0], patch.handle ?? next[index][1]];
    onChange(Object.fromEntries(next));
  }
  function remove(index: number) {
    onChange(Object.fromEntries(rows.filter((_, i) => i !== index)));
  }
  function add() {
    onChange(Object.fromEntries([...rows, [`platform-${rows.length}`, ""]]));
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 && (
        <p className={cn("rounded-lg border p-3 text-sm text-muted-foreground", SUNKEN_INPUT_CLASS, EMPTY_FIELD_CLASS)}>
          {EMPTY_PLACEHOLDER}
        </p>
      )}
      {rows.map(([platform, handle], i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={platform}
            onChange={(e) => update(i, { platform: e.target.value })}
            placeholder="Platform, e.g. twitter"
            className={cn("w-40 shrink-0", SUNKEN_INPUT_CLASS)}
          />
          <Input
            value={handle}
            onChange={(e) => update(i, { handle: e.target.value })}
            placeholder="@handle or URL"
            className={cn("flex-1", SUNKEN_INPUT_CLASS)}
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Remove handle">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="w-fit">
        <Plus className="h-3.5 w-3.5" />
        Add handle
      </Button>
    </div>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const safeHex = value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#4f46e5";
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} swatch`}
          value={safeHex}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-input p-0.5"
        />
        <Input
          id={id}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder={EMPTY_PLACEHOLDER}
          className={cn("flex-1", SUNKEN_INPUT_CLASS, !value && EMPTY_FIELD_CLASS)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — no brand_information row yet
// ---------------------------------------------------------------------------

function BrandIdentityEmptyState({
  appId,
  onAnalysisStarted,
}: {
  appId: string;
  onAnalysisStarted: () => void;
}) {
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/brand-information/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website_url: url }),
      });
      if (!res.ok) {
        const { message } = await parseApiError(res);
        setError(message);
        return;
      }
      onAnalysisStarted();
    } catch {
      setError("Failed to start brand analysis.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brand Identity</CardTitle>
        <CardDescription>
          Automatically pull your brand&apos;s identity, voice, and proof points from your
          website so content generation and GEO checks can use them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="brand-analyze-url">Website URL</FieldLabel>
          <Input
            id="brand-analyze-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourapp.com"
            className={SUNKEN_INPUT_CLASS}
          />
        </div>
        {error && <ErrorMessage message={error} />}
        <div className="flex justify-end">
          <Button type="button" onClick={handleAnalyze} disabled={submitting || !url.trim()}>
            {submitting && <Loader2 className="animate-spin" />}
            Analyze my brand
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

// BrandInformation's array/jsonb columns are nullable in the DB (a brand new
// row, or one no extraction has touched yet, has them as null) but the form
// always works with the empty-collection equivalent instead — every array/
// jsonb field below is typed non-null so callers never need a fallback.
type FormState = Omit<
  BrandInformation,
  | "id"
  | "app_id"
  | "workspace_id"
  | "updated_at"
  | "known_competitors"
  | "tone_descriptors"
  | "words_to_avoid"
  | "key_stats"
  | "pricing_summary"
  | "social_handles"
  | "claims_to_avoid"
  | "target_regions"
  | "product_screenshots"
  | "extraction_source"
> & {
  known_competitors: string[];
  tone_descriptors: string[];
  words_to_avoid: string[];
  key_stats: BrandKeyStat[];
  pricing_summary: BrandPricingPlan[];
  social_handles: BrandSocialHandles;
  claims_to_avoid: string[];
  target_regions: string[];
  product_screenshots: string[];
  extraction_source: BrandExtractionSource;
};

const EMPTY_FORM: FormState = {
  brand_name: null,
  one_liner: null,
  category: null,
  website_url: null,
  logo_url: null,
  problem_solved: null,
  target_customer: null,
  differentiator: null,
  known_competitors: [],
  tone_descriptors: [],
  words_to_avoid: [],
  writing_sample: null,
  key_stats: [],
  testimonial: null,
  testimonial_source: null,
  pricing_summary: [],
  social_handles: {},
  github_repo_url: null,
  founder_name: null,
  founder_bio: null,
  claims_to_avoid: [],
  target_regions: [],
  primary_color_hex: null,
  secondary_color_hex: null,
  font_preference: null,
  product_screenshots: [],
  extraction_source: {},
  extraction_status: "idle",
  extraction_error: null,
  pending_run_id: null,
  last_analyzed_at: null,
};

function toFormState(row: BrandInformation | null): FormState {
  if (!row) return { ...EMPTY_FORM };
  return {
    ...row,
    known_competitors: row.known_competitors ?? [],
    tone_descriptors: row.tone_descriptors ?? [],
    words_to_avoid: row.words_to_avoid ?? [],
    key_stats: row.key_stats ?? [],
    pricing_summary: row.pricing_summary ?? [],
    social_handles: row.social_handles ?? {},
    claims_to_avoid: row.claims_to_avoid ?? [],
    target_regions: row.target_regions ?? [],
    product_screenshots: row.product_screenshots ?? [],
    extraction_source: row.extraction_source ?? {},
  };
}

const ONE_LINER_MAX = 120;

const GROUP_IDS = [
  "core-identity",
  "positioning",
  "voice-tone",
  "proof-points",
  "channels",
  "founder",
  "guardrails",
  "visual-identity",
] as const;

export function BrandIdentitySection({
  appId,
  planTier,
  agentCreditsUsedThisWeek,
  agentCreditsResetAt,
  initialBrandInformation,
}: {
  appId: string;
  planTier: PlanTier;
  agentCreditsUsedThisWeek: number;
  agentCreditsResetAt: string | null;
  initialBrandInformation: BrandInformation | null;
}) {
  const router = useRouter();
  const [row, setRow] = useState(initialBrandInformation);
  const [form, setForm] = useState<FormState>(() => toFormState(initialBrandInformation));
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set([GROUP_IDS[0]]));

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [reanalyzeOpen, setReanalyzeOpen] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel(`brand-identity-${appId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "brand_information", filter: `app_id=eq.${appId}` },
        (payload) => {
          const updated = payload.new as BrandInformation;
          setRow(updated);
          setForm(toFormState(updated));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "brand_information", filter: `app_id=eq.${appId}` },
        (payload) => {
          const updated = payload.new as BrandInformation;
          setRow(updated);
          setForm(toFormState(updated));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [appId]);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      extraction_source: { ...prev.extraction_source, [key]: "manual" },
    }));
  }

  function sourceFor(key: keyof BrandExtractionSource) {
    return form.extraction_source?.[key];
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch(`/api/apps/${appId}/brand-information`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_name: form.brand_name,
          one_liner: form.one_liner,
          category: form.category,
          website_url: form.website_url,
          problem_solved: form.problem_solved,
          target_customer: form.target_customer,
          differentiator: form.differentiator,
          known_competitors: form.known_competitors,
          tone_descriptors: form.tone_descriptors,
          words_to_avoid: form.words_to_avoid,
          writing_sample: form.writing_sample,
          key_stats: form.key_stats,
          testimonial: form.testimonial,
          testimonial_source: form.testimonial_source,
          pricing_summary: form.pricing_summary,
          social_handles: form.social_handles,
          github_repo_url: form.github_repo_url,
          founder_name: form.founder_name,
          founder_bio: form.founder_bio,
          claims_to_avoid: form.claims_to_avoid,
          target_regions: form.target_regions,
          primary_color_hex: form.primary_color_hex,
          secondary_color_hex: form.secondary_color_hex,
          font_preference: form.font_preference,
        }),
      });
      if (!res.ok) {
        const { message } = await parseApiError(res);
        setSaveError(message);
        return;
      }
      setSaveSuccess(true);
      router.refresh();
    } catch {
      setSaveError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(kind: "logo" | "screenshot", file: File) {
    const setUploading = kind === "logo" ? setUploadingLogo : setUploadingScreenshot;
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", kind);
      const res = await fetch(`/api/apps/${appId}/brand-information/upload`, { method: "POST", body });
      if (!res.ok) {
        const { message } = await parseApiError(res);
        setUploadError(message);
        return;
      }
      const json = (await res.json()) as { url: string };
      if (kind === "logo") {
        setForm((prev) => ({
          ...prev,
          logo_url: json.url,
          extraction_source: { ...prev.extraction_source, logo_url: "manual" },
        }));
      } else {
        setForm((prev) => ({
          ...prev,
          product_screenshots: [...prev.product_screenshots, json.url],
          extraction_source: { ...prev.extraction_source, product_screenshots: "manual" },
        }));
      }
    } catch {
      setUploadError("Failed to upload the file.");
    } finally {
      setUploading(false);
    }
  }

  async function handleReanalyze() {
    setReanalyzing(true);
    setReanalyzeError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/agent-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType: "brand_info_extraction" }),
      });
      if (!res.ok) {
        const { message } = await parseApiError(res);
        setReanalyzeError(message);
        return;
      }
      setReanalyzeOpen(false);
      setRow((prev) => (prev ? { ...prev, extraction_status: "processing", extraction_error: null } : prev));
    } catch {
      setReanalyzeError("Failed to start re-analysis.");
    } finally {
      setReanalyzing(false);
    }
  }

  if (!row) {
    return (
      <BrandIdentityEmptyState
        appId={appId}
        onAnalysisStarted={() => {
          // Optimistic — the realtime subscription above will replace this
          // with the real row (and real extraction_status) the moment
          // brand-info-extraction's route creates it.
          setRow({
            id: "",
            app_id: appId,
            workspace_id: "",
            ...EMPTY_FORM,
            extraction_status: "processing",
            updated_at: new Date().toISOString(),
          });
        }}
      />
    );
  }

  if (row.extraction_status === "processing") {
    return (
      <ProcessingCard
        title="Brand Identity"
        description="Analyzing your brand — reading your homepage and any About/Pricing pages we can find. This usually takes under a minute."
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
  const reanalyzeCost = AGENT_ACTION_COST.brand_info_extraction;
  const canReanalyze = isUnlimited || remaining >= reanalyzeCost;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Reviewed, edited, and confirmed by you — this is what content generation and
          GEO checks use as ground truth about your brand.
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
          {row.last_analyzed_at ? "Re-analyze" : "Analyze Website"} (
          {isUnlimited ? "Unlimited" : `${remaining} credits`})
        </Button>
      </div>

      {row.extraction_status === "error" && (
        <AutoAnalysisErrorBanner
          websiteUrl={form.website_url}
          message={row.extraction_error ?? "Something went wrong during the last analysis."}
        />
      )}

      <SectionCard
        icon={Fingerprint}
        title="Core Identity"
        open={openGroups.has("core-identity")}
        onToggle={() => toggleGroup("core-identity")}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="brand-name" source={sourceFor("brand_name")}>
              Brand Name
            </FieldLabel>
            <Input
              id="brand-name"
              value={form.brand_name ?? ""}
              onChange={(e) => setField("brand_name", e.target.value || null)}
              placeholder={EMPTY_PLACEHOLDER}
              className={cn(SUNKEN_INPUT_CLASS, !form.brand_name && EMPTY_FIELD_CLASS)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="brand-category" source={sourceFor("category")}>
              Category
            </FieldLabel>
            <Input
              id="brand-category"
              value={form.category ?? ""}
              onChange={(e) => setField("category", e.target.value || null)}
              placeholder={EMPTY_PLACEHOLDER}
              className={cn(SUNKEN_INPUT_CLASS, !form.category && EMPTY_FIELD_CLASS)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <FieldLabel
            htmlFor="brand-one-liner"
            suffix={
              <span className="font-mono text-[11px] text-muted-foreground">
                {(form.one_liner ?? "").length} / {ONE_LINER_MAX}
              </span>
            }
          >
            One-liner
          </FieldLabel>
          <Input
            id="brand-one-liner"
            value={form.one_liner ?? ""}
            onChange={(e) => setField("one_liner", e.target.value || null)}
            placeholder="What it does, 15 words or fewer."
            maxLength={ONE_LINER_MAX}
            className={cn(SUNKEN_INPUT_CLASS, !form.one_liner && EMPTY_FIELD_CLASS)}
          />
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <Globe className="h-5 w-5 shrink-0 text-muted-foreground" />
            <CardTitle>Website URL</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Input
                id="brand-website-url"
                value={form.website_url ?? ""}
                onChange={(e) => setField("website_url", e.target.value || null)}
                placeholder="https://yourapp.com"
                className={cn("pr-9", SUNKEN_INPUT_CLASS, !form.website_url && EMPTY_FIELD_CLASS)}
              />
              {form.website_url && (
                <a
                  href={form.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open website in a new tab"
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <Palette className="h-5 w-5 shrink-0 text-muted-foreground" />
            <CardTitle>Brand Assets</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              {form.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.logo_url}
                  alt="Brand logo"
                  className="h-12 w-12 shrink-0 rounded-lg border border-input object-contain bg-white"
                />
              ) : (
                <div
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border text-xs text-muted-foreground",
                    SUNKEN_INPUT_CLASS,
                    EMPTY_FIELD_CLASS
                  )}
                >
                  <Palette className="h-4 w-4" />
                </div>
              )}
              <label>
                <span
                  className={cn(
                    buttonOutlineSmClass,
                    "cursor-pointer",
                    uploadingLogo && "pointer-events-none opacity-50"
                  )}
                >
                  {uploadingLogo ? <Loader2 className="animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Upload Logo
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleUpload("logo", file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {uploadError && <ErrorMessage message={uploadError} />}
          </CardContent>
        </Card>
      </div>

      <SectionCard
        icon={Target}
        title="Positioning"
        open={openGroups.has("positioning")}
        onToggle={() => toggleGroup("positioning")}
      >
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="brand-problem" source={sourceFor("problem_solved")}>
            Problem Solved
          </FieldLabel>
          <Textarea
            id="brand-problem"
            rows={3}
            value={form.problem_solved ?? ""}
            onChange={(e) => setField("problem_solved", e.target.value || null)}
            placeholder={EMPTY_PLACEHOLDER}
            className={cn(SUNKEN_INPUT_CLASS, !form.problem_solved && EMPTY_FIELD_CLASS)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="brand-target-customer" source={sourceFor("target_customer")}>
            Target Customer
          </FieldLabel>
          <Textarea
            id="brand-target-customer"
            rows={2}
            value={form.target_customer ?? ""}
            onChange={(e) => setField("target_customer", e.target.value || null)}
            placeholder={EMPTY_PLACEHOLDER}
            className={cn(SUNKEN_INPUT_CLASS, !form.target_customer && EMPTY_FIELD_CLASS)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="brand-differentiator" source={sourceFor("differentiator")}>
            Differentiator
          </FieldLabel>
          <Textarea
            id="brand-differentiator"
            rows={2}
            value={form.differentiator ?? ""}
            onChange={(e) => setField("differentiator", e.target.value || null)}
            placeholder={EMPTY_PLACEHOLDER}
            className={cn(SUNKEN_INPUT_CLASS, !form.differentiator && EMPTY_FIELD_CLASS)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel source={sourceFor("known_competitors")}>Known Competitors</FieldLabel>
          <TagInput
            values={form.known_competitors}
            onChange={(next) => setField("known_competitors", next)}
          />
        </div>
      </SectionCard>

      <SectionCard
        icon={MessageSquare}
        title="Voice & Tone"
        open={openGroups.has("voice-tone")}
        onToggle={() => toggleGroup("voice-tone")}
      >
        <div className="flex flex-col gap-1.5">
          <FieldLabel source={sourceFor("tone_descriptors")}>Tone Descriptors</FieldLabel>
          <TagInput
            values={form.tone_descriptors}
            onChange={(next) => setField("tone_descriptors", next)}
            placeholder="e.g. direct, technical, no fluff"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Words to Avoid</FieldLabel>
          <TagInput values={form.words_to_avoid} onChange={(next) => setField("words_to_avoid", next)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="brand-writing-sample">Writing Sample</FieldLabel>
          <Textarea
            id="brand-writing-sample"
            rows={4}
            value={form.writing_sample ?? ""}
            onChange={(e) => setField("writing_sample", e.target.value || null)}
            placeholder="Optional — paste a paragraph that sounds like your brand"
            className={SUNKEN_INPUT_CLASS}
          />
        </div>
      </SectionCard>

      <SectionCard
        icon={BarChart3}
        title="Proof Points"
        open={openGroups.has("proof-points")}
        onToggle={() => toggleGroup("proof-points")}
      >
        <div className="flex flex-col gap-1.5">
          <FieldLabel source={sourceFor("key_stats")}>Key Stats</FieldLabel>
          <KeyStatsEditor stats={form.key_stats} onChange={(next) => setField("key_stats", next)} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="brand-testimonial" source={sourceFor("testimonial")}>
              Testimonial
            </FieldLabel>
            <Textarea
              id="brand-testimonial"
              rows={3}
              value={form.testimonial ?? ""}
              onChange={(e) => setField("testimonial", e.target.value || null)}
              placeholder={EMPTY_PLACEHOLDER}
              className={cn(SUNKEN_INPUT_CLASS, !form.testimonial && EMPTY_FIELD_CLASS)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="brand-testimonial-source" source={sourceFor("testimonial_source")}>
              Testimonial Source
            </FieldLabel>
            <Input
              id="brand-testimonial-source"
              value={form.testimonial_source ?? ""}
              onChange={(e) => setField("testimonial_source", e.target.value || null)}
              placeholder="e.g. Jane Doe, CEO of Acme"
              className={cn(SUNKEN_INPUT_CLASS, !form.testimonial_source && EMPTY_FIELD_CLASS)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel source={sourceFor("pricing_summary")}>Pricing Summary</FieldLabel>
          <PricingSummaryEditor
            plans={form.pricing_summary}
            onChange={(next) => setField("pricing_summary", next)}
          />
        </div>
      </SectionCard>

      <SectionCard
        icon={Share2}
        title="Channels"
        open={openGroups.has("channels")}
        onToggle={() => toggleGroup("channels")}
      >
        <div className="flex flex-col gap-1.5">
          <FieldLabel source={sourceFor("social_handles")}>Social Handles</FieldLabel>
          <SocialHandlesEditor
            handles={form.social_handles}
            onChange={(next) => setField("social_handles", next)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="brand-github" source={sourceFor("github_repo_url")}>
            GitHub Repository
          </FieldLabel>
          <Input
            id="brand-github"
            value={form.github_repo_url ?? ""}
            onChange={(e) => setField("github_repo_url", e.target.value || null)}
            placeholder={EMPTY_PLACEHOLDER}
            className={cn(SUNKEN_INPUT_CLASS, !form.github_repo_url && EMPTY_FIELD_CLASS)}
          />
        </div>
      </SectionCard>

      <SectionCard
        icon={User}
        title="Founder Context"
        description="Optional"
        open={openGroups.has("founder")}
        onToggle={() => toggleGroup("founder")}
      >
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="brand-founder-name" source={sourceFor("founder_name")}>
            Founder Name
          </FieldLabel>
          <Input
            id="brand-founder-name"
            value={form.founder_name ?? ""}
            onChange={(e) => setField("founder_name", e.target.value || null)}
            placeholder={EMPTY_PLACEHOLDER}
            className={cn(SUNKEN_INPUT_CLASS, !form.founder_name && EMPTY_FIELD_CLASS)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="brand-founder-bio" source={sourceFor("founder_bio")}>
            Founder Bio
          </FieldLabel>
          <Textarea
            id="brand-founder-bio"
            rows={3}
            value={form.founder_bio ?? ""}
            onChange={(e) => setField("founder_bio", e.target.value || null)}
            placeholder={EMPTY_PLACEHOLDER}
            className={cn(SUNKEN_INPUT_CLASS, !form.founder_bio && EMPTY_FIELD_CLASS)}
          />
        </div>
      </SectionCard>

      <SectionCard
        icon={Shield}
        title="Guardrails"
        open={openGroups.has("guardrails")}
        onToggle={() => toggleGroup("guardrails")}
      >
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Claims to Avoid</FieldLabel>
          <TagInput values={form.claims_to_avoid} onChange={(next) => setField("claims_to_avoid", next)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Target Regions</FieldLabel>
          <TagInput values={form.target_regions} onChange={(next) => setField("target_regions", next)} />
        </div>
      </SectionCard>

      <SectionCard
        icon={Palette}
        title="Visual Identity"
        open={openGroups.has("visual-identity")}
        onToggle={() => toggleGroup("visual-identity")}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ColorField
            id="brand-primary-color"
            label="Primary Color"
            value={form.primary_color_hex}
            onChange={(next) => setField("primary_color_hex", next)}
          />
          <ColorField
            id="brand-secondary-color"
            label="Secondary Color"
            value={form.secondary_color_hex}
            onChange={(next) => setField("secondary_color_hex", next)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="brand-font">Font Preference</FieldLabel>
          <Input
            id="brand-font"
            value={form.font_preference ?? ""}
            onChange={(e) => setField("font_preference", e.target.value || null)}
            placeholder={EMPTY_PLACEHOLDER}
            className={cn(SUNKEN_INPUT_CLASS, !form.font_preference && EMPTY_FIELD_CLASS)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Product Screenshots</FieldLabel>
          <div className="flex flex-wrap gap-3">
            {form.product_screenshots.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt={`Product screenshot ${i + 1}`}
                className="h-20 w-32 rounded-lg border border-input object-cover"
              />
            ))}
            {form.product_screenshots.length < 6 && (
              <label>
                <span
                  className={cn(
                    "flex h-20 w-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border text-xs text-muted-foreground",
                    SUNKEN_INPUT_CLASS,
                    EMPTY_FIELD_CLASS,
                    uploadingScreenshot && "pointer-events-none opacity-50"
                  )}
                >
                  {uploadingScreenshot ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Add screenshot
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleUpload("screenshot", file);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
        </div>
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
            <DialogTitle>Re-analyze your brand?</DialogTitle>
            <DialogDescription>
              This re-scans your website and refreshes any field you haven&apos;t manually
              edited. Fields you&apos;ve edited yourself are never overwritten. Uses{" "}
              {reanalyzeCost} agent credits.
            </DialogDescription>
          </DialogHeader>
          {reanalyzeError && <ErrorMessage message={reanalyzeError} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReanalyzeOpen(false)}
              disabled={reanalyzing}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleReanalyze} disabled={reanalyzing}>
              {reanalyzing && <Loader2 className="animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Matches buttonVariants({ variant: "outline", size: "sm" }) exactly (see
// components/ui/button.tsx) — duplicated as a class string rather than
// rendered through <Button> because this one has to be a <label> element
// (native file inputs only open on a real click on their own <label>, a
// <Button onClick={...}> can't proxy that click to a sibling input).
const buttonOutlineSmClass =
  "group/button inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[0.8rem] font-medium whitespace-nowrap transition-all hover:bg-muted hover:text-foreground";
