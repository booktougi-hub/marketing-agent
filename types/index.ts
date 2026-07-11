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
  | "strategy_pending"
  | "awaiting_approval"
  | "active"
  | "paused"
  | "error"
  | "deleted";

export type AppTone = "casual" | "professional" | "technical";

export interface AppDna {
  name: string;
  tagline: string;
  problem: string;
  features: string[];
  target_audience: string;
  pricing: string;
  competitors: string[];
  tone: AppTone;
  additional_urls: string[];
}

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
  icon_url: string | null;
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
  manual_research_count_this_week: number;
  manual_research_reset_at: string | null;
  last_manual_research_at: string | null;
  first_research_completed: boolean;
  first_research_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

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
