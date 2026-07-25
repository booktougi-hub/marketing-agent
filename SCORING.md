# SCORING.md — SEO & GEO Scoring Engine

> Reference file for Claude Code. Read this every session alongside CLAUDE.md, PRD.md, SCHEMA.md, PHASES.md.
> Last updated: 2026-07-23

---

## Purpose

This file specifies the scoring engine that evaluates every app's website pages and every piece of content the tool generates, across two independent dimensions:

- **SEO** — technical retrievability and on-page signals that determine whether search engines and AI engines can find, index, and rank the page
- **GEO** — generative engine optimisation signals that determine whether AI engines (ChatGPT, Perplexity, Claude, Gemini) cite the page as a source

These are evaluated separately, displayed separately in the UI, and produce separate findings. Never merge them into a single score.

---

## Architecture: one engine, two evaluation tracks, two UIs

```
                    ┌─────────────────────┐
                    │   Evaluation engine  │
                    │   (shared trigger)   │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
    ┌─────────────────┐               ┌─────────────────┐
    │   SEO evaluator  │               │   GEO evaluator  │
    │  Rule-based only │               │  LLM + rule mix  │
    └────────┬────────┘               └────────┬────────┘
             ▼                                 ▼
    ┌─────────────────┐               ┌─────────────────┐
    │    SEO score    │               │    GEO score    │
    │   + findings    │               │   + findings    │
    └────────┬────────┘               └────────┬────────┘
             ▼                                 ▼
    ┌─────────────────┐               ┌─────────────────┐
    │  SEO panel UI   │               │  GEO panel UI   │
    │  (separate tab) │               │  (separate tab) │
    └─────────────────┘               └─────────────────┘
```

Two entry triggers, same downstream engine:

1. **Existing site pages** — weekly Trigger.dev job `seo-geo-audit.ts`, Firecrawl crawl, SerpAPI rank lookup, credit-gated by tier
2. **New content drafts** — appended step at end of `content-generation` job, scores draft before it enters approve queue, LLM checks credit-gated

---

## Database schema

```sql
-- One row per check run, per page (or per app for brand-scope checks)
CREATE TABLE seo_geo_scores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        uuid NOT NULL REFERENCES apps(id),
  page_url      text,                        -- null for brand-scope checks
  page_id       uuid,                        -- null for brand-scope checks
  content_id    uuid,                        -- set when scoring a draft
  track         text NOT NULL CHECK (track IN ('seo', 'geo')),
  score         integer NOT NULL,            -- 0-100
  dim_scores    jsonb NOT NULL,              -- { retrievability: 72, off_page: 41, content_geo: 68 }
  check_results jsonb NOT NULL,             -- full per-check vector { check_id: { pass: bool, value: any, confidence: float } }
  run_at        timestamptz DEFAULT now()
);

-- One row per actionable finding surfaced to the user
CREATE TABLE seo_geo_findings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id            uuid NOT NULL REFERENCES apps(id),
  page_url          text,
  page_id           uuid,
  content_id        uuid,
  track             text NOT NULL CHECK (track IN ('seo', 'geo')),
  check_id          text NOT NULL,           -- e.g. 'seo.sitemap.included'
  dimension         text NOT NULL,           -- 'retrievability' | 'off_page' | 'content_geo'
  evidence_tier     integer NOT NULL,        -- 1 | 2 | 3
  expected_gain     float NOT NULL,          -- weight × (1 - current_score) × tier_multiplier
  title             text NOT NULL,
  explanation       text NOT NULL,
  confidence_label  text NOT NULL,           -- 'high' | 'moderate' | 'low — evidence disputed'
  remediation       jsonb,                   -- { type: 'diff'|'pr'|'route_to_forum', payload: ... }
  status            text DEFAULT 'open' CHECK (status IN ('open', 'applied', 'skipped')),
  skip_count        integer DEFAULT 0,
  created_at        timestamptz DEFAULT now()
);

-- Citation tracking — populated monthly by citation-check job
CREATE TABLE geo_citation_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        uuid NOT NULL REFERENCES apps(id),
  page_url      text NOT NULL,
  content_id    uuid,
  engine        text NOT NULL,              -- 'chatgpt' | 'perplexity' | 'gemini' | 'google_ai'
  query         text NOT NULL,
  cited         boolean NOT NULL,
  score_at_run  jsonb,                      -- snapshot of check_results at time of citation check
  checked_at    timestamptz DEFAULT now()
);
```

