# SCHEMA.md — Database Schema Reference

> Every table, every column, every RLS policy.
> Claude Code must read this before writing any Supabase query.
> Never guess column names. Always reference this file.

---

## Core Rules

1. **Every table has a `workspace_id` column.** Every query filters by it.
2. **RLS is enabled on every table** before any data is written or read.
3. **Use UUIDs** for all primary keys via `uuid_generate_v4()`.
4. **Use `timestamp with time zone`** for all timestamps. Never `timestamp` without timezone.
5. The `supabaseAdmin` (service role) client is used in all server-side code and Trigger.dev jobs.
6. The browser `supabase` client is used in React components only.

---

## Setup SQL — Run First

```sql
-- Enable UUID extension
create extension if not exists "uuid-ossp";
```

---

## Table: workspaces

The top-level billing and isolation unit. Every user belongs to exactly one workspace at MVP.

```sql
create table workspaces (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null default 'My Workspace',
  plan_tier    text not null default 'free',  -- 'free' | 'solo' | 'growth' | 'builder' | 'agency'
  stripe_customer_id      text,
  stripe_subscription_id  text,
  telegram_chat_id        text,  -- set when user connects Telegram bot
  created_at   timestamp with time zone default now(),
  updated_at   timestamp with time zone default now()
);

alter table workspaces enable row level security;

create policy "workspace_select" on workspaces
  for all using (
    id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );
```

**Column notes:**
- `plan_tier` — enforced in API routes to gate features per plan
- `telegram_chat_id` — populated when user completes Telegram bot setup in settings
- `stripe_customer_id` — set on first Stripe checkout, used for billing management

---

## Table: workspace_members

Junction table linking users to workspaces. At V1 every user has exactly one workspace and one membership record.

```sql
create table workspace_members (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid references workspaces(id) on delete cascade not null,
  user_id      uuid references auth.users(id) on delete cascade not null,
  role         text not null default 'owner',  -- 'owner' | 'admin' | 'viewer' (admin/viewer used in V6)
  created_at   timestamp with time zone default now(),
  unique(workspace_id, user_id)
);

alter table workspace_members enable row level security;

create policy "members_select" on workspace_members
  for all using (user_id = auth.uid());
```

---

## Table: apps

Each app the user wants to market. Multiple apps per workspace from Solo tier onwards.

```sql
create table apps (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  name            text,                          -- populated from DNA extraction
  source_url      text not null,                 -- the URL the user pasted
  product_type    text default 'other',          -- 'developer_tool' | 'mobile_app' | 'web_app' | 'saas' | 'browser_extension' | 'other'
  dna             jsonb,                         -- extracted DNA object (see DNA schema below)
  icon_url        text,                          -- app's favicon/logo, resolved during DNA extraction; null falls back to a first-letter avatar in the UI
  status          text not null default 'pending',
  -- status values: 'pending' | 'extracting' | 'competitor_research_pending' | 'diagnosis_pending' | 'diagnosis_ready' | 'strategy_pending' | 'awaiting_approval' | 'active' | 'paused' | 'error' | 'deleted'
  is_paused       boolean not null default false,
  error_message   text,                          -- populated if status = 'error'
  additional_context text null,                  -- optional free-text context typed by the user at onboarding
  doc_paths       text[],                        -- Supabase Storage paths (bucket 'app-docs') for uploaded supporting docs
  reanalysis_credits_used      integer default 0,             -- how many manual re-analyses (re-running DNA extraction) used this billing period
  reanalysis_credits_reset_at  timestamp with time zone,      -- when reanalysis_credits_used resets to 0
  url_changed_at  timestamp with time zone,      -- set when the user edits source_url after initial DNA extraction
  deleted_at      timestamp with time zone,      -- soft delete — set instead of removing the row; excluded by RLS (see policy below)
  app_settings    jsonb default '{}'::jsonb,     -- scheduling and notification preferences (settings screen)
  first_research_completed        boolean default false,     -- true once the app's first research run (any stream) has been triggered
  first_research_completed_at     timestamp with time zone,  -- when first_research_completed was set true, for display copy ("completed on [date]")
  pending_run_id  text,                          -- Trigger.dev run id of the in-flight pipeline job for this app (dna-extraction/strategy-generation/content-generation), if any
  pending_run_task text,                         -- which task pending_run_id refers to; null whenever pending_run_id is null
  agent_credits_used_this_week integer default 0,      -- unified manual-agent-action credits used this week, rate-limited per plan (see lib/agentCredits.ts)
  agent_credits_reset_at       timestamp with time zone,  -- when agent_credits_used_this_week resets to 0
  last_agent_action_at         timestamp with time zone,  -- timestamp of the most recent manual agent action of any type (6h cooldown applies across all action types, not per-type)
  preferred_research_day       text default 'sunday',    -- UTC day name the weekly research scan targets for this app (lib/schedule.ts RESEARCH_DAYS)
  preferred_research_hour      integer default 23,       -- UTC hour (0-23) the weekly research scan targets for this app
  first_outreach_completed boolean not null default false,  -- true once the app's first outreach ICP+preview run has been triggered
  icp_data        jsonb,                         -- { summary: string, apollo_filters: {...} } from trigger/icp-inference.ts
  icp_status      text not null default 'pending_review',  -- 'pending_review' | 'approved' | 'needs_adjustment'
  diagnosis       jsonb,                         -- { bottleneck, reasoning, competitive_context, primary_lever, confidence } from trigger/diagnosis.ts
  diagnosis_status text not null default 'pending',  -- 'pending' | 'shown' | 'acknowledged'
  diagnosis_refresh_status  text not null default 'none',  -- 'none' | 'proposal_ready' | 'reviewed' — see diagnosis_proposals below
  last_diagnosis_refresh_at timestamp with time zone,      -- when trigger/diagnosis-refresh-check.ts last actually ran for this app (set whether or not it produced a proposal), so the quarterly scan knows not to re-check early
  created_at      timestamp with time zone default now(),
  updated_at      timestamp with time zone default now()
);

alter table apps enable row level security;

create policy "apps_all" on apps
  for all using (
    deleted_at is null
    and workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_apps_workspace_id on apps(workspace_id);
create index idx_apps_status on apps(status);
```

