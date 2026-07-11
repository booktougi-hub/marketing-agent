# PHASES.md — Phase Tracker and Scope Control

> Claude Code reads this file to know what is in scope right now.
> Nothing outside the current phase checklist gets built.
> Update the current phase section as tasks are completed.

---

## Current Phase: V1 — MVP Core Loop

**Started:** [fill in date]  
**Target completion:** 6 weeks from start  
**Status:** 🔴 Not started

### V1 Success Condition

Before moving to V2, ALL of the following must be true:

- [ ] Posts are publishing automatically for at least one real app with zero manual intervention
- [ ] The entire flow works end to end: URL input → DNA → strategy → content → publish
- [ ] At least 10 people outside your own network are paying $29/month
- [ ] The Stripe webhook correctly updates workspace plan on payment
- [ ] No Supabase queries exist without workspace_id filtering
- [ ] RLS is enabled and tested on every table

**Do not start V2 until every checkbox above is checked.**

---

## V1 Task Checklist

### Week 1 — Foundation

**Day 1 — Project Setup**
- [ ] Create Next.js 15 project with TypeScript strict, Tailwind, App Router
- [ ] Install: `@supabase/supabase-js @supabase/auth-helpers-nextjs shadcn/ui stripe @trigger.dev/sdk`
- [ ] Create Supabase project, copy URL and keys to Vercel env vars
- [ ] Push to GitHub, connect to Vercel, confirm auto-deploy works
- [ ] Create `/lib/supabase.ts` (browser client)
- [ ] Create `/lib/supabase-server.ts` (admin client)
- [ ] Create `/types/index.ts` with base types from SCHEMA.md

**Day 2 — Database**
- [ ] Run full schema SQL from SCHEMA.md in Supabase SQL editor
- [ ] Confirm RLS enabled on all 9 tables
- [ ] Run auto-workspace trigger SQL
- [ ] Test trigger: create a test user, confirm workspace and membership rows appear
- [ ] Add all environment variables to Vercel dashboard

**Day 3 — Authentication**
- [ ] Build `/app/auth/login/page.tsx` — email/password + Google OAuth button
- [ ] Build `/app/auth/signup/page.tsx` — email/password + Google OAuth button
- [ ] Enable Google OAuth in Supabase dashboard
- [ ] Build `middleware.ts` — protect all `/dashboard/*` routes, redirect to login
- [ ] Test: login, confirm workspace created, sign out, confirm redirect

**Day 4 — Dashboard Shell**
- [ ] Build `/app/dashboard/layout.tsx` — sidebar with nav links and sign out
- [ ] Build `/app/dashboard/page.tsx` — redirect to `/dashboard/apps`
- [ ] Build `/app/dashboard/apps/page.tsx` — empty app list with "Add your first app" button

**Day 5 — Trigger.dev Setup**
- [ ] Create Trigger.dev account and project
- [ ] Install Trigger.dev SDK, add config file
- [ ] Add `TRIGGER_SECRET_KEY` to Vercel env vars
- [ ] Create `/trigger/index.ts` and confirm a test job runs end to end

---

### Week 2 — App Onboarding

**Day 1-2 — URL Input Form**
- [ ] Build `/app/dashboard/apps/new/page.tsx`
  - URL input field (required)
  - Product type dropdown (optional): Developer Tool, Mobile App, Web App, SaaS, Other
  - Submit button with loading state
  - Error handling for invalid URLs
- [ ] Build `POST /api/apps/route.ts`
  - Validate session
  - Get workspace_id from membership
  - Check plan allows adding another app (Free = max 1)
  - Insert app record with status = 'extracting'
  - Trigger `dna-extraction` job
  - Return app id