---

## SEO evaluation track

### Purpose

Determines whether the page can be found, indexed, crawled, and ranked. Every check is rule-based — no LLM call needed. Cheap, deterministic, high confidence.

### Evidence basis

C-SEO Bench (Puerto et al., NeurIPS 2025): traditional retrieval ranking has the largest measured effect on citation rankings in LLM output — larger than any content-level tactic. This is the heaviest lever.

Ahrefs 75k-brand study (2025): SERP position #1 earns 33% AI citation probability; position #10 drops to 13%. Ranking matters for AI citation, not just human traffic.

### SEO score dimensions and weights

| Dimension | Weight | Scope |
|---|---|---|
| Retrievability | 70% | Page |
| Off-page presence | 30% | Brand (app-level, not page-level) |

### SEO check registry

Each check: `id`, `weight` (within dimension, sums to 1.0 per dimension), `evaluator`, `evidence_tier`, `polarity`.

**Retrievability checks (70% of SEO score)**

| Check ID | Description | Weight | Tier | Polarity |
|---|---|---|---|---|
| `seo.index.crawlable` | Page not blocked by robots.txt or meta noindex | 0.20 | 1 | positive |
| `seo.index.ai_accessible` | GPTBot, ClaudeBot, PerplexityBot not disallowed | 0.15 | 1 | positive |
| `seo.sitemap.present` | sitemap.xml exists at root | 0.08 | 1 | positive |
| `seo.sitemap.included` | This page URL is in the sitemap | 0.10 | 1 | positive |
| `seo.rank.serp_position` | SerpAPI position for target query (score = max(0, 1 - position/20)) | 0.20 | 1 | positive |
| `seo.title.present` | `<title>` tag exists and is non-empty | 0.05 | 1 | positive |
| `seo.title.unique` | Title differs from other pages in this app | 0.03 | 1 | positive |
| `seo.meta.description` | Meta description present | 0.03 | 1 | positive |
| `seo.heading.h1_single` | Exactly one H1 on the page | 0.04 | 1 | positive |
| `seo.heading.hierarchy` | H2s follow H1, H3s follow H2 (no skips) | 0.03 | 2 | positive |
| `seo.schema.present` | Any schema.org markup present | 0.03 | 2 | positive |
| `seo.schema.faq` | FAQ schema present (especially valuable for AI citation) | 0.03 | 2 | positive |
| `seo.links.internal_in` | At least 2 other pages link to this one | 0.02 | 2 | positive |
| `seo.links.internal_out` | This page links to at least 2 others | 0.02 | 2 | positive |
| `seo.http.ok` | Page returns 200, no redirect chain > 1 hop | 0.02 | 1 | positive |
| `seo.canonical.sane` | Canonical tag present and points to self or correct URL | 0.02 | 1 | positive |
| `seo.penalty.keyword_stuffing` | Keyword density outlier (>4% for primary term) | — | 1 | **penalty: -15 pts** |
| `seo.penalty.thin_content` | Word count < 50% of median competitor page for same query | — | 2 | **penalty: -10 pts** |

**Off-page checks (30% of SEO score) — brand-scoped, computed weekly**

| Check ID | Description | Weight | Tier | Source |
|---|---|---|---|---|
| `seo.offpage.mention_count` | Distinct third-party domains mentioning the brand | 0.40 | 1 | Firecrawl + search |
| `seo.offpage.mention_trend` | 90-day mention trend (growing / flat / declining) | 0.20 | 1 | Firecrawl + search |
| `seo.offpage.branded_search` | Branded search volume trend via Google Trends | 0.20 | 1 | Google Trends API |
| `seo.offpage.community_presence` | Presence in Reddit/HN/Dev.to threads (reuse Forum Finder output) | 0.15 | 1 | Forum Finder job |
| `seo.offpage.directory_presence` | Listed in ≥3 relevant product directories | 0.05 | 2 | SerpAPI |