> **Migration note (2026-07-05):** `reanalysis_credits_used`, `reanalysis_credits_reset_at`,
> `url_changed_at`, `deleted_at`, and `app_settings` were added after the table already
> existed in production, via `add_settings_columns_to_apps`. The `apps_all` RLS policy
> was updated in a separate migration (`add_soft_delete_filter_to_apps_policy`) to add
> `deleted_at is null` to its `USING` clause, so every existing query automatically
> excludes soft-deleted apps — no application code changes required for that part.
> `additional_context`, `doc_paths`, `product_type`, and `is_paused` already existed
> before this change; they're listed above in their original positions.

> **Migration note (2026-07-07):** `manual_research_count_this_week`, `manual_research_reset_at`,
> `last_manual_research_at`, and `first_research_completed` were added via
> `add_manual_research_rate_limit_columns_to_apps`, in preparation for rate-limited
> manual research triggers. No RLS change needed — `apps_all` already covers new
> columns on the same row.
>
> `first_research_completed_at` was added later the same day, via
> `add_first_research_completed_at_to_apps`, once the Research page needed a real
> date for "your first research scan completed on [date]" — `first_research_completed`
> alone is just a boolean gate with no timestamp. Set in `/api/apps/[id]/approve`
> alongside `first_research_completed = true`.
>
> **Migration note (2026-07-11):** `icon_url` was added via `add_icon_url_to_apps`.
> Populated by `/trigger/dna-extraction.ts`, which resolves the site's actual
> favicon/apple-touch-icon/`og:image` (in that preference order) during DNA
> extraction — see `lib/favicon.ts`. Every candidate URL is verified reachable
> (HTTP 200 + an `image/*` content type) before being saved, so the column is
> either a real, loadable image or null; the UI's `AppIcon` component falls back
> to a first-letter avatar either way (null, or an image that later 404s).
>
> **Migration note (2026-07-11):** `pending_run_id` and `pending_run_task` were
> added via `add_pending_run_tracking_to_apps`. Every call site that triggers
> `dna-extraction`, `strategy-generation`, or `content-generation` sets these to
> the returned run handle's id and the task name; each of those three tasks
> clears them (to null) on both its success and its existing catch-block
> failure path. `trigger/job-watchdog.ts` runs every 5 minutes and checks any
> row where `pending_run_id` is still set against Trigger.dev's actual run
> status — this exists because a run can be `CANCELED`/`EXPIRED`/`CRASHED`/
> `SYSTEM_FAILURE`d without the task's own code ever executing (no worker ever
> claimed it, or the worker died mid-run), in which case the task's own
> catch-block error handling never gets a chance to run and the app row would
> otherwise sit in a stale in-progress state forever. No RLS change needed —
> `apps_all` already covers new columns on the same row.
>
> **Migration note (2026-07-13):** `manual_research_count_this_week`,
> `manual_research_reset_at`, and `last_manual_research_at` were replaced via
> `add_unified_agent_credit_system_to_apps` with `agent_credits_used_this_week`,
> `agent_credits_reset_at`, and `last_agent_action_at` — the single-purpose
> manual-research rate limit became a unified Agent Action Credit system
> usable by every manually-triggerable agent (topic/problem research, forum
> opportunity scan, competitor gap analysis, and — once built — cold email
> prospecting), each action costing a different number of credits per
> `lib/agentCredits.ts`. Existing counts/timestamps were copied over before
> the old columns were dropped, so no app lost its in-progress weekly state.
> `preferred_research_day` and `preferred_research_hour` were added in the
> same migration — per-app UTC day/hour the weekly research scan
> (`trigger/weekly-research-scan.ts`) targets for that app; see that file for
> how the cron reads them. No RLS change needed — `apps_all` already covers
> new columns on the same row.
>
> **Migration note (2026-07-14):** `first_outreach_completed`, `icp_data`,
> and `icp_status` were added via `add_outreach_onboarding_columns`, and
> `cold_email_prospects.is_preview` (see that table) in the same migration —
> part of the V3→V1 pull-forward documented in PHASES.md's Notes Log
> (2026-07-14). `trigger/icp-inference.ts` writes `icp_data` (both the
> founder-facing summary and the structured Apollo filters) and sets
> `icp_status = 'pending_review'`; `trigger/outreach-preview.ts` sets
> `first_outreach_completed = true` once its 5-prospect preview batch is
> saved. No RLS change needed — `apps_all` already covers new columns on the
> same row.
>
> **Retroactively documented (2026-07-14, alongside the migration below):**
> `diagnosis` and `diagnosis_status` have existed since the diagnosis-first
> pipeline redesign (`trigger/diagnosis.ts`, `PATCH /api/apps/[id]/acknowledge-diagnosis`)
> but were never added to this file — a pre-existing SCHEMA.md gap, same
> pattern as `competitor_research` below. Backfilled here while adding the
> quarterly refresh columns since they're the same diagnosis-status story.
>
> **Migration note (2026-07-23):** `diagnosis_refresh_status` and
> `last_diagnosis_refresh_at` were added via
> `add_diagnosis_refresh_and_proposals` (same migration that created
> `diagnosis_proposals` below) — `trigger/diagnosis-refresh-check.ts` runs
> quarterly per app (or on-demand via the agent-action credit system) and
> writes both: `last_diagnosis_refresh_at` every time it actually runs
> (whether or not it found anything), `diagnosis_refresh_status =
> 'proposal_ready'` only when it saved a `diagnosis_proposals` row. No RLS
> change needed — `apps_all` already covers new columns on the same row.

**DNA JSON structure (saved in `dna` column):**
```json
{
  "name": "string",
  "tagline": "string",
  "problem": "string",
  "features": ["string"],
  "target_audience": "string",
  "pricing": "string",
  "competitors": ["string"],
  "tone": "casual | professional | technical",
  "additional_urls": ["string"]
}
```

---

## Table: strategies

The marketing strategy generated from the DNA. One active strategy per app at any time. Previous versions retained.

```sql
create table strategies (
  id              uuid primary key default uuid_generate_v4(),
  app_id          uuid references apps(id) on delete cascade not null,
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  personas        jsonb,           -- array of persona objects
  content_pillars jsonb,           -- array of pillar objects
  tone            text,            -- detailed tone description
  channels        text[],          -- active channels e.g. ['twitter', 'linkedin']
  twitter_strategy  text,
  linkedin_strategy text,
  status          text default 'draft',   -- 'draft' | 'active' | 'superseded'
  version         integer default 1,
  created_at      timestamp with time zone default now()
);

alter table strategies enable row level security;

create policy "strategies_all" on strategies
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_strategies_app_id on strategies(app_id);
create index idx_strategies_status on strategies(status);
```

