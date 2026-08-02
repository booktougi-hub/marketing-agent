// Shared TypeScript types for every table in SCHEMA.md.
// Do not define table types inline in component files — import from here.

// ---------------------------------------------------------------------------
// workspaces
// ---------------------------------------------------------------------------

export type PlanTier = "free" | "solo" | "growth" | "builder" | "agency";

export interface Workspace {
  id: string;
  name: string;
  plan_tier: PlanTier;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  telegram_chat_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// workspace_members
// ---------------------------------------------------------------------------

export type WorkspaceRole = "owner" | "admin" | "viewer";

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
}

// ---------------------------------------------------------------------------
// apps
// ---------------------------------------------------------------------------

export type ProductType =
  | "developer_tool"
  | "mobile_app"
  | "web_app"
  | "saas"
  | "browser_extension"
  | "other";

export type AppStatus =
  | "pending"
  | "extracting"
  | "competitor_research_pending"
  | "diagnosis_pending"
  | "diagnosis_ready"
  | "strategy_pending"
  | "awaiting_approval"
  | "active"
  | "paused"
  | "error"
  | "deleted";

export type AppTone = "casual" | "professional" | "technical";

export interface AppStoreUrls {
  play_store: string | null;
  app_store: string | null;
}

export interface AppDnaTechSignals {
  model_or_stack_used: string | null;
  supported_formats_or_languages: string[];
  integrations: string[];
  architecture_description: string | null;
}

export interface AppDnaBusinessModel {
  narrative: string | null;
  // 'brand_information' when brand_information.pricing_summary already
  // existed for this app and this narrative just summarizes it (never a
  // second independent guess at plan/price numbers — see Part 3 note in
  // lib/dna-extraction-core.ts); 'dna_extraction_fallback' when
  // brand_information hadn't been extracted yet and DNA extraction inferred
  // this narrative directly from the crawled pages as a stand-in, to be
  // superseded once Brand Identity extraction actually runs. null source
  // means narrative is also null (nothing to attribute).
  source: "brand_information" | "dna_extraction_fallback" | null;
}

export interface AppDna {
  // Pipeline-critical fields — read directly (not just via
  // JSON.stringify(dna)) by trigger/topic-research.ts, trigger/problem-
  // discovery.ts, trigger/forum-opportunity-finder.ts, trigger/competitor-
  // gap-analysis.ts, trigger/seo-geo-audit.ts, lib/competitor-discovery.ts,
  // lib/discovery-query-builder.ts. Never rename/restructure these without
  // updating every one of those call sites.
  name: string;
  tagline: string;
  problem: string;
  target_audience: string;
  competitors: string[];
  tone: AppTone;
  additional_urls: string[];
  // Detected from the scraped site itself (Play Store / App Store badge
  // links, "Download on the App Store" style anchors) — independent of the
  // product_type dropdown a user picks at onboarding, which is often wrong
  // for landing pages that showcase a mobile app (e.g. product_type set to
  // "web_app" for a page whose only real product is a Play Store listing).
  // Optional because DNA rows extracted before this field existed won't
  // have it.
  app_store_urls?: AppStoreUrls;

  // Product Information page depth (2026-07-29). All optional because DNA
  // rows extracted before this change won't have them — UI and downstream
  // consumers must treat them as possibly absent, not just possibly empty.
  // `overview` is assembled in code from name/tagline/source_url (see
  // lib/dna-extraction-core.ts), not a second independent LLM extraction of
  // the same facts.
  overview?: { name: string; website: string; one_liner: string };
  what_it_does?: string | null; // detailed paragraph — must preserve specific numbers/named mechanisms verbatim, never paraphrased into vaguer language
  key_features?: string[]; // supersedes the old flat `features` field (renamed — had zero other consumers); each entry preserves exact figures/named things verbatim
  product_category?: string[]; // 2-4 category/vertical tags, e.g. ["AI security scanner", "developer security tool"]
  product_type?: string | null; // Claude's own inferred classification from the crawled site (SaaS / mobile app / browser extension / API / ...) — distinct from `apps.product_type`, the user-editable dropdown
  target_customers?: string | null; // more specific than target_audience — names actual tools/ecosystems/job functions the site mentions
  primary_cta?: string | null; // exact CTA text on the site, e.g. "Try it free"
  tech_signals?: AppDnaTechSignals; // only fields the site actually states — never inferred
  business_model?: AppDnaBusinessModel; // see Part 3: never a second independent structured pricing extraction
}