### SEO scoring math

```typescript
function computeSEOScore(results: CheckResultMap): SEOScore {
  const ret = weightedMean(results, RETRIEVABILITY_CHECKS); // 0-1
  const offpage = weightedMean(results, OFFPAGE_CHECKS);    // 0-1

  const retPenalty = sum(PENALTY_CHECKS.map(c => results[c.id].triggered ? c.penalty : 0));
  const retAdjusted = Math.max(0, ret * 100 + retPenalty);

  return {
    retrievability: Math.round(retAdjusted),
    off_page: Math.round(offpage * 100),
    composite: Math.round(retAdjusted * 0.70 + offpage * 100 * 0.30),
  };
}
```

### SEO score bands

| Range | Label | UI treatment |
|---|---|---|
| 0–49 | Needs work | Red badge |
| 50–74 | Workable | Amber badge |
| 75–100 | Strong | Green badge |

---

## GEO evaluation track

### Purpose

Determines whether AI engines are likely to cite this page as a source when answering queries relevant to the app. Checks are content-quality and structure signals. A mix of rule-based and LLM-judged checks.

### Evidence basis

Princeton GEO study (Aggarwal et al., KDD 2024): statistics, quotations, and citations each showed 25–40% visibility lift. Strongest equaliser effect for small/unranked sites — small apps gain disproportionately.

C-SEO Bench (Puerto et al., NeurIPS 2025): most conversational SEO tactics are ineffective or harmful, especially when many competitors adopt them simultaneously. Content quality and source relevance dominate.

Seer Interactive (2025): 65% of AI bot hits target content published within the past year. Freshness is a direct input to citation probability.

Ahrefs (2025): only 38% of AI Overview citations come from pages in Google's top 10. Well-structured pages from small sites can outrank bigger ones on citation. This is the core opportunity for your users.

### GEO score dimensions and weights

| Dimension | Weight | Scope |
|---|---|---|
| Content quality | 60% | Page |
| Structure & format | 25% | Page |
| Freshness | 15% | Page |

Off-page signals do NOT appear in the GEO score. They already appear in SEO. The GEO score covers only what is in the page's own content.

### GEO check registry

**Content quality checks (60% of GEO score)**

| Check ID | Description | Weight | Tier | Evaluator |
|---|---|---|---|---|
| `geo.content.answer_first` | Direct answer in first 1–2 sentences | 0.25 | 2 | LLM |
| `geo.content.entity_clear` | "X is a [category] that [does Y]" stated early | 0.20 | 2 | LLM |
| `geo.content.statistics` | ≥1 specific verifiable statistic per major claim | 0.20 | 3 | LLM |
| `geo.content.citations` | ≥1 external credible source cited | 0.20 | 3 | LLM |
| `geo.content.quotation` | ≥1 quote-style attribution | 0.15 | 3 | LLM |
| `geo.penalty.keyword_stuffing` | Keyword stuffing (measured 10% worse than doing nothing in GEO study) | — | 1 | rule: **penalty -15 pts** |

**Structure & format checks (25% of GEO score)**

| Check ID | Description | Weight | Tier | Evaluator |
|---|---|---|---|---|
| `geo.structure.standalone_chunks` | Each H2 section readable standalone (no "as mentioned above") | 0.30 | 2 | LLM |
| `geo.structure.faq_present` | Explicit FAQ section with Q&A format | 0.25 | 2 | rule |
| `geo.structure.fluency` | Passes a readability/fluency check (not machine-voice) | 0.25 | 2 | LLM |
| `geo.structure.thin_vs_competitors` | Word count ≥50% of top-cited competitor pages for same query | 0.20 | 2 | rule |