**Personas JSON structure:**
```json
[{
  "name": "string",
  "role": "string",
  "pain_points": ["string"],
  "where_they_hang_out": ["string"]
}]
```

**Content pillars JSON structure:**
```json
[{
  "name": "string",
  "description": "string",
  "example_topics": ["string"]
}]
```

---

## Table: content

Every generated post for every platform. The publisher cron reads from this table.

```sql
create table content (
  id              uuid primary key default uuid_generate_v4(),
  app_id          uuid references apps(id) on delete cascade not null,
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  strategy_id     uuid references strategies(id) on delete set null,
  platform        text not null,   -- 'twitter' | 'linkedin' | 'instagram' | 'facebook' | 'devto' | 'youtube'
  content_type    text default 'post',  -- 'post' | 'thread' | 'article' | 'video'
  body            text not null,
  pillar          text,            -- which content pillar this belongs to
  image_prompt    text,            -- used by media agent to generate image (V2+)
  media_url       text,            -- populated after image generation (V2+)
  status          text not null default 'scheduled',
  -- status: 'scheduled' | 'published' | 'failed' | 'skipped' | 'draft'
  scheduled_at    timestamp with time zone,
  published_at    timestamp with time zone,
  external_post_id text,           -- ID returned by PostEverywhere after publishing
  retry_count     integer default 0,
  error_message   text,
  source_research_finding_id uuid references research_findings(id) on delete set null,  -- set when this post was created from a research finding (Topics/Problems/Competitors "use this" actions)
  created_at      timestamp with time zone default now()
);

alter table content enable row level security;

create policy "content_all" on content
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_content_workspace_id on content(workspace_id);
create index idx_content_app_id on content(app_id);
create index idx_content_status on content(status);
create index idx_content_scheduled_at on content(scheduled_at);
create index idx_content_platform on content(platform);
create index idx_content_source_research_finding_id on content(source_research_finding_id);
```

> **Migration note (2026-07-11):** `source_research_finding_id` was added via
> `add_source_research_finding_id_to_content`, for `POST /api/apps/[id]/content/from-research`
> — the shared action behind the Research page's "Use This Topic" / "Use In Next Post"
> buttons — so a generated draft can be traced back to the finding that produced it.
> Nullable and `on delete set null` since ordinary content-generation posts (the bulk
> weekly batch) have no source finding. `content_all` RLS already covers it — same
> row, no policy change needed.

---

## Table: platform_credentials

Stores OAuth tokens and API keys for each platform per workspace. Always encrypted before storage.

```sql
create table platform_credentials (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  platform        text not null,   -- 'twitter' | 'linkedin' | 'instagram' | 'facebook' | 'devto' | 'posteverywhere'
  credentials     jsonb not null,  -- encrypted JSON blob containing tokens/keys
  is_active       boolean default true,
  connected_at    timestamp with time zone default now(),
  expires_at      timestamp with time zone,
  unique(workspace_id, platform)
);

alter table platform_credentials enable row level security;

create policy "credentials_all" on platform_credentials
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_credentials_workspace_id on platform_credentials(workspace_id);
```

**Credentials JSON structure (before encryption):**
```json
{
  "access_token": "string",
  "refresh_token": "string",
  "api_key": "string",
  "profile_key": "string"
}
```

> **IMPORTANT:** The `credentials` column stores AES-256 encrypted data only. Never store raw tokens. The encryption key lives in `CREDENTIALS_ENCRYPTION_KEY` environment variable.

---

## Table: analytics

Engagement data pulled from PostEverywhere after each post is published.

```sql
create table analytics (
  id              uuid primary key default uuid_generate_v4(),
  content_id      uuid references content(id) on delete cascade not null,
  app_id          uuid references apps(id) on delete cascade not null,
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  platform        text not null,
  impressions     integer default 0,
  clicks          integer default 0,
  likes           integer default 0,
  shares          integer default 0,
  comments        integer default 0,
  link_clicks     integer default 0,
  revenue_attributed numeric(10,2) default 0,  -- populated by V4 revenue funnel
  utm_source      text,
  utm_campaign    text,
  fetched_at      timestamp with time zone default now()
);

alter table analytics enable row level security;

create policy "analytics_all" on analytics
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_analytics_app_id on analytics(app_id);
create index idx_analytics_workspace_id on analytics(workspace_id);
create index idx_analytics_platform on analytics(platform);
```

---

## Table: cold_email_prospects

Prospects found by Apollo and enriched by Hunter. Unified table that receives leads from all sources.

```sql
create table cold_email_prospects (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  app_id          uuid references apps(id) on delete cascade not null,
  first_name      text,
  last_name       text,
  email           text,
  company         text,
  title           text,
  linkedin_url    text,
  company_news    text,            -- recent news found during enrichment
  email_verified  boolean default false,
  source          text default 'apollo',  -- 'apollo' | 'ad_landing_page' | 'organic'
  status          text default 'researched',
  -- status: 'researched' | 'verified' | 'personalised' | 'approved' | 'sent' | 'replied' | 'unsubscribed' | 'bounced'
  personalised_email text,         -- the personalised email body
  personalisation_score integer,   -- 0-100, Claude's confidence score
  is_preview      boolean not null default false,  -- true for the 5 one-time onboarding previews from trigger/outreach-preview.ts, false for the regular monthly batch
  created_at      timestamp with time zone default now()
);

alter table cold_email_prospects enable row level security;

create policy "prospects_all" on cold_email_prospects
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_prospects_workspace_id on cold_email_prospects(workspace_id);
create index idx_prospects_app_id on cold_email_prospects(app_id);
create index idx_prospects_status on cold_email_prospects(status);
```

> **Migration note (2026-07-14):** `is_preview` was added via
> `add_outreach_onboarding_columns` (same migration as the `apps` table
> columns above). `prospects_all` RLS already covers it — same row, no
> policy change needed.

---

## Table: email_interactions

Tracks every cold email sent and the response status.

