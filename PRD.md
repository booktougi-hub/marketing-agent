# PRD.md — Product Requirements Document

> This document describes what the product is, who it serves, and what it does across all phases.
> Claude Code uses this as the source of truth for product behaviour and feature intent.

---

## What the Product Is

The AI Marketing Agent is a fully autonomous SaaS that markets any software product — given only the app's URL — without requiring the user to know anything about marketing.

The user pastes a URL. The tool reads the app, understands what it does and who it is for, creates a complete marketing strategy, generates content for all major social channels, publishes that content automatically on a schedule, researches community forums for problems the app solves and provides links and drafted replies, identifies relevant content creators, monitors competitor gaps, and gets smarter every week by learning from what actually drives revenue.

The developer's only recurring job is a one-tap approval for cold email batches before they send. Everything else runs autonomously.

---

## The Two Audiences

### Audience One — Solo Developers
People who built their own apps, tools, Chrome extensions, or SaaS products. Technically capable but time-poor. They ship products that nobody knows about because they spend all their time building, not marketing.

**Positioning:** "You build it. We market it. Automatically."  
**Reached via:** IndieHackers, Twitter/X, Product Hunt, Dev.to, developer communities.

### Audience Two — Non-Technical App Owners
People who commissioned an app through a freelancer, agency, or no-code platform. They have a finished product and no idea how to get customers.

**Positioning:** "You built your app. Now get customers. Automatically."  
**Reached via:** Freelance platform communities, no-code builder groups (Bubble, Webflow, Glide), small business networks.

---

## Core Product Promise

One URL. No forms. No marketing knowledge required. The agent figures everything out from the app itself and starts working.

---

## Feature Tiers

### Tier 1 — Foundation (V1 MVP, must work flawlessly)

| Feature | What It Does |
|---|---|
| App DNA Extraction | Reads the app URL via Firecrawl. Extracts: name, tagline, features, pricing, audience, problem solved, competitors mentioned, tone. Saves as structured JSON. |
| AI Strategy Generation | Produces: 3 buyer personas, 5 content pillars, brand tone guide, channel priorities. Generated from DNA using Claude. |
| Content Writing — Two Channels | Generates 15 Twitter posts and 8 LinkedIn posts per month per app. Platform-native tone for each. Uses Llama 3.3 70B via OpenRouter. |
| Automated Publishing | Cron job every 15 minutes publishes scheduled content via PostEverywhere API. No manual action required after initial approval. |
| Basic Analytics Dashboard | Posts published count and engagement metrics pulled from PostEverywhere. Simple, readable. |
| Stripe Billing | Free tier (1 app, 10 posts/month) and Solo tier at $29/month (3 apps, unlimited posts). Webhook updates workspace plan on payment events. |

### Tier 2 — Differentiators (V2 and V2.5)

| Feature | What It Does |
|---|---|
| AI Image Generation | Branded marketing images for Instagram and Facebook using Google Gemini. Text rendered natively in image. Sharp for final resize to platform spec. |
| YouTube Video Pipeline | Script → ElevenLabs voiceover → Pexels footage → FFmpeg compile → Gemini thumbnail → YouTube Data API upload. |
| Dev.to Auto-Publishing | One full technical article per week per app, written and published automatically via Dev.to API. |
| General SEO Blog | Non-technical articles targeting Google search terms for non-developer audiences. |
| Telegram Bot | Weekly summary, post approval flow, pause and resume commands. Runs via Telegraf. |
| Post-Signup Nurture Sequence | Three-email drip converting email captures into paying customers of the user's app. |
| Topic Research (Research Hub Stream 1) | SerpAPI + Google Trends + Reddit + Twitter search for trending topics in the app's problem space. Feeds content agent. |
| Problem Discovery (Research Hub Stream 2) | Reddit complaint language, App Store/G2/Capterra negative reviews, Quora questions. Returns top 5 problems in real user language with source URLs. |

### Tier 3 — Revenue and Reach Amplifiers (V3 and V4)

| Feature | What It Does |
|---|---|
| Cold Email Pipeline | Apollo prospect research → Hunter verification → Claude personalisation → Instantly.ai sending → Telegram approval gate before any send. |
| Conversation Monitoring — X and LinkedIn | Finds relevant threads, drafts replies. Auto-reply available as opt-in toggle. Uses existing OAuth tokens. |
| Conversation Monitoring — Reddit, HN, Quora | Finds relevant threads, drafts replies. Manual posting only — agent never auto-posts on community platforms. |
| Creator Research (Research Hub Stream 3) | YouTube Data API + Twitter + Beehiiv + Substack. Ranked creator list with fit explanation and drafted outreach pitch per creator. |
| Forum Opportunity Finder (Research Hub Stream 4) | Reddit + Quora + Stack Overflow + SerpAPI search for existing high-traffic threads. Returns URL + drafted reply + relevance score. Human always posts. |
| Revenue Attribution Funnel | UTM on every generated link. Stripe events traced back to originating post/email/ad. Optimizer weighted by revenue, not engagement. |
| Self-Learning Optimizer | Weekly cycle: collect metrics → Claude analysis → strategy version update → A/B test proposal → rollback if worse. |
| Competitor Gap Analysis (Research Hub Stream 5) | Monthly audit: App Store/G2/Capterra reviews for competitors, pricing gap analysis, positioning gaps. Feeds back into strategy pillars. |

