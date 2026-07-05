# CLAUDE.md — Master Context for Claude Code

> Read this file at the start of every session before writing any code.
> Every rule here is non-negotiable. If you are unsure about anything, re-read this file.

---

## Project Overview

**Name:** AI Marketing Agent SaaS  
**One-line description:** A fully autonomous marketing SaaS that reads an app URL, generates a marketing strategy, creates content, publishes to social channels, researches community opportunities, and learns from performance data — requiring zero marketing knowledge from the user.

**Dual purpose:**
1. Used internally to market the developer's own apps (AiSkillsGuard, AppFactory, SandeshAI, ToolNest)
2. Sold as a SaaS subscription to solo developers and non-technical app owners

---

## Tech Stack — Exact Versions

| Layer | Tool | Notes |
|---|---|---|
| Frontend + API | Next.js 15 | App Router, TypeScript strict |
| Styling | Tailwind CSS v4 | shadcn/ui components |
| Database | Supabase | PostgreSQL 15, RLS on every table |
| Auth | Supabase Auth | Email/password + Google OAuth |
| Storage | Supabase Storage | For generated images and media |
| Realtime | Supabase Realtime | Dashboard live updates |
| Background jobs | Trigger.dev | All agent jobs run here |
| Social publishing | PostEverywhere API | $19/month, covers Twitter/LinkedIn/Instagram/Facebook |
| Image generation | Google Gemini API | Nano Banana Pro via Gemini |
| Image processing | Sharp | Resizing and compression only |
| Web scraping | Firecrawl API | DNA extraction from app URLs |
| LLM — strategy | Anthropic Claude | Model: claude-sonnet-5 ONLY |
| LLM — content | OpenRouter | Free Llama 3.3 70B for bulk content generation |
| Cold email | Instantly.ai API | Sending only |
| Prospect research | Apollo.io API | Contact sourcing |
| Email verification | Hunter.io API | Before adding to cold email queue |
| Billing | Stripe | Subscriptions + webhooks |
| Telegram bot | Telegraf | Approval flows + alerts |
| Secrets | Vercel env vars | No .env files in repo ever |
| Deployment | Vercel | Auto-deploy on push to main |
| Monitoring | Sentry free tier | Error tracking |

---

## Project Folder Structure

```
/
├── app/
│   ├── auth/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── dashboard/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── apps/
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx
│   │   │       ├── content/page.tsx
│   │   │       ├── analytics/page.tsx
│   │   │       └── settings/page.tsx
│   │   └── settings/page.tsx
│   ├── api/
│   │   ├── apps/route.ts
│   │   ├── apps/[id]/route.ts
│   │   ├── apps/[id]/approve/route.ts
│   │   ├── apps/[id]/pause/route.ts
│   │   └── webhooks/
│   │       └── stripe/route.ts
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/              (shadcn components)
│   ├── dashboard/       (dashboard-specific components)
│   ├── apps/            (app card, app form components)
│   └── shared/          (layout, navigation, loading states)
├── lib/
│   ├── supabase.ts      (browser client)
│   ├── supabase-server.ts (server/admin client)
│   ├── stripe.ts
│   ├── utils.ts
│   └── constants.ts
├── trigger/
│   ├── dna-extraction.ts
│   ├── strategy-generation.ts
│   ├── content-generation.ts
│   ├── publisher.ts
│   └── index.ts
├── types/
│   └── index.ts         (all shared TypeScript types)
├── middleware.ts
├── CLAUDE.md            (this file)
├── PRD.md
├── SCHEMA.md
└── PHASES.md
```

---

## Coding Conventions — Follow These Exactly

### TypeScript
- Strict mode is always on. Never use `any`. Use `unknown` if type is genuinely unknown.
- All shared types live in `/types/index.ts`. Never define types inline in component files.
- Use Zod for validating all API request bodies. No raw request.body access.

### Supabase
- **Every single Supabase query that reads or writes data MUST include `workspace_id` in the WHERE clause.** No exceptions. Ever.
- Always use `supabaseAdmin` (service role) in API routes and Trigger.dev jobs.
- Always use the browser `supabase` client in React components.
- Never expose the `SUPABASE_SERVICE_ROLE_KEY` to the browser. It only ever appears in server-side code.
- Check RLS policies exist before writing any query against a new table.

### API Routes
- Every API route must validate the session first using Supabase Auth helpers.
- Extract `workspace_id` from the authenticated user's membership record, never from the request body.
- Return consistent error shapes: `{ error: string, code: string }`.
- Use HTTP status codes correctly — 401 for unauthenticated, 403 for unauthorised, 422 for validation errors, 500 for server errors.

### Environment Variables
- All API keys come from `process.env`. Never hardcode any key, token, or secret.
- For new env vars needed, add a comment in the code and add the variable name to the `.env.example` file.
- Never commit `.env.local` or any file containing real secrets.

### Trigger.dev Jobs
- Every job must handle errors gracefully — catch failures, update the app status to `error`, log to Sentry.
- Jobs must be idempotent where possible — safe to retry if they fail halfway.
- Always pass `workspace_id` and `app_id` as part of the job payload. Never query without them.

### LLM Calls
- **Claude model:** always use `claude-sonnet-5`. Never use a different model string.
- **Bulk content generation:** use OpenRouter with `meta-llama/llama-3.3-70b-instruct:free`.
- Always parse LLM JSON responses inside a try/catch. Never assume valid JSON.
- Always include a system prompt that specifies the output format before the user prompt.

### Components
- Use shadcn/ui components as the base. Do not build custom UI from scratch unless shadcn has no equivalent.
- All loading states must be handled — never leave a UI in a blank state while data is fetching.
- Use Supabase Realtime subscriptions on the app detail page to update status without refresh.

---

## Rules That Are Never Broken

1. **Never skip RLS.** If a table does not have RLS enabled and policies set, do not write queries against it.
2. **Never expose service role key client-side.** Zero exceptions.
3. **Never hardcode API keys.** Zero exceptions.
4. **Never build V2+ features during V1.** If the feature is not in the V1 checklist in PHASES.md, it does not get built now.
5. **Never use a different Claude model string.** Only `claude-sonnet-5`.
6. **Never send emails or publish posts without the workspace approval gate** — for cold email and ad spend specifically.
7. **Never store workspace credentials (OAuth tokens, API keys) in plaintext.** Encrypt with AES-256 before storing.

---

## Current Phase

**V1 — MVP only.** See PHASES.md for the complete V1 checklist.

When in doubt about whether something is in scope, check PHASES.md. If it is not on the V1 checklist, do not build it.

---

## How to Start a New Session

1. Read this file (CLAUDE.md)
2. Read PHASES.md to confirm what is in scope
3. Read SCHEMA.md if the task involves the database
4. Ask what specific task is needed today
5. Build only that task. Confirm it works before moving on.

<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.claude/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-realtime-and-frontend`, `trigger-getting-started`, `trigger-cost-savings`, `trigger-chat-agent-advanced`, `trigger-authoring-tasks`, `trigger-authoring-chat-agent`.
<!-- TRIGGER.DEV SKILLS END -->