```sql
create table email_interactions (
  id              uuid primary key default uuid_generate_v4(),
  prospect_id     uuid references cold_email_prospects(id) on delete cascade not null,
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  app_id          uuid references apps(id) on delete cascade not null,
  email_type      text not null,   -- 'initial' | 'follow_up_1' | 'follow_up_2' | 'breakup'
  subject         text,
  body            text,
  sent_at         timestamp with time zone,
  opened_at       timestamp with time zone,
  clicked_at      timestamp with time zone,
  replied_at      timestamp with time zone,
  instantly_id    text,            -- ID returned by Instantly.ai
  created_at      timestamp with time zone default now(),
  actioned_at     timestamp with time zone  -- set when a team member marks a reply as handled (dashboard-only, no pipeline writes this yet)
);

alter table email_interactions enable row level security;

create policy "interactions_all" on email_interactions
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_interactions_workspace_id on email_interactions(workspace_id);
create index idx_interactions_prospect_id on email_interactions(prospect_id);
```

> **Migration note (2026-07-05):** `actioned_at` was added after the table already
> existed in production, via `add_actioned_at_to_email_interactions`. RLS policy
> `interactions_all` already covers it (column-level, not policy-level), so no
> policy change was needed.

---

## Table: research_findings

Stores output from all five Research Intelligence Hub streams.

```sql
create table research_findings (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  app_id          uuid references apps(id) on delete cascade not null,
  stream          text not null,
  -- 'topic_research' | 'problem_discovery' | 'creator_research' | 'forum_opportunities' | 'competitor_gap'
  findings        jsonb not null,  -- structured output from each stream
  status          text default 'active',  -- 'active' | 'acted_on' | 'dismissed'
  week_of         date,            -- the week this research covers
  created_at      timestamp with time zone default now()
);

alter table research_findings enable row level security;

create policy "research_all" on research_findings
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_research_workspace_id on research_findings(workspace_id);
create index idx_research_app_id on research_findings(app_id);
create index idx_research_stream on research_findings(stream);
```

---

## Table: forum_search_seeds

Keywords seeded from Problem Discovery and Competitor Gap findings via the Research page's "Search Forums For This" action. Read by the Forum Opportunity Finder job on its next run, alongside its normal DNA-derived keywords, then marked consumed — Reddit/forum content must always be a reply to a thread that job finds, never a standalone drafted post, so this table only ever influences search input, never content generation directly.

```sql
create table forum_search_seeds (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  app_id          uuid references apps(id) on delete cascade not null,
  keyword         text not null,
  source_research_finding_id uuid references research_findings(id) on delete set null,
  consumed_at     timestamp with time zone,  -- set once a Forum Opportunity Finder run has read this seed
  created_at      timestamp with time zone default now()
);

alter table forum_search_seeds enable row level security;

create policy "forum_search_seeds_all" on forum_search_seeds
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_forum_search_seeds_app_id on forum_search_seeds(app_id);
create index idx_forum_search_seeds_workspace_id on forum_search_seeds(workspace_id);
create index idx_forum_search_seeds_consumed_at on forum_search_seeds(consumed_at);
```

---

## Table: optimization_cycles

Records each weekly optimization run and what strategy changes were made.

```sql
create table optimization_cycles (
  id              uuid primary key default uuid_generate_v4(),
  app_id          uuid references apps(id) on delete cascade not null,
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  previous_strategy_id uuid references strategies(id),
  new_strategy_id uuid references strategies(id),
  analysis        text,            -- Claude's analysis of what changed and why
  confidence_score integer,        -- 0-100, if below 80 changes are not applied
  changes_applied boolean default false,
  rolled_back     boolean default false,
  week_of         date,
  created_at      timestamp with time zone default now()
);

alter table optimization_cycles enable row level security;

create policy "cycles_all" on optimization_cycles
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );
```

---

## Table: onboarding_findings

Findings produced by the onboarding-audit agent (`trigger/onboarding-audit.ts`) — the first of the planned "Audits" family (onboarding now; churn and CRO audits are future work, not built yet).

```sql
create table onboarding_findings (
  id                uuid primary key default uuid_generate_v4(),
  app_id            uuid references apps(id) on delete cascade not null,
  workspace_id      uuid references workspaces(id) on delete cascade not null,
  finding_type      text not null,
  severity          text not null check (severity in ('high', 'medium', 'low')),
  issue_description text not null,
  suggested_fix     text not null,
  status            text not null default 'open' check (status in ('open', 'fixed', 'not_applicable')),
  created_at        timestamp with time zone default now()
);

alter table onboarding_findings enable row level security;

create policy "onboarding_findings_all" on onboarding_findings
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_onboarding_findings_app_id on onboarding_findings(app_id);
create index idx_onboarding_findings_workspace_id on onboarding_findings(workspace_id);
create index idx_onboarding_findings_status on onboarding_findings(status);
```

> **Migration note (2026-07-22):** Added via `create_onboarding_findings` — see PHASES.md's Notes Log for why this and the "Audits" nav grouping exist ahead of any listed phase. `finding_type` is free text, not a fixed enum (unlike `research_findings.stream`) — the onboarding skill's issue categories (time-to-value, activation friction, empty states, checklist design, ...) aren't a small closed set the way the five research streams are, so Claude assigns a short descriptive label per finding (e.g. `"no_onboarding_checklist"`, `"buried_signup_cta"`) rather than picking from a constrained list.

---

## Table: churn_findings

Second of the "Audits" family, alongside `onboarding_findings` — same shape, same RLS pattern, produced by `trigger/churn-audit.ts` instead. Kept as its own table rather than a shared `audit_findings` table with a `stream`/`audit_type` column (the `research_findings` pattern) because each audit type's `finding_type` vocabulary and downstream consumers are unrelated — a shared table would just add a filter every query needs, for no real benefit yet.

```sql
create table churn_findings (
  id                uuid primary key default uuid_generate_v4(),
  app_id            uuid references apps(id) on delete cascade not null,
  workspace_id      uuid references workspaces(id) on delete cascade not null,
  finding_type      text not null,
  severity          text not null check (severity in ('high', 'medium', 'low')),
  issue_description text not null,
  suggested_fix     text not null,
  status            text not null default 'open' check (status in ('open', 'fixed', 'not_applicable')),
  created_at        timestamp with time zone default now()
);

alter table churn_findings enable row level security;

create policy "churn_findings_all" on churn_findings
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_churn_findings_app_id on churn_findings(app_id);
create index idx_churn_findings_workspace_id on churn_findings(workspace_id);
create index idx_churn_findings_status on churn_findings(status);
```