### Tier 4 — Long-Term Moat (V5, V6, V7)

| Feature | What It Does |
|---|---|
| Content Creator Seeding | Ranked micro-influencer identification, explained selection rationale, drafted partnership pitches, sent via cold email pipeline. |
| Multi-User Workspaces | Owner, admin, viewer roles. For agencies managing multiple client apps. |
| Agency White-Label | Platform runs under the agency's own brand for their clients. |
| Paid Ads Co-Pilot | Chat interface for Google and Meta ads. Hard budget caps enforced at system level. Human confirmation required before every spend. |
| App Store Optimisation (ASO) | Audits App Store and Google Play listing against DNA. Suggests keyword and description rewrites. |
| GEO — AI Search Presence | Structured content and directory presence to get the app cited by ChatGPT, Perplexity, and Claude when users ask about relevant tools. |
| Directory Submission Agent | Finds relevant directories (AlternativeTo, SaaSHub, Product Hunt collections). Drafts and submits listings. |

---

## Research Intelligence Hub — Five Streams

The Research Intelligence Hub is a dedicated system layer that runs five research streams on a weekly (and monthly for Stream 5) schedule. Each stream feeds intelligence into the appropriate downstream agent.

| Stream | Name | Feeds Into | Activated |
|---|---|---|---|
| 1 | Topic Research | Content agent — richer post topics from real search demand | V2.5 |
| 2 | Problem Discovery | Content agent, cold email subject lines, ad copy | V2.5 |
| 3 | Creator Research | Outreach agent — ranked creator pitches with rationale | V3 |
| 4 | Forum Opportunity Finder | Reply agent — thread URLs with drafted replies | V3 |
| 5 | Competitor Gap Analysis | Strategy agent — monthly positioning refresh | V4 |

---

## Eight-Phase Release Plan Summary

| Phase | Name | Core Addition | Timeline | Success Condition |
|---|---|---|---|---|
| V1 | MVP: Core Loop | URL → strategy → Twitter + LinkedIn posting | Weeks 1–5 | 10 paying users, posts running with zero intervention |
| V2 | Content Depth | Images, Dev.to, SEO blog, nurture email, Telegram bot | Months 2–3 | Paid conversion >30%, churn <5% |
| V2.5 | Validation and Leads | Research Hub streams 1–2, test ads, lead capture | Month 3 | Test ad run, landing page live, leads nurtured |
| V3 | Outreach and Conversation | Cold email, Research Hub streams 3–4, forum replies | Months 3–5 | Real cold email replies, $59/month tier launched |
| V4 | Revenue Intelligence | Research Hub stream 5, revenue funnel, self-learning optimizer | Months 5–8 | System proves which channel makes money |
| V5 | Video and Creator Growth | YouTube pipeline, Instagram Reels, creator seeding | Months 8–12 | Video publishing automatically, first creator partnerships |
| V6 | Platform Expansion | Multi-user workspaces, agency tier, white-label | Months 12–18 | MRR above $15,000 with agency customers |
| V7 | Paid Ads Co-Pilot | Google and Meta ads chat interface, hard budget caps | Month 18+ | Platform financially stable, revenue cushion exists |

---

## Pricing Model

| Tier | Price | Apps | Key Inclusions |
|---|---|---|---|
| Free | $0 | 1 | 10 posts/month, Twitter and LinkedIn |
| Solo | $29/month | 3 | Unlimited posts, all V1 and V2 channels |
| Growth | $59/month | 5 | Cold email, Research Hub, forum finder |
| Builder | $79/month | Unlimited | Revenue optimizer, gap analysis, video |
| Agency | $199/month | Unlimited clients | Team seats, white-label, client workspaces |
| Ads add-on | +$50–75/month | Any tier | Google and Meta paid ads co-pilot |

---

## The One Human Approval Gate

Cold email batches and paid ad campaigns **always** require explicit one-tap human approval via Telegram before anything sends or spends. This is a permanent design constraint, not a temporary workaround. It never becomes automatic regardless of how mature the platform is.