**Day 3 — DNA Extraction Job**
- [ ] Build `/trigger/dna-extraction.ts`
  - Input: `{ app_id, workspace_id, source_url }`
  - Call Firecrawl API to scrape URL
  - Call Claude claude-sonnet-5 with extraction prompt
  - Save DNA JSON to apps table
  - Update status to 'strategy_pending'
  - Trigger `strategy-generation` job
  - On any error: set status to 'error', save error_message

**Day 4 — Strategy Generation Job**
- [ ] Build `/trigger/strategy-generation.ts`
  - Input: `{ app_id, workspace_id }`
  - Read app DNA from Supabase
  - Call Claude claude-sonnet-5 with strategy prompt
  - Insert strategy record with status = 'draft'
  - Update app status to 'awaiting_approval'
  - On error: set app status to 'error'

**Day 5 — Strategy Preview UI**
- [ ] Build `/app/dashboard/apps/[id]/page.tsx`
  - Loading state while status is 'extracting' or 'strategy_pending'
  - Supabase Realtime subscription on app record (update without refresh)
  - Strategy preview when status is 'awaiting_approval':
    - App name and tagline from DNA
    - 3 persona cards
    - 5 content pillar cards
    - Tone description
    - Approve button
    - Regenerate button
- [ ] Build `PATCH /api/apps/[id]/approve/route.ts`
  - Set strategy status to 'active'
  - Set app status to 'active'
  - Trigger `content-generation` job

---

### Week 3 — Research and Opportunities