> **Migration note (2026-07-22):** Added via `create_churn_findings`. `finding_type` examples: `"no_cancel_flow_save_offer"`, `"no_dunning_retry_implied"`, `"paywall_friction"`. Reads `apps.app_settings.conversion_retention.known_churn_rate` (added in the same migration as `onboarding_findings`, see above) alongside DNA pricing — no new `app_settings` fields needed for this audit.

---

## Table: cro_findings

Third and last of the "Audits" family (see PHASES.md Notes Log, 2026-07-22) — same shape as `onboarding_findings`/`churn_findings`, produced by `trigger/cro-audit.ts`. Audits the app's own landing page and signup flow, not a downstream funnel step — this is the page all of this tool's own generated marketing content actually drives traffic to.

```sql
create table cro_findings (
  id                uuid primary key default uuid_generate_v4(),
  app_id            uuid references apps(id) on delete cascade not null,
  workspace_id      uuid references workspaces(id) on delete cascade not null,
  finding_type      text not null,
  severity          text not null check (severity in ('high', 'medium', 'low')),
  issue_description text not null,
  suggested_fix     text not null,
  status            text not null default 'open' check (status in ('open', 'fixed', 'not_applicable')),
  created_at        timestamp with time zone default now()
);

alter table cro_findings enable row level security;

create policy "cro_findings_all" on cro_findings
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_cro_findings_app_id on cro_findings(app_id);
create index idx_cro_findings_workspace_id on cro_findings(workspace_id);
create index idx_cro_findings_status on cro_findings(status);
```

> **Migration note (2026-07-22):** Added via `create_cro_findings`. `finding_type` examples: `"too_many_signup_fields"`, `"unclear_value_proposition"`, `"no_social_proof"`, `"weak_or_buried_cta"`. Reads DNA + a live scrape of the homepage and (if discoverable) the signup page — no `app_settings` fields needed, unlike the other two audits.

---

## Table: pricing_findings

Fourth of the "Audits" family, alongside `onboarding_findings`/`churn_findings`/`cro_findings` — same shape, produced by `trigger/pricing-audit.ts`. Audits the end user's own app's pricing/packaging, not this SaaS's own pricing.

```sql
create table pricing_findings (
  id                uuid primary key default uuid_generate_v4(),
  app_id            uuid references apps(id) on delete cascade not null,
  workspace_id      uuid references workspaces(id) on delete cascade not null,
  finding_type      text not null,
  severity          text not null check (severity in ('high', 'medium', 'low')),
  issue_description text not null,
  suggested_fix     text not null,
  status            text not null default 'open' check (status in ('open', 'fixed', 'not_applicable')),
  created_at        timestamp with time zone default now()
);

alter table pricing_findings enable row level security;

create policy "pricing_findings_all" on pricing_findings
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_pricing_findings_app_id on pricing_findings(app_id);
create index idx_pricing_findings_workspace_id on pricing_findings(workspace_id);
create index idx_pricing_findings_status on pricing_findings(status);
```

> **Migration note (2026-07-22):** Added via `create_pricing_findings`. `finding_type` examples: `"pricing_tier_gap_vs_competitors"`, `"unclear_tier_differentiation"`, `"price_audience_mismatch"`. Reads DNA, a live scrape of the app's own pricing page (if one exists), the `competitor_research` table's `pricing_notes`/`positioning_notes` for real competitor pricing to compare against (see that table below — surfaced here since this is the first job to actually read it, not just write it), and `apps.app_settings.conversion_retention.known_signup_conversion_rate`/`known_churn_rate`.

---

## Table: competitor_research

> **Retroactively documented (2026-07-22):** this table has existed since the diagnosis-first pipeline redesign (2026-07-14, written by `trigger/competitor-research.ts`) but was never added to this file — a pre-existing SCHEMA.md gap, not a new migration. Backfilled here because `trigger/pricing-audit.ts` is the first job to actually *read* it (every prior consumer only wrote to it).

Real, scraped competitor data — homepage + pricing page summaries — gathered once per app during onboarding by `trigger/competitor-research.ts` (part of the diagnosis-first pipeline: dna-extraction → competitor-research → diagnosis). Distinct from `research_findings` (stream = `competitor_gap`), which stores ongoing monthly *gap* findings about competitors, not their base profile.

```sql
create table competitor_research (
  id                 uuid primary key default uuid_generate_v4(),
  app_id             uuid references apps(id) on delete cascade not null,
  workspace_id       uuid references workspaces(id) on delete cascade not null,
  competitor_name    text,
  competitor_url     text,
  scraped_summary    text,
  pricing_notes      text,
  positioning_notes  text,
  created_at         timestamp with time zone default now()
);

alter table competitor_research enable row level security;

create policy "competitor_research_all" on competitor_research
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_competitor_research_app_id on competitor_research(app_id);
create index idx_competitor_research_workspace_id on competitor_research(workspace_id);
```

> RLS and both indexes confirmed directly against the live table (`relrowsecurity = true`, policy `competitor_research_all` present with the standard `workspace_id` predicate, `idx_competitor_research_app_id`/`idx_competitor_research_workspace_id` both exist) before `trigger/pricing-audit.ts` was written to query it — this DDL reflects what's actually deployed, not a guess.

---

## Table: diagnosis_proposals

Quarterly background re-check of the competitive landscape (`trigger/diagnosis-refresh-check.ts`) proposes an updated diagnosis here when something material changed since the app's original diagnosis — reviewed via the same acknowledge/approve UI pattern as the original diagnosis, not a new interaction model. One row per proposal; multiple historical rows per app are expected over time (old ones simply end up `accepted`/`dismissed`).

```sql
create table diagnosis_proposals (
  id                  uuid primary key default uuid_generate_v4(),
  app_id              uuid references apps(id) on delete cascade not null,
  workspace_id        uuid references workspaces(id) on delete cascade not null,
  change_summary      text not null,   -- plain-language: what changed and why it might affect the current diagnosis
  proposed_diagnosis  jsonb not null,  -- same shape as apps.diagnosis
  status              text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  created_at          timestamp with time zone default now()
);

alter table diagnosis_proposals enable row level security;

create policy "diagnosis_proposals_all" on diagnosis_proposals
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

---

## Table: seo_geo_scores / seo_geo_findings

SEO & GEO scoring engine — see SCORING.md for the full check registry, scoring math, and evidence citations. Two independent evaluation tracks (`track = 'seo' | 'geo'`), never blended into one score. Only the SEO track (`trigger/seo-geo-audit.ts`, `lib/seo/`) is built and populated so far; both tables' shapes already support `'geo'` rows so GEO doesn't need a second migration when it's built.

```sql
create table seo_geo_scores (
  id            uuid primary key default uuid_generate_v4(),
  app_id        uuid references apps(id) on delete cascade not null,
  workspace_id  uuid references workspaces(id) on delete cascade not null,
  page_url      text,                        -- null for brand-scope checks
  page_id       uuid,                        -- null for brand-scope checks
  content_id    uuid references content(id) on delete set null,  -- set when scoring a draft
  track         text not null check (track in ('seo', 'geo')),
  score         integer not null,            -- 0-100 composite
  dim_scores    jsonb not null,              -- { retrievability, off_page } for SEO
  check_results jsonb not null,              -- { check_id: { pass, value, confidence, measurable } }
  run_at        timestamp with time zone default now()
);