**Freshness checks (15% of GEO score)**

| Check ID | Description | Weight | Tier | Evaluator |
|---|---|---|---|---|
| `geo.freshness.published_within_1yr` | Published or updated within 12 months | 0.60 | 1 | rule |
| `geo.freshness.published_within_2yr` | Published or updated within 24 months (partial credit) | 0.40 | 1 | rule |

### GEO per-engine citation scoring

Stored in `geo_citation_log`, not in the main score. Shown in the GEO UI panel as a per-engine breakdown. Do not blend into the main GEO score — engines index differently and a user needs to know where they are missing, not a blended number that hides it.

Run monthly, auto-generate the query set from DNA extraction + competitor-research output (no manual entry by the user). Track per engine: ChatGPT, Perplexity, Gemini, Google AI Overviews.

### Tier multipliers for expected gain calculation

```typescript
const TIER_MULTIPLIERS = { 1: 1.0, 2: 0.75, 3: 0.4 };

function expectedGain(check: Check, currentScore: number): number {
  return check.weight * (1 - currentScore / 100) * TIER_MULTIPLIERS[check.evidenceTier];
}
```

This guarantees a Tier 1 retrievability failure always surfaces before a Tier 3 "add a statistic" finding, regardless of current score. Surface top 2 findings only.

### GEO score bands

Same bands as SEO (0–49 / 50–74 / 75–100) but independent — a page can score 80 SEO and 30 GEO. Display them separately, never average them.

---

## LLM call specification for GEO content checks

One call per content piece, not one call per check. Return all GEO checks in a single structured response to minimise cost.

```typescript
const GEO_EVAL_PROMPT = `
You are evaluating a piece of content for generative engine optimisation signals.
Return ONLY valid JSON — no preamble, no markdown fences.

Content to evaluate:
<content>
{{CONTENT}}
</content>

Evaluate each of the following and return a JSON object with this exact shape:
{
  "answer_first": { "pass": boolean, "location": "first sentence text if pass, else null", "confidence": 0.0-1.0 },
  "entity_clear": { "pass": boolean, "location": "the entity statement if found, else null", "confidence": 0.0-1.0 },
  "statistics": { "pass": boolean, "examples": ["stat 1", "stat 2"], "confidence": 0.0-1.0 },
  "citations": { "pass": boolean, "examples": ["source 1"], "confidence": 0.0-1.0 },
  "quotation": { "pass": boolean, "examples": ["quote excerpt"], "confidence": 0.0-1.0 },
  "standalone_chunks": { "pass": boolean, "weak_sections": ["H2 heading of any section that isn't standalone"], "confidence": 0.0-1.0 },
  "fluency": { "pass": boolean, "issues": ["specific fluency problem if any"], "confidence": 0.0-1.0 },
  "keyword_stuffing": { "triggered": boolean, "offending_term": "term if triggered, else null" }
}

Rules:
- "location" fields must be the actual text from the content, not a description of it
- Confidence 0.9+ = very clear; 0.5-0.89 = judgment call; below 0.5 = uncertain
- For statistics: only pass if the stat is specific and verifiable (a number, a percentage, a named study). Vague claims like "many users" do not count.
- For citations: only pass if an external source is named or linked. Self-referential links do not count.
`;
```

Use `claude-sonnet-5` (same as all other agent jobs). Gate this call behind the Agent Action Credit pool — deduct 1 credit per content piece evaluated. Do not call for Tier 1 rule checks.

---

## Finding card specification

Every finding, SEO or GEO, renders through the shared `AuditFindingCard` component. No new UI components. The `track` field (`'seo'` or `'geo'`) controls the badge colour and the remediation button label.

**Finding card fields:**