*(Re-prioritized 2026-07-08 — see Notes Log. The Research and Opportunities*
*pages, their API routes, and the rate-limited manual-trigger system already*
*exist; the one piece still missing is the four Trigger.dev jobs those pages*
*call. `PATCH /api/apps/[id]/approve` and `POST /api/apps/[id]/research/trigger`*
*already call `topic-research` and `problem-discovery` — those calls have been*
*failing silently because the jobs don't exist yet.)*

**Day 1 — Topic Research Job**
- [ ] Build `/trigger/topic-research.ts`
  - Input: `{ app_id, workspace_id, triggered_manually: boolean }`
  - Find trending topics relevant to the app's DNA (real sources — Google Trends, Reddit, Twitter/X search)
  - Call Claude claude-sonnet-5 to score each topic and draft a one-sentence content angle
  - Save each topic to `research_findings` with `stream = 'topic_research'`, `week_of` set to the current week
  - Register the task in `/trigger/index.ts`

**Day 2 — Problem Discovery Job**
- [ ] Build `/trigger/problem-discovery.ts`
  - Input: `{ app_id, workspace_id, triggered_manually: boolean }`
  - Find real user complaints/requests relevant to the app's problem space
  - Call Claude claude-sonnet-5 to extract a problem statement per finding plus a one-line "how your app solves this" using the app's DNA
  - Save each finding to `research_findings` with `stream = 'problem_discovery'`
  - Register the task in `/trigger/index.ts`

**Day 3 — Forum Opportunity Finder Job** *(pulled forward from V3)*
- [ ] Build `/trigger/forum-opportunity-finder.ts`
  - Input: `{ app_id, workspace_id }`
  - Scan Reddit, Hacker News, Quora, LinkedIn, and X for threads where the app could genuinely help
  - Call Claude claude-sonnet-5 to score relevance (High/Medium/Low) and draft a suggested reply
  - Save each thread to `research_findings` with `stream = 'forum_opportunities'`
  - Register the task in `/trigger/index.ts`

**Day 4 — Competitor Gap Analysis Job** *(pulled forward from V4)*
- [ ] Build `/trigger/competitor-gap-analysis.ts`
  - Input: `{ app_id, workspace_id }`
  - Research the app's competitors (from DNA) for gaps/weaknesses (review sites, changelogs, public complaints)
  - Call Claude claude-sonnet-5 to summarize each gap and suggest positioning
  - Save each gap to `research_findings` with `stream = 'competitor_gap'`
  - Register the task in `/trigger/index.ts`

**Day 5 — Schedule and Verify**
- [ ] Add weekly scheduled triggers for all four jobs (mirroring `weekly-research-reset.ts`'s cron pattern) so results refresh automatically, not only on approval or manual trigger
- [ ] Confirm `PATCH /api/apps/[id]/approve` successfully triggers `topic-research` and `problem-discovery` end to end
- [ ] Confirm `POST /api/apps/[id]/research/trigger` successfully triggers the manual-run jobs end to end
- [ ] Run the full flow on a real app and confirm results appear in the Research and Opportunities tabs within a few minutes

---

### Week 4 — Content and Publishing

**Day 1-2 — Content Generation Job**
- [ ] Build `/trigger/content-generation.ts`
  - Input: `{ app_id, workspace_id }`
  - Read active strategy from Supabase
  - Generate 15 Twitter posts (via OpenRouter Llama 3.3 70B free)
  - Generate 8 LinkedIn posts (via OpenRouter Llama 3.3 70B free)
  - Save all to content table with:
    - status = 'scheduled'
    - platform = 'twitter' or 'linkedin'
    - scheduled_at timestamps spread across 30 days at sensible times
    - pillar label from strategy

**Day 3 — Publisher Cron Job**
- [ ] Build `/trigger/publisher.ts`
  - Scheduled: every 15 minutes via Trigger.dev cron
  - Query content table: status = 'scheduled' AND scheduled_at <= now() AND app is not paused
  - For each post: call PostEverywhere API
  - On success: update status to 'published', save published_at and external_post_id
  - On failure: update status to 'failed', increment retry_count, save error_message

**Day 4 — Content Tab UI**
- [ ] Build `/app/dashboard/apps/[id]/content/page.tsx`
  - List of scheduled and published posts
  - Platform badge, date, status indicator, first 100 chars of body
  - Edit button (opens inline edit, updates content record)
  - Delete button (removes from queue)
  - Manual publish button for draft posts

**Day 5 — Pause and Resume**
- [ ] Build `PATCH /api/apps/[id]/pause/route.ts` — toggle is_paused on app record
- [ ] Add pause/resume toggle to app detail page header
- [ ] Publisher cron checks is_paused before processing any post for that app

---

### Week 5 — Billing and Analytics

**Day 1-2 — Stripe Billing**
- [ ] Create Stripe account, create 2 products: Free and Solo ($29/month)
- [ ] Build `/app/dashboard/settings/page.tsx` — billing section with current plan and upgrade button
- [ ] Build `POST /api/stripe/checkout/route.ts` — creates Stripe Checkout session
- [ ] Build `POST /api/webhooks/stripe/route.ts`
  - Handle `checkout.session.completed` → update workspace plan_tier and stripe_customer_id
  - Handle `customer.subscription.deleted` → downgrade to 'free'
  - Verify Stripe webhook signature before processing
- [ ] Add plan enforcement to `POST /api/apps`: Free tier max 1 app

**Day 3 — Analytics Tab**
- [ ] Build `/app/dashboard/apps/[id]/analytics/page.tsx`
  - Total posts published (count from content table)
  - Posts by platform (grouped count)
  - Simple bar chart of posts per week (Recharts)
  - Basic engagement totals from analytics table

**Day 4 — App List Dashboard**
- [ ] Update `/app/dashboard/apps/page.tsx`
  - App card for each app showing: name, status badge, platform count, last published date
  - Click card → navigate to app detail
  - Add new app button

**Day 5 — Error Handling and Polish**
- [ ] Handle error status on app detail page — show error message and retry button
- [ ] Add Sentry error tracking to all Trigger.dev jobs
- [ ] Add empty states to all list views
- [ ] Test the full flow end to end on a real app URL

---

### Week 6 — Testing on Real Apps and Beta Launch

- [ ] Run full flow on AiSkillsGuard — read the generated DNA, strategy, and posts critically
- [ ] Run full flow on AppFactory — compare quality
- [ ] Fix any prompt quality issues — adjust Claude prompts until output is genuinely good
- [ ] Fix any publishing failures
- [ ] Manually test Stripe billing — upgrade and downgrade
- [ ] Onboard 3 beta users, watch them complete onboarding without guidance
- [ ] Fix the 3 biggest friction points they find
- [ ] Announce on IndieHackers and Twitter

---

## V1 Definition of Done

The following must all be working without any manual intervention from you:

1. New user signs up → workspace created automatically
2. User pastes URL → DNA extracted → strategy generated → preview shown
3. User approves strategy → content generated → posts scheduled
4. Posts publish automatically on schedule via PostEverywhere
5. Dashboard shows published posts and engagement
6. Stripe processes payment → plan upgrades correctly
7. Free tier correctly blocked from adding more than 1 app

---

## V2 Scope — DO NOT BUILD UNTIL V1 IS DONE

These features are planned for V2 but are completely out of scope until V1 success conditions are met.

- Image generation (Gemini / Nano Banana Pro)
- Instagram and Facebook channels
- Dev.to article publishing
- General SEO blog content
- Telegram bot
- Post-signup nurture email sequence
- YouTube video pipeline

---

## V2.5 Scope — DO NOT BUILD UNTIL V2 IS DONE

- Landing page generator from app DNA
- Meta Pixel and Google Tag auto-install
- Small-budget test ad creation (Meta + Google Ads APIs)
- Ad comment classification
- Unified prospects table
- Retargeting audience setup

---

## V3 Scope — DO NOT BUILD UNTIL V2.5 IS DONE

- Cold email pipeline (Apollo → Hunter → Claude → Instantly.ai)
- Three-step follow-up sequences
- Telegram approval gate for cold email
- Research Hub Stream 3: Creator Research
- Conversation monitoring on X and LinkedIn (auto-reply opt-in)
- Conversation monitoring on Reddit, HN, Quora (draft only)

---

## V4 Scope — DO NOT BUILD UNTIL V3 IS DONE

- Revenue attribution funnel (UTM tracking + Stripe tracing)
- Self-learning weekly optimizer (revenue-weighted)
- Product Hunt launch package generator
- Builder tier at $79/month

---

## V5 Scope — DO NOT BUILD UNTIL V4 IS DONE

- YouTube video pipeline (script → voiceover → FFmpeg → upload)
- Instagram Reels and Facebook video
- Creator seeding pipeline
- VPS setup for FFmpeg

---

## V6 Scope — DO NOT BUILD UNTIL V5 IS DONE

- Multi-user workspace roles
- Agency tier ($199/month)
- White-label option
- Adaptive onboarding (developer vs non-technical founder)

---

## V7 Scope — DO NOT BUILD UNTIL V6 IS DONE

- Paid ads chat interface (Google Ads + Meta Marketing API)
- Hard budget ceilings enforced at system level
- Mandatory human confirmation before every spend
- Ad performance fed into self-learning optimizer

---

## Notes Log

> Use this section to record decisions made during build that affect architecture or scope.
> Add a dated note whenever something important is decided or changed.

| Date | Note |
|---|---|
| [date] | Project started |
| 2026-07-08 | Re-prioritized: Research Hub Stream 1 (Topic Research) and Stream 2 (Problem Discovery) pulled forward from V2.5, Stream 4 (Forum Opportunity Finder / the Opportunities page) pulled forward from V3, and Stream 5 (Competitor Gap Analysis) pulled forward from V4 — all four now built as V1 Week 3, ahead of the Publisher Cron Job and Stripe Billing (now Week 4 and Week 5). Reason: the Research and Opportunities pages, their API routes, and the manual-trigger rate-limiting system were already built UI-first; only the underlying Trigger.dev jobs were missing, so triggers were failing silently with nothing to show for it. Research Hub Stream 3 (Creator Research) stays in V3 — not part of this re-prioritization. |