alter table seo_geo_scores enable row level security;

create policy "seo_geo_scores_all" on seo_geo_scores
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_seo_geo_scores_app_id on seo_geo_scores(app_id);
create index idx_seo_geo_scores_workspace_id on seo_geo_scores(workspace_id);
create index idx_seo_geo_scores_track on seo_geo_scores(track);
create index idx_seo_geo_scores_run_at on seo_geo_scores(run_at);

create table seo_geo_findings (
  id                uuid primary key default uuid_generate_v4(),
  app_id            uuid references apps(id) on delete cascade not null,
  workspace_id      uuid references workspaces(id) on delete cascade not null,
  page_url          text,
  page_id           uuid,
  content_id        uuid references content(id) on delete set null,
  track             text not null check (track in ('seo', 'geo')),
  check_id          text not null,           -- e.g. 'seo.sitemap.included'
  dimension         text not null,
  evidence_tier     integer not null check (evidence_tier in (1, 2, 3)),
  expected_gain     double precision not null,
  title             text not null,
  explanation       text not null,
  confidence_label  text not null,
  remediation       jsonb,                   -- { type: 'diff'|'pr'|'route_to_forum'|'technical', ... }
  status            text not null default 'open' check (status in ('open', 'applied', 'skipped')),
  skip_count        integer not null default 0,
  created_at        timestamp with time zone default now()
);

alter table seo_geo_findings enable row level security;

create policy "seo_geo_findings_all" on seo_geo_findings
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_seo_geo_findings_app_id on seo_geo_findings(app_id);
create index idx_seo_geo_findings_workspace_id on seo_geo_findings(workspace_id);
create index idx_seo_geo_findings_track on seo_geo_findings(track);
create index idx_seo_geo_findings_status on seo_geo_findings(status);
```

> **Migration note (2026-07-23):** Added via `add_seo_geo_scoring_tables`. `workspace_id` and its RLS policy were added to both tables on top of SCORING.md's own draft DDL — that spec predates this project's non-negotiable workspace_id/RLS convention (CLAUDE.md Rule #1), it wasn't a deviation from the rest of the design. `trigger/seo-geo-audit.ts` runs weekly per active app (`trigger/weekly-seo-scan.ts`) or on-demand via the `seo_audit` agent-action credit (2 credits), evaluating the app's own homepage (`apps.source_url`) plus brand-scoped off-page checks. Two checks (`seo.title.unique`, `seo.links.internal_in`) are permanently `measurable: false` in `check_results` since this tool audits one page per app, not a full site crawl — excluded from the weighted score rather than given a fabricated result. `seo.offpage.mention_trend` becomes measurable once a prior scoring run exists from ≥90 days back.

create index idx_diagnosis_proposals_app_id on diagnosis_proposals(app_id);
create index idx_diagnosis_proposals_workspace_id on diagnosis_proposals(workspace_id);
create index idx_diagnosis_proposals_status on diagnosis_proposals(status);
```

> **Migration note (2026-07-23):** Added via `add_diagnosis_refresh_and_proposals` (same migration as `apps.diagnosis_refresh_status`/`apps.last_diagnosis_refresh_at` above). Accepting a proposal (`PATCH /api/apps/[id]/diagnosis-proposals/[proposalId]/accept`) sets this row's `status = 'accepted'`, copies `proposed_diagnosis` into `apps.diagnosis`, and re-triggers `strategy-generation` — same effect as the original diagnosis acknowledge flow, just sourced from a proposal instead of a fresh diagnosis run. Dismissing sets `status = 'dismissed'` and resets `apps.diagnosis_refresh_status` back to `'none'`, with no other changes.

---

## Table: brand_information

One row per app, holding the customer-facing "Brand Identity" reference used by downstream content/GEO jobs (see TODO markers in `trigger/content-generation.ts` and `trigger/seo-geo-audit.ts` — not wired in yet, extraction + Settings UI only for now). Auto-populated by `trigger/brand-info-extraction.ts` from a Firecrawl scrape of the app's homepage plus (if discoverable) About/Pricing pages, then reviewed/edited/confirmed by the customer in Settings → Brand Identity. Every auto-filled field must trace back to something literally present on a scraped page — the LLM extraction prompt returns `null` rather than inventing a value, and nothing here (especially `key_stats`/`testimonial`) is ever fabricated.

```sql
create table brand_information (
  id                    uuid primary key default uuid_generate_v4(),
  app_id                uuid references apps(id) on delete cascade not null unique,
  workspace_id          uuid references workspaces(id) on delete cascade not null,

  -- Core identity
  brand_name            text,
  one_liner             text,          -- what it does, <=15 words
  category              text,          -- vertical: health, finance, dev tools, etc.
  website_url           text,
  logo_url              text,          -- storage path in the 'brand-assets' bucket, after upload

  -- Positioning
  problem_solved        text,
  target_customer       text,
  differentiator        text,
  known_competitors     text[],

  -- Voice & tone
  tone_descriptors      text[],        -- e.g. ['direct', 'technical', 'no fluff']
  words_to_avoid        text[],
  writing_sample        text,          -- optional pasted paragraph

  -- Proof points
  key_stats             jsonb,         -- [{ label, value, source_url }]
  testimonial           text,
  testimonial_source    text,
  pricing_summary       jsonb,         -- [{ plan_name, price, billing_period }]

  -- Channels & handles
  social_handles        jsonb,         -- { platform: handle }
  github_repo_url       text,

  -- Founder context (optional)
  founder_name          text,
  founder_bio           text,

  -- Guardrails
  claims_to_avoid       text[],
  target_regions        text[],

  -- Visual identity
  primary_color_hex     text,
  secondary_color_hex   text,
  font_preference       text,
  product_screenshots   text[],        -- storage paths in the 'brand-assets' bucket

  -- Metadata
  extraction_source     jsonb,         -- { field_name: 'auto'|'manual' }
  extraction_status     text not null default 'idle',  -- 'idle' | 'processing' | 'complete' | 'error'
  extraction_error      text,          -- populated when extraction_status = 'error'
  last_analyzed_at      timestamptz,
  updated_at            timestamptz default now()
);

alter table brand_information enable row level security;

create policy "brand_information_all" on brand_information
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_brand_information_app_id on brand_information(app_id);
create index idx_brand_information_workspace_id on brand_information(workspace_id);
```