```typescript
type FindingCard = {
  track: 'seo' | 'geo';
  title: string;                // plain language, ≤10 words
  explanation: string;          // what's missing, why it matters, what the evidence says
  confidence_label: string;     // 'high' | 'moderate' | 'low — evidence disputed'
  evidence_tier: 1 | 2 | 3;
  expected_gain: number;        // shown as "+N pts if fixed"
  remediation: Remediation;
};

type Remediation =
  | { type: 'diff'; before: string; after: string; section: string }    // page-level fix
  | { type: 'pr'; files: PatchFile[] }                                  // GitHub PR
  | { type: 'route_to_forum'; reason: string }                          // off-page: route to Forum Finder
  | { type: 'technical'; instruction: string; snippet?: string };        // site-wide fix
```

**Remediation routing rules:**

| Check dimension | Fix delivery |
|---|---|
| Retrievability (crawl, sitemap, schema, links) | Technical instruction + snippet for self-serve; GitHub PR if repo connected |
| Off-page (mention count, community presence) | Route to Forum Finder output — "X threads queued this week where a genuine reply helps this" |
| GEO content (statistics, citations, etc.) | Diff — rewritten section, apply or edit before publish |
| GEO structure (FAQ, standalone chunks) | Diff — proposed addition/rewrite |
| GEO freshness | Content-regeneration nudge — "this page is N months old, queue a refresh?" |

**Skip behaviour:** Three skips of the same `check_id` for an app stops surfacing that check in top findings. Still scored. Increment `skip_count` on the finding row, not a separate table.

---

## Confidence labels and honest framing

Every finding must state its confidence tier in plain language. Writers of finding text must follow these templates:

**Tier 1 — replicated across independent datasets:**
> *Confidence: high — this finding replicates across multiple independent large-scale studies.*

**Tier 2 — single credible study, uncontested:**
> *Confidence: moderate — supported by one credible study; not yet independently replicated at scale.*

**Tier 3 — contested:**
> *Confidence: low — one study found a 25–40% improvement; a later, more rigorous benchmark found these tactics often don't help and sometimes hurt. Cheap to do, so worth trying; don't expect large gains.*

Never omit the confidence label. Never write Tier 3 findings with Tier 1 confidence language. This is a design principle of the tool — honest scoring is the differentiation.

---

## Build order

1. **Check registry + scoring math** (no UI, no LLM) — rule-based checks only, SEO track, write to `seo_geo_scores`
2. **SEO finding generation + AuditFindingCard wiring** — top 2 by expected gain, technical + off-page remediation types
3. **SEO panel UI** — separate tab, score display, per-check breakdown, finding cards
4. **GEO LLM evaluator** — single structured call, content + structure checks, credit-gated
5. **GEO finding generation** — diff remediation type, apply/edit before publish
6. **GEO panel UI** — separate tab, per-engine citation breakdown, finding cards
7. **Citation tracking job** — monthly, auto-generated query set from DNA + competitor-research
8. **Calibration logging** — log `(check_results, cited_yes_no_per_engine)` for future weight recalibration

Steps 1–3 are shippable independently and cover the heaviest lever (retrievability). Do not wait for GEO LLM checks before shipping SEO.

---

## Integration points with existing jobs

| Existing job | Integration |
|---|---|
| `content-generation` | Append SEO rule checks + GEO LLM check as final step. Attach score to draft in approve queue. |
| `competitor-research` | Feed competitor page word counts into `seo.penalty.thin_content` and `geo.structure.thin_vs_competitors` checks. |
| `dna-extraction` | Feed target queries into citation-tracking query set. |
| `forum-finder` | Feed community thread output into `seo.offpage.community_presence` check and off-page finding remediation. |
| `strategy-generation` | Weight channel selection by GEO citation-tracking results where available — pages with citation hits on Perplexity should inform content topic selection. |

---

## What not to build

- **A blended SEO+GEO composite score** — hiding which track is failing removes actionability
- **A "your GEO score is climbing" trend chart** — vanity metric; cite evidence or route to actionable finding
- **Off-page automated mention generation** — manufactured mentions are increasingly detectable; route off-page findings to Forum Finder only
- **Keyword stuffing suggestions** — GEO study measured this at 10% worse than doing nothing; it is a penalty item
- **A 40-item checklist visible to users** — surface top 2 findings only; full list behind "show all"