// One entry per top-level AppDna key the Product Information page lets the
// customer edit. Same shape/role as BrandExtractionSource — see that type's
// comment — kept as its own alias (not reused directly) since the two track
// different field sets on different tables.
export type DnaExtractionSource = Partial<Record<string, ExtractionFieldSource>>;

// Lifecycle of trigger/dna-reextraction.ts, the narrow Product-Information-
// page re-extraction — deliberately separate from `apps.status` (the main
// pipeline state machine) since this job never touches that column. Same
// role as BrandExtractionStatus for brand_information.
export type DnaReextractionStatus = "idle" | "processing" | "complete" | "error";

// Shape not finalized yet — populated when the settings screen is built.
// Untyped on purpose rather than guessing fields ahead of that work.
export type AppSettings = Record<string, unknown>;

export interface App {
  id: string;
  workspace_id: string;
  name: string | null;
  source_url: string;
  product_type: ProductType;
  dna: AppDna | null;
  // Tracks which top-level AppDna keys the customer has manually edited on
  // the Product Information page, so trigger/dna-reextraction.ts (unlike
  // the full pipeline's trigger/dna-extraction.ts, which always fully
  // overwrites dna) never silently clobbers a hand-edited field.
  dna_extraction_source: DnaExtractionSource | null;
  dna_reextraction_status: DnaReextractionStatus;
  dna_reextraction_error: string | null;
  // Set whenever a dna-reextraction run is in flight, cleared by that job's
  // own success/catch paths — lets trigger/job-watchdog.ts detect a run
  // that expired/crashed/was canceled before it ever reached its own catch
  // block, same pattern as brand_information.pending_run_id.
  dna_reextraction_pending_run_id: string | null;
  // Lifecycle of the on-demand "Research Competitors" action
  // (trigger/competitor-profile-research.ts) — same independent-status-
  // column pattern as dna_reextraction_* above, never touches `status`.
  competitor_profile_status: CompetitorProfileStatus;
  competitor_profile_error: string | null;
  competitor_profile_pending_run_id: string | null;
  competitor_profile_last_generated_at: string | null;
  icon_url: string | null;
  screenshot_url: string | null;
  status: AppStatus;
  is_paused: boolean;
  error_message: string | null;
  additional_context: string | null;
  doc_paths: string[] | null;
  reanalysis_credits_used: number;
  reanalysis_credits_reset_at: string | null;
  url_changed_at: string | null;
  deleted_at: string | null;
  app_settings: AppSettings;
  first_research_completed: boolean;
  first_research_completed_at: string | null;
  pending_run_id: string | null;
  pending_run_task: PendingRunTask | null;
  agent_credits_used_this_week: number;
  agent_credits_reset_at: string | null;
  // Deprecated 2026-07-29 — superseded by agent_action_cooldowns below (one
  // shared cooldown blocked every unrelated action type together, which
  // wasn't the intent). Column kept on the table but no longer written to;
  // safe to drop in a later migration.
  last_agent_action_at: string | null;
  // { [actionType]: ISO timestamp of the last time that action ran } — see
  // lib/agentCredits.ts's AgentActionCooldowns/getCooldownHoursRemaining for
  // the typed shape and per-action-type cooldown logic.
  agent_action_cooldowns: Record<string, string> | null;
  preferred_research_day: ResearchDay;
  preferred_research_hour: number;
  first_outreach_completed: boolean;
  icp_data: IcpData | null;
  icp_status: IcpStatus;
  diagnosis: DiagnosisData | null;
  diagnosis_status: DiagnosisStatus;
  diagnosis_refresh_status: DiagnosisRefreshStatus;
  last_diagnosis_refresh_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PendingRunTask =
  | "dna-extraction"
  | "competitor-research"
  | "diagnosis"
  | "strategy-generation"
  | "content-generation"
  | "icp-inference"
  | "outreach-preview";

// ---------------------------------------------------------------------------
// Diagnosis-first pipeline — real competitor research feeds a written growth
// diagnosis (trigger/diagnosis.ts), which strategy-generation then builds
// the strategy around, instead of generating personas/pillars from DNA alone.
// ---------------------------------------------------------------------------

export type DiagnosisStatus = "pending" | "shown" | "acknowledged";

export type DiagnosisBottleneck = "awareness" | "trust" | "activation" | "distribution";

export type DiagnosisConfidence = "high" | "medium" | "low";

export interface DiagnosisData {
  bottleneck: DiagnosisBottleneck;
  reasoning: string;
  competitive_context: string;
  primary_lever: string;
  confidence: DiagnosisConfidence;
}

export interface CompetitorPricingTier {
  tier_name: string;
  price: string;
  key_inclusions: string;
}

export interface CompetitorCompetitiveImplications {
  where_they_win: string | null;
  where_we_win: string | null;
  opportunities: string | null;
  threats: string | null;
}

export type CompetitorProfileStatus = "idle" | "processing" | "complete" | "error";

export interface CompetitorResearch {
  id: string;
  app_id: string;
  workspace_id: string;
  competitor_name: string | null;
  competitor_url: string | null;
  scraped_summary: string | null;
  pricing_notes: string | null;
  positioning_notes: string | null;
  created_at: string;
  // Deep profile fields (2026-07-29), filled in by the on-demand "Research
  // Competitors" action (trigger/competitor-profile-research.ts) — adapted
  // from the .claude/skills/competitor-profiling template, Firecrawl-only
  // (no SEO/backlink/review data, which would need a DataForSEO-equivalent
  // integration this project doesn't have). Optional because rows from the
  // original onboarding discovery (trigger/competitor-research.ts) — or a
  // competitor whose deep research hasn't run yet — won't have them.
  tagline?: string | null;
  founded_year?: string | null;
  headquarters?: string | null;
  team_size_estimate?: string | null;
  target_audience?: string | null;
  positioning_angle?: string | null;
  key_messaging_themes?: string[];
  core_features?: string[];
  notable_differentiators?: string[];
  integrations?: string[];
  pricing_tiers?: CompetitorPricingTier[];
  billing_notes?: string | null;
  free_trial?: string | null;
  strengths?: string[];
  weaknesses?: string[];
  competitive_implications?: CompetitorCompetitiveImplications;
  profile_generated_at?: string | null;
}

// ---------------------------------------------------------------------------
// diagnosis_proposals — quarterly background re-check of the competitive
// landscape (trigger/diagnosis-refresh-check.ts), reviewed via the same
// acknowledge/approve UI pattern as the original diagnosis.
// ---------------------------------------------------------------------------

export type DiagnosisRefreshStatus = "none" | "proposal_ready" | "reviewed";

export type DiagnosisProposalStatus = "pending" | "accepted" | "dismissed";

export interface DiagnosisProposal {
  id: string;
  app_id: string;
  workspace_id: string;
  change_summary: string;
  proposed_diagnosis: DiagnosisData;
  status: DiagnosisProposalStatus;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Outreach onboarding — ICP inference + one-time prospect preview
// (trigger/icp-inference.ts, trigger/outreach-preview.ts)
// ---------------------------------------------------------------------------

export type IcpStatus = "pending_review" | "approved" | "needs_adjustment";

export interface ApolloFilters {
  person_titles: string[];
  person_seniorities: string[];
  organization_num_employees_ranges: string[];
  organization_industries: string[];
  // Only populated when DNA/category makes a specific tech stack inferable
  // (e.g. "companies using Shopify") — omitted rather than guessed otherwise.
  technologies: string[];
}

export interface IcpData {
  summary: string;
  apollo_filters: ApolloFilters;
}

// Freeform adjustments a founder submits via "Adjust this" — passed back
// into icp-inference as additional context for a re-run, not persisted as
// its own column (folded into the next icp_data.summary/apollo_filters).
export interface IcpAdjustment {
  company_stage: "bootstrapped" | "funded" | "established" | null;
  exclusions: string | null;
  geographic_focus: string | null;
  persona_feedback: string | null;
}

export const RESEARCH_DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
export type ResearchDay = (typeof RESEARCH_DAYS)[number];

// ---------------------------------------------------------------------------
// strategies
// ---------------------------------------------------------------------------

export type StrategyStatus = "draft" | "active" | "superseded";

export interface StrategyPersona {
  name: string;
  role: string;
  pain_points: string[];
  where_they_hang_out: string[];
}

export interface StrategyContentPillar {
  name: string;
  description: string;
  example_topics: string[];
}

export interface Strategy {
  id: string;
  app_id: string;
  workspace_id: string;
  personas: StrategyPersona[] | null;
  content_pillars: StrategyContentPillar[] | null;
  tone: string | null;
  channels: string[] | null;
  twitter_strategy: string | null;
  linkedin_strategy: string | null;
  status: StrategyStatus;
  version: number;
  // Snapshot of apps.diagnosis at the moment this strategy was generated —
  // apps.diagnosis can be overwritten by a later diagnosis run, so this is
  // what actually stays queryable alongside the strategy that used it.
  diagnosis_snapshot: DiagnosisData | null;
  built_from_diagnosis: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// content
// ---------------------------------------------------------------------------

export type ContentPlatform =
  | "twitter"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "devto"
  | "youtube";

export type ContentType = "post" | "thread" | "article" | "video";

export type ContentStatus =
  | "scheduled"
  | "published"
  | "failed"
  | "skipped"
  | "draft";

export interface Content {
  id: string;
  app_id: string;
  workspace_id: string;
  strategy_id: string | null;
  platform: ContentPlatform;
  content_type: ContentType;
  body: string;
  pillar: string | null;
  image_prompt: string | null;
  media_url: string | null;
  status: ContentStatus;
  scheduled_at: string | null;
  published_at: string | null;
  external_post_id: string | null;
  retry_count: number;
  error_message: string | null;
  source_research_finding_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// platform_credentials
// ---------------------------------------------------------------------------

export type CredentialsPlatform =
  | "twitter"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "devto"
  | "posteverywhere";

// Decrypted shape of the `credentials` jsonb column. The column itself
// only ever stores this shape AES-256 encrypted — never persist the
// decrypted object.
export interface PlatformCredentialsPayload {
  access_token: string;
  refresh_token: string;
  api_key: string;
  profile_key: string;
}

export interface PlatformCredentials {
  id: string;
  workspace_id: string;
  platform: CredentialsPlatform;
  credentials: string; // encrypted blob, not PlatformCredentialsPayload
  is_active: boolean;
  connected_at: string;
  expires_at: string | null;
}

// ---------------------------------------------------------------------------
// analytics
// ---------------------------------------------------------------------------

export interface Analytics {
  id: string;
  content_id: string;
  app_id: string;
  workspace_id: string;
  platform: ContentPlatform;
  impressions: number;
  clicks: number;
  likes: number;
  shares: number;
  comments: number;
  link_clicks: number;
  revenue_attributed: number;
  utm_source: string | null;
  utm_campaign: string | null;
  fetched_at: string;
}

// ---------------------------------------------------------------------------
// cold_email_prospects
// ---------------------------------------------------------------------------

export type ProspectSource = "apollo" | "ad_landing_page" | "organic";

export type ProspectStatus =
  | "researched"
  | "verified"
  | "personalised"
  | "approved"
  | "sent"
  | "replied"
  | "unsubscribed"
  | "bounced";

export interface ColdEmailProspect {
  id: string;
  workspace_id: string;
  app_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  title: string | null;
  linkedin_url: string | null;
  company_news: string | null;
  email_verified: boolean;
  source: ProspectSource;
  status: ProspectStatus;
  personalised_email: string | null;
  personalisation_score: number | null;
  is_preview: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// email_interactions
// ---------------------------------------------------------------------------

export type EmailType = "initial" | "follow_up_1" | "follow_up_2" | "breakup";

export interface EmailInteraction {
  id: string;
  prospect_id: string;
  workspace_id: string;
  app_id: string;
  email_type: EmailType;
  subject: string | null;
  body: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  instantly_id: string | null;
  created_at: string;
  actioned_at: string | null;
}

// ---------------------------------------------------------------------------
// research_findings
// ---------------------------------------------------------------------------

export type ResearchStream =
  | "topic_research"
  | "problem_discovery"
  | "creator_research"
  | "forum_opportunities"
  | "competitor_gap";

export type ResearchStatus = "active" | "acted_on" | "dismissed";

export interface ResearchFinding {
  id: string;
  workspace_id: string;
  app_id: string;
  stream: ResearchStream;
  findings: unknown;
  status: ResearchStatus;
  week_of: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// forum_search_seeds
// ---------------------------------------------------------------------------

export interface ForumSearchSeed {
  id: string;
  workspace_id: string;
  app_id: string;
  keyword: string;
  source_research_finding_id: string | null;
  consumed_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// optimization_cycles
// ---------------------------------------------------------------------------

export interface OptimizationCycle {
  id: string;
  app_id: string;
  workspace_id: string;
  previous_strategy_id: string | null;
  new_strategy_id: string | null;
  analysis: string | null;
  confidence_score: number | null;
  changes_applied: boolean;
  rolled_back: boolean;
  week_of: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// onboarding_findings — first of the planned "Audits" family
// (trigger/onboarding-audit.ts). See PHASES.md Notes Log (2026-07-22).
// ---------------------------------------------------------------------------

export type OnboardingFindingSeverity = "high" | "medium" | "low";

export type OnboardingFindingStatus = "open" | "fixed" | "not_applicable";

export interface OnboardingFinding {
  id: string;
  app_id: string;
  workspace_id: string;
  // Free text, not a fixed enum — see SCHEMA.md's migration note on this table.
  finding_type: string;
  severity: OnboardingFindingSeverity;
  issue_description: string;
  suggested_fix: string;
  status: OnboardingFindingStatus;
  created_at: string;
}

// ---------------------------------------------------------------------------
// churn_findings — second of the "Audits" family (trigger/churn-audit.ts).
// Same shape as onboarding_findings by design; see SCHEMA.md for why it's a
// separate table rather than a shared one.
// ---------------------------------------------------------------------------

export type ChurnFindingSeverity = "high" | "medium" | "low";

export type ChurnFindingStatus = "open" | "fixed" | "not_applicable";

export interface ChurnFinding {
  id: string;
  app_id: string;
  workspace_id: string;
  finding_type: string;
  severity: ChurnFindingSeverity;
  issue_description: string;
  suggested_fix: string;
  status: ChurnFindingStatus;
  created_at: string;
}

// ---------------------------------------------------------------------------
// cro_findings — third and last of the "Audits" family
// (trigger/cro-audit.ts). Same shape as onboarding_findings/churn_findings.
// ---------------------------------------------------------------------------

export type CroFindingSeverity = "high" | "medium" | "low";

export type CroFindingStatus = "open" | "fixed" | "not_applicable";

export interface CroFinding {
  id: string;
  app_id: string;
  workspace_id: string;
  finding_type: string;
  severity: CroFindingSeverity;
  issue_description: string;
  suggested_fix: string;
  status: CroFindingStatus;
  created_at: string;
}

// ---------------------------------------------------------------------------
// pricing_findings — fourth of the "Audits" family (trigger/pricing-audit.ts).
// Same shape as the other three. Audits the end user's own app's pricing,
// not this SaaS's own pricing.
// ---------------------------------------------------------------------------

export type PricingFindingSeverity = "high" | "medium" | "low";

export type PricingFindingStatus = "open" | "fixed" | "not_applicable";

export interface PricingFinding {
  id: string;
  app_id: string;
  workspace_id: string;
  finding_type: string;
  severity: PricingFindingSeverity;
  issue_description: string;
  suggested_fix: string;
  status: PricingFindingStatus;
  created_at: string;
}

// ---------------------------------------------------------------------------
// seo_geo_scores / seo_geo_findings — SEO & GEO scoring engine (see
// SCORING.md). Two independent evaluation tracks, never blended into one
// score. Both tracks are built and populated by trigger/seo-geo-audit.ts.
// ---------------------------------------------------------------------------

export type SeoGeoTrack = "seo" | "geo";

export type SeoDimension = "retrievability" | "off_page";
export type GeoDimension = "content_quality" | "structure" | "freshness";

export interface SeoDimScores {
  retrievability: number;
  off_page: number;
}

export interface GeoDimScores {
  content_quality: number;
  structure: number;
  freshness: number;
}

export type EvidenceTier = 1 | 2 | 3;

export interface SeoGeoCheckResult {
  pass: boolean | null; // null when not_measurable
  value: unknown;
  confidence: number;
  measurable: boolean;
}

export type SeoGeoCheckResultMap = Record<string, SeoGeoCheckResult>;

export interface SeoGeoScore {
  id: string;
  app_id: string;
  workspace_id: string;
  page_url: string | null;
  page_id: string | null;
  content_id: string | null;
  track: SeoGeoTrack;
  score: number;
  dim_scores: SeoDimScores | GeoDimScores;
  check_results: SeoGeoCheckResultMap;
  run_at: string;
}

export type SeoGeoFindingStatus = "open" | "applied" | "skipped";

export type SeoGeoRemediation =
  | { type: "diff"; before: string; after: string; section: string }
  | { type: "pr"; files: unknown[] }
  | { type: "route_to_forum"; reason: string }
  | { type: "technical"; instruction: string; snippet?: string };

export interface SeoGeoFinding {
  id: string;
  app_id: string;
  workspace_id: string;
  page_url: string | null;
  page_id: string | null;
  content_id: string | null;
  track: SeoGeoTrack;
  check_id: string;
  dimension: string;
  evidence_tier: EvidenceTier;
  expected_gain: number;
  title: string;
  explanation: string;
  confidence_label: string;
  remediation: SeoGeoRemediation | null;
  status: SeoGeoFindingStatus;
  skip_count: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// brand_information
// ---------------------------------------------------------------------------

export type ExtractionFieldSource = "auto" | "manual";

export type BrandExtractionStatus = "idle" | "processing" | "complete" | "error";

export interface BrandKeyStat {
  label: string;
  value: string;
  source_url: string | null;
}

export interface BrandPricingPlan {
  plan_name: string;
  price: string;
  billing_period: string | null;
}

// Free-form: keys are whichever platform names extraction or the customer
// used ("twitter", "linkedin", "github", ...), not a fixed enum.
export type BrandSocialHandles = Record<string, string>;

// One entry per top-level brand_information column that can be auto-filled.
// Keys are BrandInformation field names (as a loose Record rather than every
// literal key, since not every column is extractable/trackable this way —
// e.g. the metadata columns themselves never appear here).
export type BrandExtractionSource = Partial<Record<string, ExtractionFieldSource>>;

export interface BrandInformation {
  id: string;
  app_id: string;
  workspace_id: string;

