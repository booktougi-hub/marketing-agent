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
  -- status values: 'pending' | 'extracting' | 'strategy_pending' | 'awaiting_approval' | 'active' | 'paused' | 'error' | 'deleted'
  is_paused       boolean not null default false,
  error_message   text,                          -- populated if status = 'error'
  additional_context text null,                  -- optional free-text context typed by the user at onboarding
  doc_paths       text[],                        -- Supabase Storage paths (bucket 'app-docs') for uploaded supporting docs
  reanalysis_credits_used      integer default 0,             -- how many manual re-analyses (re-running DNA extraction) used this billing period
  reanalysis_credits_reset_at  timestamp with time zone,      -- when reanalysis_credits_used resets to 0
  url_changed_at  timestamp with time zone,      -- set when the user edits source_url after initial DNA extraction
  deleted_at      timestamp with time zone,      -- soft delete — set instead of removing the row; excluded by RLS (see policy below)
  app_settings    jsonb default '{}'::jsonb,     -- scheduling and notification preferences (settings screen)
  manual_research_count_this_week integer default 0,   -- manual research triggers used this week, rate-limited per plan
  manual_research_reset_at        timestamp with time zone,  -- when manual_research_count_this_week resets to 0
  last_manual_research_at         timestamp with time zone,  -- timestamp of the most recent manual research trigger
  first_research_completed        boolean default false,     -- true once the app's first research run (any stream) has been triggered
  first_research_completed_at     timestamp with time zone,  -- when first_research_completed was set true, for display copy ("completed on [date]")
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
