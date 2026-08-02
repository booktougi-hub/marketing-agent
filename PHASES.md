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

- Cold email pipeline: the monthly full-batch prospecting job and actual sending via Instantly.ai (ICP inference + a one-time 5-prospect personalized preview, with no sending, pulled forward to V1 — see Notes Log 2026-07-14)
- Three-step follow-up sequences
- Telegram approval gate for cold email (this is about approving sends, not the first-reply celebration alert — see Notes Log 2026-07-14)
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
| 2026-07-14 | Re-prioritized: a narrow slice of the Outreach/cold-email pipeline pulled forward from V3 into V1 — ICP inference (`trigger/icp-inference.ts`) and a one-time, non-sending 5-prospect personalized preview (`trigger/outreach-preview.ts`), shown together on the founder's first visit to the Outreach tab. Reason: same pattern as 2026-07-08 — the Outreach tab already exists and needs to show real proof of value before asking for setup, rather than an empty state or a form. Explicitly NOT pulled forward: the monthly full-batch `cold-email-prospecting` job, actual sending via Instantly.ai, three-step follow-up sequences, and the Telegram approval gate for cold email — all remain V3. The Part 5 "first reply" celebration alert is a monitoring feature, not a send-approval gate, but still depends on a Telegram bot, which is V2 scope and not built here — it's implemented as a logged TODO at the correct trigger point instead. This feature also can't run end-to-end yet regardless of phase: `APOLLO_API_KEY` and `HUNTER_API_KEY` are still blank placeholders in `.env.example`; icp-inference/outreach-preview will fail gracefully (logged, app status set to error) until real keys are added. |
| 2026-07-14 | Confirmed blocker (not a code bug): Apollo's People Search endpoint (`mixed_people/api_search`, called by `lib/apollo-client.ts`) is disabled entirely on Apollo's free tier — confirmed both by a live 403 with a real key and by Apollo's own docs ("Apollo developer tools follow your Apollo permissions, plan access, and credit availability... can't bypass those limits", https://docs.apollo.io/docs/apollo-api-faqs). Requires upgrading to a paid Apollo plan with API access (their Basic plan or above — see https://docs.apollo.io/docs/api-pricing) before `outreach-preview` can produce real prospects. Two real bugs in the original Apollo integration were found and fixed along the way (wrong endpoint path, and a response shape that didn't match Apollo's actual API — the search endpoint never returns email/trigger-event data at all, only a separate enrichment call does), so the code is correct and ready; it's purely gated on the Apollo plan now. |
| 2026-07-22 | Pulled forward, new scope not previously listed anywhere in this file (not V1, not V2-V7): an onboarding-audit agent (`trigger/onboarding-audit.ts`), a new `onboarding_findings` table, a `conversion_retention` key under `apps.app_settings`, and a new "Audits" sidebar grouping (its first tab, Onboarding — churn and CRO audits are explicitly NOT built, just the grouping they'll live in later). Reason: the diagnosis-first pipeline (2026-07-14) can identify `activation` as a growth bottleneck via `diagnosis.bottleneck`, but nothing downstream ever acted on that specific diagnosis — this closes that gap, same "the UI/upstream piece already implies this should exist" logic as the 2026-07-08 and 2026-07-14 re-prioritizations. Built on explicit request despite the scope gap, following this file's own established pull-forward pattern rather than skipping the CLAUDE.md V1-only rule silently. The job is NOT auto-triggered when `diagnosis.bottleneck === "activation"` — it only runs monthly (`monthly-onboarding-scan`, mirroring `monthly-competitor-scan`) or manually via the agent-action credit system (2 credits) — wiring a diagnosis-triggered auto-run was not part of what was asked and would need its own decision about credit cost/rate-limiting. |
| 2026-07-22 | Second of the "Audits" family built, same day: a churn-audit agent (`trigger/churn-audit.ts`), a new `churn_findings` table (identical shape to `onboarding_findings`), and the "Retention" tab in the "Audits" grouping created earlier today. No new `app_settings` fields needed — reads the same `conversion_retention` key, particularly `known_churn_rate`. Reuses `AuditFindingCard` as-is (no new UI component), confirming that component's "shared across every audit family" design actually holds up on its second real consumer. A CRO audit is still explicitly NOT built — the "Audits" grouping now has 2 of its eventual 3 tabs. |
| 2026-07-22 | Third of the "Audits" family built, same day: a cro-audit agent (`trigger/cro-audit.ts`), a new `cro_findings` table (identical shape to the other two), and the "Conversion" tab. Distinct from the other two audits in what it reads: no `app_settings` fields at all — it scrapes the app's own homepage and, if discoverable, its own signup page via Firecrawl, and reasons against that real content plus DNA using the `cro` and `signup` skills' frameworks combined. This is the first thing in the codebase that ever checks the actual page all of this tool's own generated marketing content drives traffic to. Reuses `AuditFindingCard` unchanged for a third time. (Corrected below: the "Audits" grouping was not actually complete at this point — a fourth, pricing audit followed the same day.) |
| 2026-07-22 | Fourth and last of the "Audits" family built, same day: a pricing-audit agent (`trigger/pricing-audit.ts`), a new `pricing_findings` table (identical shape to the other three), and the "Pricing" tab. The "Audits" grouping (Onboarding, Retention, Conversion, Pricing) is now genuinely complete. Audits the END USER's app pricing/packaging, not this SaaS's own pricing — the revenue-growth half of the original product goal, distinct from the awareness-focused work the rest of the codebase (and the other three audits) mostly does. Reads real competitor pricing already gathered by `trigger/competitor-research.ts` (the `competitor_research` table) for actual comparison, plus `known_signup_conversion_rate`/`known_churn_rate` from `conversion_retention`, plus a live scrape of the app's own pricing page if one exists. While building this, found and backfilled a pre-existing gap: `competitor_research` has existed since 2026-07-14 but was never documented in SCHEMA.md — its RLS and indexes were verified directly against the live table (not assumed) before this job was written to read from it, per CLAUDE.md rule #1. Reuses `AuditFindingCard` unchanged for a fourth time. |
| 2026-07-23 | Pulled forward, new scope not previously listed anywhere in this file (not V1, not V2-V7): a new "Analytics" sidebar grouping (Google Analytics, SEO, GEO), and the SEO evaluation track of the SEO/GEO scoring engine specified in the new root `SCORING.md` (read alongside CLAUDE.md/PRD.md/SCHEMA.md/PHASES.md every session per its own header). Built: `lib/seo/` (check registry, real Firecrawl/robots.txt/sitemap.xml/SerpAPI evaluators, weighted scoring math, finding generation), `trigger/seo-geo-audit.ts` (per-app job) + `trigger/weekly-seo-scan.ts` (its scheduler, mirroring the monthly-*-scan pattern but weekly per SCORING.md), the `seo_geo_scores`/`seo_geo_findings` tables (see SCHEMA.md), a `seo_audit` agent-action credit (2 credits, same pattern as the four audits), and a real SEO panel reusing `AuditFindingCard` unchanged (its 5th consumer) plus a new `SeoScoreSummary` component for the numeric score/band/full-check-list SCORING.md calls for. Explicitly sequenced and NOT built yet, per direct instruction: the GEO evaluation track (LLM-judged content/structure/freshness checks, citation tracking) and a real Google Analytics integration (a "Sign in with Google" OAuth flow reading GA4 data, same shape as the existing Twitter/LinkedIn `platform_credentials` pattern — blocked on a Google Cloud OAuth client that doesn't exist yet). Both have real, honest "not built yet" placeholder pages rather than broken links so the Analytics section's nav structure is complete now. Two SEO checks (`seo.title.unique`, `seo.links.internal_in`) can never be measured under this tool's current single-page-per-app audit scope (no full-site crawl, no backlink graph) — marked `measurable: false` and excluded from the weighted score rather than given a fabricated result; `seo.offpage.mention_trend` similarly starts unmeasurable and activates once a prior scoring run exists from ≥90 days back. |
| 2026-07-27 | GEO evaluation track built (deferred from 2026-07-23 above, per an audit of every dummy/demo-data feature in the app and an explicit decision to build it next since — unlike Google Analytics or PostEverywhere — it needs no new external credentials). Built: `lib/geo/` (check registry, LLM evaluator for the 7 content-quality/structure checks in one Claude call per SCORING.md's exact prompt spec, rule-based evaluators for FAQ-presence/thin-content/freshness/keyword-stuffing, scoring math, finding generation), wired into the SAME `trigger/seo-geo-audit.ts` run as SEO (one scrape, one job, both tracks — matching SCORING.md's "one engine, two tracks" diagram) rather than a second job, so GEO rides the existing free weekly cron + `seo_audit` credit-gated manual re-run with no new credit type. `brand_information.key_stats`/`tone_descriptors` are now folded into the GEO prompt as real proof points/voice guidance when that extraction has run, resolving a TODO left in `trigger/seo-geo-audit.ts` when it was first built. The GEO panel (`app-geo-view.tsx`/`geo/page.tsx`) now mirrors the SEO panel exactly — real data with a "no audit run yet" demo fallback, not a permanent "not built" placeholder — and the `seo-findings` API routes were generalized (no more `track='seo'` filter) to serve both panels instead of forking a duplicate GEO-only route, since finding ids are already globally unique. Explicitly NOT built, and NOT blocked on anything in this repo — blocked on new vendor credentials that don't exist yet: GEO's per-engine **citation tracking** (`geo_citation_log`, SCORING.md build-order step 7) requires actually querying ChatGPT/Perplexity/Gemini/Google AI Overviews to see if they cite a page, which needs OpenAI + Perplexity API keys neither in `.env.example` nor this project's vendor list; calibration logging (step 8) depends on step 7's data. The main GEO score/findings do not depend on citation data per SCORING.md ("stored in geo_citation_log, not in the main score"), so this is a clean, real, fully-functional partial delivery, not a stub. |
| 2026-08-01 | Following a full audit of `.claude/skills/` (39 of 47 marketing skills had zero code references), 8 of the unused skills were wired in, matching the existing skill-credit-comment pattern the four Audits-family jobs use — no new mechanism, skills are still never read at runtime. **SEO/GEO scoring engine**: `ai-seo` adapted into `lib/geo/evaluate.ts`'s `buildGeoEvalPrompt()` (the only LLM call anywhere in the SEO/GEO engine — every SEO check and every finding-text template is otherwise rule-based/static), appending Princeton-study-figure and answer-block-length grounding, mirrored into `SCORING.md`'s own copy of the same prompt so the code comment's "transcribed verbatim" claim stays true; `schema`, `site-architecture`, and `seo-audit` adapted into `lib/seo/scoring.ts`'s static `FINDING_TEMPLATES` text instead (the schema-markup and internal-link checks are rule-based with zero LLM involvement, so "strengthening reasoning" had nowhere else to land) — `seo.schema.present`/`seo.schema.faq` now name specific schema.org `@type`s and required properties, `seo.links.internal_out` now cites the 3-click rule and the 5-10-links-per-1,000-words guideline, `seo.penalty.thin_content` now uses seo-audit's SaaS-page-specific framing. No check id/weight/tier/polarity in either `checkRegistry.ts` changed — only finding/prompt *text*. A list of skill-derived candidate checks not yet built (per-`@type` schema validation, `@graph` detection, URL-structure/3-click-depth checks, `/llms.txt`/`/pricing.md` presence, answer-block word-count as its own check) was produced for review, not added. **Content generation**: `content-strategy` + `copywriting` + `copy-editing` + `marketing-psychology` adapted into both `trigger/content-generation.ts` paths — a condensed one-line-per-skill version for the short-form Twitter/LinkedIn path (pinned to `MODELS.BULK_CONTENT_FREE`, deliberately kept cheap, not bloated) and a fuller numbered-list version for the long-form Dev.to path (`lib/devto-article.ts`'s `buildDevtoSystemPrompt()`, already on `MODELS.STANDARD`/Sonnet). While wiring this in, also resolved the standing `TODO(brand-identity)` comment that had sat in `trigger/content-generation.ts` since before this file's Notes Log begins: `brand_information.tone_descriptors`/`words_to_avoid` are now actually queried and folded into both prompts via a new shared `buildBrandVoiceBlock()` helper, with both prompts stating explicitly that brand voice always overrides the general craft principles when they conflict — this was necessary, not optional, for that precedence rule to be about real data rather than aspirational prompt text. `key_stats` (the TODO's third field) was deliberately left for a follow-up — proof-point citation needs its own no-fabrication framing, not just folded in alongside voice. `app/api/apps/[id]/content/from-research/route.ts` shares `buildDevtoSystemPrompt()` so it picks up the craft-principles addition automatically, but was not wired for brand voice — out of this pass's scope, noted as a natural next step. Also fixed, as flagged by the audit: two comments (`lib/chat/assemble-context.ts`, `lib/chat/tools.ts`) referencing a "SKILL.md prompt-caching guidance" that resolved to no actual file anywhere in `.claude/skills/` — the dangling `SKILL.md` clause was removed from both, the rest of each comment (which was accurate) kept. |
| 2026-08-01 | Second batch of skill wiring, same day: 9 more previously-unreferenced marketing skills adapted into 6 job files' LLM prompts, same skill-credit-comment pattern, no new mechanism. **DNA/ICP** (`customer-research` + `product-marketing`): a `DNA_EXTRACTION_FRAMEWORK` block (JTBD, product-category-as-"shelf", competitive-tier distinction, verbatim-language, proxy-source reasoning for review-less early-stage products) added to `lib/dna-extraction-core.ts`'s `buildDnaSystemPrompt()`, shared identically by both branches (`hasBrandPricing` true/false) and by `trigger/dna-reextraction.ts` since it imports the same `runDnaExtraction()`; a condensed 4-item version added to `trigger/icp-inference.ts`'s `SYSTEM_PROMPT` (persona-is-not-an-average, JTBD, push/pull dynamics, exclusion-as-part-of-the-profile), kept shorter since that job stays on the `SYNTHESIS` tier, not `STANDARD`. **Competitor discovery** (`competitors`): adapted into `trigger/competitor-gap-analysis.ts`'s `VERIFICATION_SYSTEM_PROMPT` specifically — the "is this candidate a genuine competitor" judgment call, made up to `MAX_CANDIDATES_TO_VERIFY` (12) times per run, previously one unstructured paragraph. Deliberately did NOT touch `lib/competitor-discovery.ts` (the onboarding-pipeline discovery path) or `trigger/competitor-profile-research.ts`/`lib/competitor-profile-core.ts` (already wired to the separate `competitor-profiling` skill) — most of the `competitors` skill's own content is about `/vs/`/`/alternatives/` page formats this codebase doesn't build, so only its direct-vs-adjacent and accuracy-under-scrutiny principles were load-bearing here. **Distribution/community** (`social` + `community-marketing`): two labeled framework blocks added to `trigger/forum-opportunity-finder.ts`'s `SYSTEM_PROMPT`, condensed for the `BULK_CLASSIFICATION` tier it runs on via `lib/research-job.ts`'s shared `runResearchStream` (one call per candidate thread, this codebase's highest-call-volume LLM path) — give-before-you-ask, real-fit-vs-topical-adjacency, spam-signal avoidance, and platform-native voice/specificity. **Outreach** (`cold-email` + `emails`): two framework blocks added to `trigger/outreach-preview.ts`'s `EMAIL_SYSTEM_PROMPT` — a dominant cold-outreach block (peer-not-vendor voice, the personalization-removal test, one-ask/low-friction CTA, avoid-the-tells) plus a thin single-email-structure block from `emails/SKILL.md`, since that skill is mostly about multi-touch lifecycle sequences that don't apply to this one-off preview email. **Strategy** (`marketing-council` + `marketing-ideas` + `marketing-plan` + `marketing-loops`): the richest adaptation in this batch, an 8-item `=== CORE FRAMEWORK ===` block added to `trigger/strategy-generation.ts`'s `SYSTEM_PROMPT` (AARRR-as-organizing-lens, JTBD, stage/budget-appropriate channels at a sustainable cadence, opening a new growth avenue rather than doubling down, product-specific customization, naming the accepted risk, banning generic-language-without-a-specific-move) — justified by this being the one `HIGH_STAKES_SYNTHESIS`/Opus-tier call in the batch, one strategy per app read directly by the founder; `marketing-loops` contributed the least (it's about maintenance loops, not strategy-setting) so its one usable idea (cadence matching signal speed) was folded into an existing item rather than given its own numbered entry. All five edits are additive reasoning-grounding only — no schema, zod shape, data-fetching, or output-field change in any of the six files. |