  // Core identity
  brand_name: string | null;
  one_liner: string | null;
  category: string | null;
  website_url: string | null;
  logo_url: string | null;

  // Positioning
  problem_solved: string | null;
  target_customer: string | null;
  differentiator: string | null;
  known_competitors: string[] | null;

  // Voice & tone
  tone_descriptors: string[] | null;
  words_to_avoid: string[] | null;
  writing_sample: string | null;

  // Proof points
  key_stats: BrandKeyStat[] | null;
  testimonial: string | null;
  testimonial_source: string | null;
  pricing_summary: BrandPricingPlan[] | null;

  // Channels & handles
  social_handles: BrandSocialHandles | null;
  github_repo_url: string | null;

  // Founder context (optional)
  founder_name: string | null;
  founder_bio: string | null;

  // Guardrails
  claims_to_avoid: string[] | null;
  target_regions: string[] | null;

  // Visual identity
  primary_color_hex: string | null;
  secondary_color_hex: string | null;
  font_preference: string | null;
  product_screenshots: string[] | null;

  // Metadata
  extraction_source: BrandExtractionSource | null;
  extraction_status: BrandExtractionStatus;
  extraction_error: string | null;
  // Set whenever a brand-info-extraction run is in flight, cleared by that
  // job's own success/catch paths — lets trigger/job-watchdog.ts detect a
  // run that expired/crashed/was canceled before it ever reached its own
  // catch block, the same way it already does for apps.pending_run_id.
  pending_run_id: string | null;
  last_analyzed_at: string | null;
  updated_at: string;
}

// Right-side chat panel (components/dashboard/ChatPanel.tsx) — persistent
// across the whole dashboard shell, not tied to a single app page. "text"
// covers both a plain answer and an off-topic redirect (the coordinator
// distinguishes them server-side; the panel renders both as the same
// bubble). "confirm_action" is for mutating actions the coordinator wants
// to run — rendered inline via AuditFindingCard rather than a bespoke
// confirmation component (see components/apps/audit-finding-card.tsx).
export type ChatMessageRole = "user" | "assistant";
export type ChatMessageKind = "text" | "confirm_action";

// Structurally identical to AuditFindingCard's own severity/status unions
// (components/apps/audit-finding-card.tsx) — same pattern every other
// finding domain in this file follows (OnboardingFindingSeverity,
// ChurnFindingSeverity, ...), so this threads straight into that card's
// props without types/index.ts importing from a component file.
export type ChatActionSeverity = "high" | "medium" | "low";
export type ChatActionStatus = "open" | "fixed" | "not_applicable";

export interface ChatConfirmAction {
  actionId: string;
  label: string;
  severity: ChatActionSeverity;
  description: string;
  effect: string;
  // "open" = awaiting the user's decision; "fixed" = confirmed/executed;
  // "not_applicable" = declined.
  status: ChatActionStatus;
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  kind: ChatMessageKind;
  content: string;
  confirmAction?: ChatConfirmAction;
  createdAt: string;
}

// chat_declines — one row per turn the coordinator declined as out of scope
// (see DECLINE_MARKER in lib/chat/system-prompt.ts for how app/api/chat/
// route.ts detects this without a second classification call). Write-only
// from the app's side for now; no UI reads this table yet — it exists so
// the scope boundary in SCOPED_SYSTEM_PROMPT can be tuned later from real
// usage instead of guessed upfront.
export interface ChatDecline {
  id: string;
  conversation_id: string;
  app_id: string;
  workspace_id: string;
  user_message: string;
  created_at: string;
}

// chat_action_suggestions — one row per confirm card rendered by a
// "proactive offer" tool (today just add_content_to_plan — see
// PROACTIVE_OFFER_TOOLS in lib/chat/tools.ts), logged 'offered' when the
// card is shown and flipped to 'confirmed'/'dismissed' once the founder
// acts on it. Same write-mostly, reviewed-later purpose as ChatDecline
// above. No UI reads this table yet.
export type ChatActionSuggestionStatus = "offered" | "confirmed" | "dismissed";

export interface ChatActionSuggestion {
  id: string;
  conversation_id: string;
  app_id: string;
  workspace_id: string;
  pending_action_id: string;
  tool_name: string;
  status: ChatActionSuggestionStatus;
  created_at: string;
}