**Key stats JSON structure:**
```json
[{ "label": "string", "value": "string", "source_url": "string | null" }]
```

**Pricing summary JSON structure:**
```json
[{ "plan_name": "string", "price": "string", "billing_period": "string | null" }]
```

**Social handles JSON structure:** `{ "twitter": "@handle", "linkedin": "url", ... }` — free-form key/value, keys are whatever platform names the extraction or the customer enters, not a fixed enum.

**Extraction source JSON structure:** `{ "brand_name": "auto" | "manual", "one_liner": "auto" | "manual", ... }` — one entry per top-level field that can be auto-filled, written once by `brand-info-extraction.ts` on first run (every field it successfully filled marked `"auto"`) and updated to `"manual"` by the save route whenever the customer edits that field, so a re-analyze run knows which fields it must never silently overwrite (see Part 4 confirm/diff behavior below).

> **Migration note (2026-07-24):** Added via `create_brand_information`. Two deviations from the originally requested DDL, both required by this project's non-negotiable rules (CLAUDE.md Rule #1 / this file's Core Rules): added `workspace_id` (every table must have one, filtered on every query — the request's DDL only had `app_id`) and used `uuid_generate_v4()` instead of `gen_random_uuid()` for the primary key default (Core Rule #3 mandates the former; both work identically on Postgres 15, this is a consistency choice, not a functional one). Also added `extraction_status`/`extraction_error` beyond the requested columns — the async extraction job needs a way to signal "still running" / "failed, here's why" to the Settings UI, the same role `apps.status`/`apps.error_message` play for the main onboarding pipeline; without them the UI would have no way to end a loading spinner on failure. `brand-info-extraction.ts` is a side/enrichment job, not one of the three pipeline-blocking jobs (dna-extraction, strategy-generation, content-generation) — it never touches `apps.status` itself, per the convention documented in `lib/errors/jobErrorHandler.ts`.
>
> **Storage bucket:** `brand-assets` (public, 5MB limit, image mime types only) was created in the same migration for `logo_url`/`product_screenshots` uploads, mirroring the existing `app-docs` bucket's workspace-scoped RLS convention (`storage.foldername(name)[1]` must match a workspace the uploading user belongs to) for the INSERT policy. Unlike `app-docs`, this bucket is `public: true` — logos/screenshots render directly as `<img>` sources in the dashboard, so no SELECT policy is needed (public buckets serve reads unauthenticated, bypassing RLS). This is the first documented Storage bucket in this file; `app-docs` (see `apps.doc_paths` above) predates this convention and was created out-of-band without a written record — worth being aware of if you go looking for its provisioning history.

---

## Table: chat_conversations / chat_messages / pending_chat_actions

Backend for the in-app chat panel (`components/dashboard/ChatPanel.tsx`, `app/api/chat/route.ts`). One `chat_conversations` row per app_id + user_id pair — switching the selected app in the UI starts a new conversation, never reuses another app's thread. `chat_messages` stores the full Anthropic content-block array per turn (including any `tool_use`/`tool_result` blocks) so a conversation can be reconstructed verbatim for the next API call, plus the response `usage` block's four token counts for cache-hit observability (see the Observability query below). `pending_chat_actions` holds a mutating tool call the model proposed but hasn't executed yet — the confirm card in the UI reads/writes this row via `app/api/chat/confirm/route.ts`; a row past `expires_at` (1 hour) is treated as expired rather than executed.

```sql
create table chat_conversations (
  id               uuid primary key default uuid_generate_v4(),
  app_id           uuid references apps(id) on delete cascade not null,
  workspace_id     uuid references workspaces(id) on delete cascade not null,
  user_id          uuid references auth.users(id) on delete cascade not null,
  created_at       timestamp with time zone default now(),
  last_message_at  timestamp with time zone default now()
);

alter table chat_conversations enable row level security;

create policy "chat_conversations_all" on chat_conversations
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_chat_conversations_app_id on chat_conversations(app_id);
create index idx_chat_conversations_workspace_id on chat_conversations(workspace_id);
create index idx_chat_conversations_app_user on chat_conversations(app_id, user_id);

create table chat_messages (
  id                            uuid primary key default uuid_generate_v4(),
  conversation_id               uuid references chat_conversations(id) on delete cascade not null,
  workspace_id                  uuid references workspaces(id) on delete cascade not null,
  role                          text not null check (role in ('user', 'assistant')),
  content                       jsonb not null,        -- full content blocks, including tool_use/tool_result
  cache_creation_input_tokens   integer,                -- from the API response usage block, for observability
  cache_read_input_tokens       integer,
  input_tokens                  integer,
  output_tokens                 integer,
  created_at                    timestamp with time zone default now()
);

alter table chat_messages enable row level security;

create policy "chat_messages_all" on chat_messages
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_chat_messages_conversation_id on chat_messages(conversation_id);
create index idx_chat_messages_workspace_id on chat_messages(workspace_id);
create index idx_chat_messages_created_at on chat_messages(created_at);

create table pending_chat_actions (
  id               uuid primary key default uuid_generate_v4(),
  conversation_id  uuid references chat_conversations(id) on delete cascade not null,
  app_id           uuid references apps(id) on delete cascade not null,
  workspace_id     uuid references workspaces(id) on delete cascade not null,
  tool_use_id      text not null,   -- the originating tool_use block's id, so the confirm route can post a matching tool_result back into the conversation once handled
  tool_name        text not null,
  tool_params      jsonb not null,
  credit_cost      integer not null,
  status           text not null default 'pending' check (status in ('pending', 'confirmed', 'executed', 'cancelled', 'expired')),
  created_at       timestamp with time zone default now(),
  expires_at       timestamp with time zone default (now() + interval '1 hour')
);

alter table pending_chat_actions enable row level security;

create policy "pending_chat_actions_all" on pending_chat_actions
  for all using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid()
    )
  );

create index idx_pending_chat_actions_conversation_id on pending_chat_actions(conversation_id);
create index idx_pending_chat_actions_workspace_id on pending_chat_actions(workspace_id);
create index idx_pending_chat_actions_status on pending_chat_actions(status);
create index idx_pending_chat_actions_expires_at on pending_chat_actions(expires_at);
```

> **Migration note (2026-07-25):** Added via `create_chat_tables`, with `tool_use_id` added to `pending_chat_actions` shortly after via `add_tool_use_id_to_pending_chat_actions` (table was still empty, so a plain `not null` add was safe). Four deviations from the originally requested DDL, same pattern as `brand_information`'s migration note above: (1) added `workspace_id` to all three tables (the request only had it implicitly via `apps`/`chat_conversations` joins — every table needs its own column so every query can filter directly instead of joining out to derive it) with the standard `..._all` RLS policy, required by CLAUDE.md Rule #1 / this file's Core Rules; (2) used `uuid_generate_v4()` instead of `gen_random_uuid()` for primary key defaults, per Core Rule #3; (3) `chat_messages.workspace_id` specifically wasn't in the request's DDL at all — added for the same direct-filter reason as (1), populated from the parent `chat_conversations` row at insert time rather than joined per-query; (4) `pending_chat_actions.tool_use_id` wasn't in the request's DDL either — without it, `app/api/chat/confirm/route.ts` has no way to post a `tool_result` block back referencing the original `tool_use` block once the founder confirms or declines, which would leave that turn's assistant message permanently missing its required tool_result on the next chat request. `idx_chat_conversations_app_user` supports the route's "load or create the conversation for this app_id + user_id" lookup on every chat request.

---

## `apps.app_settings` — Conversion & Retention

Same untyped `app_settings` jsonb column documented under the `apps` table above — this adds a `conversion_retention` key, parsed/defaulted in `lib/app-settings.ts` the same way `publishing_schedule` already is. All fields are optional and nullable: this is founder-provided context `trigger/onboarding-audit.ts` cannot infer from DNA or a page scrape alone, so a missing value must lower the audit's confidence, never get invented.

```json
{
  "conversion_retention": {
    "trial_length_days": "number | null",
    "has_free_tier": "boolean | null",
    "onboarding_step_count": "number | null",
    "known_signup_conversion_rate": "number | null",
    "known_activation_rate": "number | null",
    "known_churn_rate": "number | null"
  }
}
```

> **Migration note (2026-07-22):** Added via the same `PATCH /api/apps/[id]/settings` route as `publishing_schedule` — no schema change, since `app_settings` is already jsonb. Documented here per SCHEMA.md's own rule ("never guess column names") even though nothing new was added to the `apps` table itself.

---

## Auto-Workspace Trigger

Run this function and trigger in Supabase. It automatically creates a workspace and owner membership whenever a new user signs up. This must exist before any user can sign up.

```sql
create or replace function create_workspace_for_new_user()
returns trigger as $$
declare
  new_workspace_id uuid;
begin
  insert into workspaces (name, plan_tier)
  values ('My Workspace', 'free')
  returning id into new_workspace_id;

  insert into workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function create_workspace_for_new_user();
```

---

## Environment Variables Required

Add all of these to Vercel environment variables and to your local `.env.local`. Never commit actual values.

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Anthropic
ANTHROPIC_API_KEY=

# OpenRouter (for Llama bulk content)
OPENROUTER_API_KEY=

# Firecrawl
FIRECRAWL_API_KEY=

# PostEverywhere
POSTEVERYWHERE_API_KEY=

# Google Gemini (image generation)
GEMINI_API_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Trigger.dev
TRIGGER_SECRET_KEY=

# Telegram
TELEGRAM_BOT_TOKEN=

# Credential encryption
CREDENTIALS_ENCRYPTION_KEY=

# Sentry
SENTRY_DSN=

# V3+ only — add when building those phases
APOLLO_API_KEY=
HUNTER_API_KEY=
INSTANTLY_API_KEY=
SERPAPI_KEY=
```

---

## Query Patterns — Use These Templates

### Get workspace ID for authenticated user
```typescript
const { data: membership } = await supabaseAdmin
  .from('workspace_members')
  .select('workspace_id')
  .eq('user_id', userId)
  .single();

const workspaceId = membership?.workspace_id;
```

### Get all apps for a workspace
```typescript
const { data: apps } = await supabaseAdmin
  .from('apps')
  .select('*')
  .eq('workspace_id', workspaceId)
  .order('created_at', { ascending: false });
```

### Get active strategy for an app
```typescript
const { data: strategy } = await supabaseAdmin
  .from('strategies')
  .select('*')
  .eq('app_id', appId)
  .eq('workspace_id', workspaceId)
  .eq('status', 'active')
  .single();
```

### Get scheduled content due for publishing
```typescript
const { data: posts } = await supabaseAdmin
  .from('content')
  .select('*')
  .eq('status', 'scheduled')
  .eq('workspace_id', workspaceId)
  .lte('scheduled_at', new Date().toISOString())
  .order('scheduled_at', { ascending: true });
```

### Chat prompt-cache observability — per-day token/cache rollup
Equivalent to `lib/chat/observability.ts`'s `getDailyChatTokenStats` — for ad-hoc checks straight against the database. `cache_hit_rate` should be high once a conversation has more than one turn; a day where `total_cache_creation_tokens` spikes relative to prior days usually means something in `identityBlock` or `SCOPED_SYSTEM_PROMPT` changed and broke the cached prefix (see `lib/chat/assemble-context.ts` / `lib/chat/system-prompt.ts`).
```sql
select
  date_trunc('day', created_at) as day,
  sum(input_tokens) as total_input_tokens,
  sum(cache_read_input_tokens) as total_cache_read_tokens,
  sum(cache_creation_input_tokens) as total_cache_creation_tokens,
  round(
    sum(cache_read_input_tokens)::numeric
      / nullif(sum(input_tokens) + sum(cache_read_input_tokens), 0),
    4
  ) as cache_hit_rate
from chat_messages
where workspace_id = $1
  and created_at >= now() - interval '30 days'
group by 1
order by 1 desc;
```
