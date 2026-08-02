import "server-only";
import { tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  AGENT_ACTION_COST,
  AGENT_ACTION_LABEL,
  canAffordAction,
  getCooldownHoursRemaining,
  getRemainingCredits,
  isCreditsResetDue,
  type AgentActionCooldowns,
  type AgentActionType,
} from "@/lib/agentCredits";
import {
  DEVTO_FREQUENCIES,
  IGFB_FREQUENCIES,
  LINKEDIN_FREQUENCIES,
  TWITTER_FREQUENCIES,
  TWITTER_HOURS,
  WEEK_DAYS,
  parsePublishingSchedule,
  type PublishingScheduleSettings,
} from "@/lib/app-settings";
import { appRunTag } from "@/lib/jobHealthRegistry";
import { ForbiddenError, RateLimitError } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { parseForumOpportunity } from "@/lib/opportunity";
import { searchForumsLive, type ForumSearchPlatform } from "@/lib/chat/forum-search";
import { MARKETING_SKILLS } from "@/lib/chat/skills-registry";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { contentGeneration } from "@/trigger/content-generation";
import type { onboardingAudit } from "@/trigger/onboarding-audit";
import type { churnAudit } from "@/trigger/churn-audit";
import type { croAudit } from "@/trigger/cro-audit";
import type { pricingAudit } from "@/trigger/pricing-audit";
import type { seoGeoAudit } from "@/trigger/seo-geo-audit";
import type { diagnosisRefreshCheck } from "@/trigger/diagnosis-refresh-check";
import type { strategyGeneration } from "@/trigger/strategy-generation";
import type { forumOpportunityFinder } from "@/trigger/forum-opportunity-finder";
import type { icpInference } from "@/trigger/icp-inference";
import type { ChatActionSeverity, DiagnosisData, PlanTier } from "@/types";

export interface ChatToolContext {
  appId: string;
  workspaceId: string;
}

// Anthropic's tool schema (name/description/input_schema) plus one field of
// our own, `requiresConfirmation`, which the chat route branches on
// generically instead of hardcoding which tool names need a confirm card.
// `requiresConfirmation` is stripped before this is sent to the API — see
// CLAUDE_TOOL_DEFINITIONS below.
export interface ChatToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  requiresConfirmation: boolean;
}

// Fully static across every app and every user — defined once as a module
// constant and imported, never rebuilt per request. Rebuilding this array
// per-request (even with identical contents) risks non-deterministic key
// ordering, which would silently break the prompt cache — see
// shared/prompt-caching.md's silent-invalidator table.
export const CHAT_TOOLS: ChatToolDefinition[] = [
  {
    name: "get_seo_geo_status",
    description:
      "Get this app's latest SEO/GEO score and its top open findings. Call this when the user asks about SEO, search visibility, or AI-answer-engine (GEO) performance.",
    input_schema: {
      type: "object",
      properties: {
        track: {
          type: "string",
          enum: ["seo", "geo"],
          description: "Which track to check. Defaults to 'seo' — GEO scoring isn't populated yet.",
        },
      },
      additionalProperties: false,
    },
    requiresConfirmation: false,
  },
  {
    name: "get_content_performance",
    description:
      "Get recent published/scheduled content for this app with its analytics (impressions, clicks, likes). Call this when the user asks how their content or a specific platform is performing.",
    input_schema: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          enum: ["twitter", "linkedin", "instagram", "facebook", "devto", "youtube"],
          description: "Optional — limit to one platform.",
        },
        limit: {
          type: "integer",
          description: "Max items to return. Defaults to 10.",
        },
      },
      additionalProperties: false,
    },
    requiresConfirmation: false,
  },
  {
    name: "get_credit_balance",
    description:
      "Get this app's remaining weekly agent credits, its allowance, when it resets, and which specific action types (if any) are currently on cooldown. Call this before proposing a credit-costing action, or when the user asks how many credits/scans they have left.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresConfirmation: false,
  },
  {
    name: "explain_finding",
    description:
      "Get the full detail (issue, suggested fix or remediation) for one audit finding by id. Call this when the user asks about a specific finding shown elsewhere in the dashboard.",
    input_schema: {
      type: "object",
      properties: {
        finding_id: { type: "string", description: "The finding's UUID." },
        source: {
          type: "string",
          enum: ["onboarding", "churn", "cro", "pricing", "seo_geo"],
          description: "Which audit family this finding belongs to.",
        },
      },
      required: ["finding_id", "source"],
      additionalProperties: false,
    },
    requiresConfirmation: false,
  },
  {
    name: "get_diagnosis_summary",
    description:
      "Get this app's current growth bottleneck diagnosis — the single biggest thing holding growth back, why, the competitive context it's based on, and the recommended primary lever. Call this when the user asks what's limiting their growth, or wants the diagnosis explained.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresConfirmation: false,
  },
  {
    name: "get_current_strategy",
    description:
      "Get this app's active content strategy — personas, content pillars, tone, channels, and per-platform (Twitter/LinkedIn) strategy notes. Call this when the user asks about their strategy, personas, or content pillars.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresConfirmation: false,
  },
  {
    name: "get_forum_opportunities",
    description:
      "Get queued Reddit/Hacker News/Quora/LinkedIn/X threads found by the forum opportunity scan, where this app could genuinely help. Call this when the user asks about forum opportunities, Reddit threads, or where to engage in communities right now.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Max items to return. Defaults to 10.",
        },
      },
      additionalProperties: false,
    },
    requiresConfirmation: false,
  },
  {
    name: "get_audit_findings",
    description:
      "Get this app's open findings from one of the four audits. Call this when the user asks what's wrong with onboarding, conversion, churn risk, or pricing.",
    input_schema: {
      type: "object",
      properties: {
        audit_type: {
          type: "string",
          enum: ["onboarding", "cro", "churn", "pricing"],
          description: "Which audit family to check. 'cro' covers conversion/landing-page findings.",
        },
      },
      required: ["audit_type"],
      additionalProperties: false,
    },
    requiresConfirmation: false,
  },
  {
    name: "get_outreach_status",
    description:
      "Get this app's cold email outreach status — ICP inference status, whether the first prospect preview batch has run, and prospect counts by status. Call this when the user asks about outreach, prospects, or their ICP.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresConfirmation: false,
  },
  {
    name: "get_opportunity_findings",
    description:
      "Get pain-point opportunity findings for this app. NOT YET AVAILABLE — this feature hasn't been built. Only call this if the user explicitly asks about it; the result will tell you it isn't available yet so you can relay that honestly.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresConfirmation: false,
  },
  {
    name: "get_influencer_candidates",
    description:
      "Get discovered influencer candidates for this app. NOT YET AVAILABLE — this feature hasn't been built. Only call this if the user explicitly asks about influencer discovery; the result will tell you it isn't available yet so you can relay that honestly.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresConfirmation: false,
  },
  {
    name: "search_forums_live",
    description:
      "Search a specific forum/community platform live, right now, for real threads matching a query. Distinct from get_forum_opportunities (which reads what the scheduled forum-opportunity-finder job already found and cached) — use this when the founder wants a fresh, real-time search instead. Covers reddit, hacker_news, product_hunt, stack_overflow, and indie_hackers only. Quora, LinkedIn, and X are not supported — say so plainly if asked about those rather than guessing or pretending to have searched.",
    input_schema: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          enum: ["reddit", "hacker_news", "product_hunt", "stack_overflow", "indie_hackers"],
        },
        query: { type: "string", description: "What to search for, e.g. a competitor name or a pain point." },
      },
      required: ["platform", "query"],
      additionalProperties: false,
    },
    requiresConfirmation: false,
  },
  {
    name: "get_marketing_playbook",
    description:
      "Get the full reasoning framework for one marketing topic (e.g. cold-email, pricing, seo-audit, community-marketing) — the same domain expertise this tool's own background jobs are grounded in. Call this instead of relying on general knowledge whenever the user's question maps to one of these topics, even if they didn't name it — you don't need to tell the user you're consulting a specific playbook. `popups` and `paywalls` are included for advisory answers only — this product never implements or embeds either into a customer's live app, so only ever explain/recommend, never offer to build one.",
    input_schema: {
      type: "object",
      properties: {
        skill_topic: {
          type: "string",
          description:
            "The marketing topic slug, e.g. 'cold-email', 'pricing', 'seo-audit', 'community-marketing'. Must be one of the known topics — if unsure which one fits, ask the user a brief clarifying question first rather than guessing.",
        },
        question: {
          type: "string",
          description: "The user's actual question, for context on which part of the playbook is most relevant.",
        },
      },
      required: ["skill_topic", "question"],
      additionalProperties: false,
    },
    requiresConfirmation: false,
  },
  {
    name: "get_publishing_schedule",
    description:
      "Get this app's configured publishing cadence per platform (posting frequency, hours/days, and timezone). Call this before proposing a suggested date/time via add_content_to_plan, so the suggestion is grounded in the app's actual cadence instead of a guess.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresConfirmation: false,
  },
  {
    name: "trigger_content_generation",
    description:
      "Start a content generation run for this app right now, instead of waiting for the next scheduled batch. This drafts new posts — it does not publish anything by itself.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresConfirmation: true,
  },
  {
    name: "update_publishing_schedule",
    description:
      "Change this app's publishing schedule (frequency/hours/days per platform, or timezone). Only include the platforms the user actually wants changed — anything omitted keeps its current setting.",
    input_schema: {
      type: "object",
      properties: {
        twitter: {
          type: "object",
          properties: {
            frequency: { type: "string", enum: [...TWITTER_FREQUENCIES] },
            hours: { type: "array", items: { type: "string", enum: [...TWITTER_HOURS] } },
          },
          additionalProperties: false,
        },
        linkedin: {
          type: "object",
          properties: {
            frequency: { type: "string", enum: [...LINKEDIN_FREQUENCIES] },
            days: { type: "array", items: { type: "string", enum: [...WEEK_DAYS] } },
          },
          additionalProperties: false,
        },
        instagram_facebook: {
          type: "object",
          properties: {
            frequency: { type: "string", enum: [...IGFB_FREQUENCIES] },
            include_weekends: { type: "boolean" },
          },
          additionalProperties: false,
        },
        devto: {
          type: "object",
          properties: {
            frequency: { type: "string", enum: [...DEVTO_FREQUENCIES] },
          },
          additionalProperties: false,
        },
        timezone: { type: "string", description: "IANA timezone, e.g. America/New_York." },
      },
      additionalProperties: false,
    },
    requiresConfirmation: true,
  },
  {
    name: "run_immediate_audit",
    description:
      "Run one audit scan for this app right now instead of waiting for its next scheduled run. Costs agent credits and is subject to the same weekly allowance and cooldown as the dashboard's 'Run Now' buttons.",
    input_schema: {
      type: "object",
      properties: {
        audit_type: {
          type: "string",
          enum: ["onboarding", "churn", "cro", "pricing", "seo"],
        },
      },
      required: ["audit_type"],
      additionalProperties: false,
    },
    requiresConfirmation: true,
  },
  {
    name: "run_diagnosis_refresh",
    description:
      "Re-check the competitive landscape and propose an updated growth diagnosis, right now instead of waiting for the quarterly check. Only available once the initial diagnosis has been acknowledged, and only when no refresh proposal is already pending review. Costs agent credits and is subject to the same weekly allowance and cooldown as other manual actions.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresConfirmation: true,
  },
  {
    name: "update_strategy_focus",
    description:
      "Regenerate this app's active content strategy, optionally nudged by a specific focus the user wants prioritized (e.g. 'focus more on distribution' or 'lean into the trust angle'). Supersedes the current strategy immediately and requires re-approval of the new draft — only call this when the user has actually asked for the strategy to change, not just because they're discussing it.",
    input_schema: {
      type: "object",
      properties: {
        focus_feedback: {
          type: "string",
          description: "What the user wants the new strategy to focus on differently. Optional — omit for a plain regeneration.",
        },
      },
      additionalProperties: false,
    },
    requiresConfirmation: true,
  },
  {
    name: "run_forum_discovery",
    description:
      "Run a forum opportunity scan for this app right now instead of waiting for the next scheduled run. Costs agent credits and is subject to the same weekly allowance and cooldown as the dashboard's 'Run Now' button.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresConfirmation: true,
  },
  {
    name: "trigger_outreach_preview",
    description:
      "Re-run ICP inference and generate a fresh batch of prospect previews for cold email outreach, replacing the current preview batch.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresConfirmation: true,
  },
  {
    name: "run_opportunity_scan",
    description:
      "Run a pain-point opportunity scan. NOT YET AVAILABLE — this feature hasn't been built. Only call this if the user explicitly asks to run one; confirming it does nothing yet, so tell the user honestly instead of implying it worked.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresConfirmation: true,
  },
  {
    name: "generate_outreach_message",
    description:
      "Generate an outreach message for a discovered influencer candidate. NOT YET AVAILABLE — this feature hasn't been built. Only call this if the user explicitly asks for one; confirming it does nothing yet, so tell the user honestly instead of implying it worked.",
    input_schema: {
      type: "object",
      properties: {
        candidate_name: {
          type: "string",
          description: "The influencer's name, if known.",
        },
      },
      additionalProperties: false,
    },
    requiresConfirmation: true,
  },
  {
    name: "add_content_to_plan",
    description:
      "Propose saving a generated artifact (a social post, a forum reply, an outreach message) to this app's content queue, scheduled for a specific date/time. Call this ALONGSIDE your text answer, in the same turn, whenever you've just generated a concrete piece of content with a plausible save/schedule action — never for general advice or an explanation with nothing concrete to save. Always call get_publishing_schedule first and compute suggested_date/suggested_time from THIS app's actual cadence for the target platform — never a hardcoded default or a guess. For a platform with no configured cadence (a forum reply, an outreach message), suggest posting promptly rather than picking an arbitrary future date, since delaying reduces relevance. This renders as an inline confirm card the founder reviews before anything is saved — nothing is queued until they confirm.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The generated text — the post, reply, or message itself." },
        platform: {
          type: "string",
          description:
            "Which platform this targets, e.g. 'twitter', 'linkedin', 'instagram', 'facebook', 'devto', or a forum/outreach target like 'reddit'. Not restricted to the publishing-schedule platforms — this tool is platform-agnostic.",
        },
        suggested_date: {
          type: "string",
          description: "Suggested date in YYYY-MM-DD form, computed from get_publishing_schedule's result for this platform.",
        },
        suggested_time: {
          type: "string",
          description: "Suggested time in 24-hour HH:MM form, computed the same way.",
        },
      },
      required: ["content", "platform", "suggested_date", "suggested_time"],
      additionalProperties: false,
    },
    requiresConfirmation: true,
  },
];

// What actually gets sent as the API request's `tools` param — our
// `requiresConfirmation` field stripped, since it isn't part of Anthropic's
// tool schema. Tools render before `system` in the cached prefix, so this
// array's stability is exactly as load-bearing for the cache as the system
// prompt's.
export const CLAUDE_TOOL_DEFINITIONS = CHAT_TOOLS.map(({ name, description, input_schema }) => ({
  name,
  description,
  input_schema,
}));

const AUDIT_TYPE_TO_ACTION_TYPE: Record<string, AgentActionType> = {
  onboarding: "onboarding_audit",
  churn: "churn_prevention_audit",
  cro: "cro_audit",
  pricing: "pricing_audit",
  seo: "seo_audit",
};

// get_audit_findings' table dispatch — same source tables as explain_finding
// above, restricted to the four audit families (no seo_geo, which already
// has its own richer get_seo_geo_status).
const AUDIT_TYPE_FINDINGS_TABLE: Record<string, string> = {
  onboarding: "onboarding_findings",
  churn: "churn_findings",
  cro: "cro_findings",
  pricing: "pricing_findings",
};

// ---------------------------------------------------------------------------
// Read-only tools — executed immediately server-side, result fed straight
// back to Claude as a tool_result. Every handler is a thin wrapper around an
// existing query already used elsewhere in the dashboard (see the file each
// one is modeled on in its comment) — no new business logic.
// ---------------------------------------------------------------------------

export const READ_ONLY_HANDLERS: Record<
  string,
  (input: Record<string, unknown>, ctx: ChatToolContext) => Promise<unknown>
> = {
  // Mirrors app/dashboard/apps/[id]/seo/page.tsx.
  async get_seo_geo_status(input, ctx) {
    const track = input.track === "geo" ? "geo" : "seo";

    const [{ data: score }, { data: findings }] = await Promise.all([
      supabaseAdmin
        .from("seo_geo_scores")
        .select("score, dim_scores, run_at")
        .eq("app_id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId)
        .eq("track", track)
        .order("run_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("seo_geo_findings")
        .select("id, title, explanation, expected_gain")
        .eq("app_id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId)
        .eq("track", track)
        .eq("status", "open")
        .order("expected_gain", { ascending: false })
        .limit(5),
    ]);

    if (!score) {
      return { track, scanned: false, message: "No scan has run for this track yet." };
    }

    return {
      track,
      scanned: true,
      score: score.score,
      dim_scores: score.dim_scores,
      last_scanned_at: score.run_at,
      top_open_findings: findings ?? [],
    };
  },

  // Mirrors app/dashboard/apps/[id]/content/page.tsx's content+analytics join.
  async get_content_performance(input, ctx) {
    const limit = typeof input.limit === "number" && input.limit > 0 ? Math.min(input.limit, 25) : 10;

    let query = supabaseAdmin
      .from("content")
      .select("id, platform, status, published_at, scheduled_at, body")
      .eq("app_id", ctx.appId)
      .eq("workspace_id", ctx.workspaceId)
      .in("status", ["scheduled", "published"])
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (typeof input.platform === "string") {
      query = query.eq("platform", input.platform);
    }

    const { data: content } = await query;
    if (!content || content.length === 0) {
      return { items: [] };
    }

    const { data: analytics } = await supabaseAdmin
      .from("analytics")
      .select("content_id, impressions, clicks, likes, fetched_at")
      .eq("app_id", ctx.appId)
      .eq("workspace_id", ctx.workspaceId)
      .in(
        "content_id",
        content.map((c) => c.id)
      )
      .order("fetched_at", { ascending: false });

    // Keep only the most recent analytics row per content_id (query above is
    // already ordered newest-first).
    const latestByContentId = new Map<string, { impressions: number; clicks: number; likes: number }>();
    for (const row of analytics ?? []) {
      if (!latestByContentId.has(row.content_id)) {
        latestByContentId.set(row.content_id, {
          impressions: row.impressions,
          clicks: row.clicks,
          likes: row.likes,
        });
      }
    }

    return {
      items: content.map((c) => ({
        id: c.id,
        platform: c.platform,
        status: c.status,
        published_at: c.published_at,
        scheduled_at: c.scheduled_at,
        excerpt: c.body.slice(0, 140),
        ...(latestByContentId.get(c.id) ?? { impressions: 0, clicks: 0, likes: 0 }),
      })),
    };
  },

  // Mirrors app/api/apps/[id]/agent-action/route.ts's affordability inputs.
  async get_credit_balance(_input, ctx) {
    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("agent_credits_used_this_week, agent_credits_reset_at, agent_action_cooldowns")
      .eq("id", ctx.appId)
      .eq("workspace_id", ctx.workspaceId)
      .single();

    const { data: workspace } = await supabaseAdmin
      .from("workspaces")
      .select("plan_tier")
      .eq("id", ctx.workspaceId)
      .single();

    const planTier = (workspace?.plan_tier ?? "free") as PlanTier;
    const { remaining, allowance, resetsAt } = getRemainingCredits(
      {
        agent_credits_used_this_week: app?.agent_credits_used_this_week ?? 0,
        agent_credits_reset_at: app?.agent_credits_reset_at ?? null,
      },
      planTier
    );

    // Per-action-type now (2026-07-29) — each action cools down
    // independently, so there's no single number to report. Only actions
    // currently on cooldown are included; anything absent is available now.
    const cooldowns = (app?.agent_action_cooldowns ?? {}) as AgentActionCooldowns;
    const activeCooldowns = Object.fromEntries(
      (Object.keys(cooldowns) as AgentActionType[])
        .map((actionType) => [actionType, getCooldownHoursRemaining(cooldowns, actionType)] as const)
        .filter(([, hours]) => hours > 0)
    );

    return {
      remaining,
      allowance,
      resets_at: resetsAt.toISOString(),
      cooldown_hours_remaining_by_action: activeCooldowns,
    };
  },

  // Looks up one finding row from whichever audit-family table it lives in.
  async explain_finding(input, ctx) {
    const findingId = String(input.finding_id ?? "");
    const source = String(input.source ?? "");

    if (source === "seo_geo") {
      const { data } = await supabaseAdmin
        .from("seo_geo_findings")
        .select("title, explanation, remediation, status")
        .eq("id", findingId)
        .eq("app_id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId)
        .maybeSingle();
      return data ?? { found: false };
    }

    const table = `${source}_findings`;
    if (!["onboarding_findings", "churn_findings", "cro_findings", "pricing_findings"].includes(table)) {
      return { found: false, error: "Unknown finding source." };
    }

    const { data } = await supabaseAdmin
      .from(table)
      .select("finding_type, severity, issue_description, suggested_fix, status")
      .eq("id", findingId)
      .eq("app_id", ctx.appId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    return data ?? { found: false };
  },

  // Mirrors components/apps/diagnosis-screen.tsx's field usage.
  async get_diagnosis_summary(_input, ctx) {
    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("diagnosis, diagnosis_status, diagnosis_refresh_status, last_diagnosis_refresh_at")
      .eq("id", ctx.appId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (!app?.diagnosis) {
      return { available: false, message: "No growth diagnosis has been generated for this app yet." };
    }

    const diagnosis = app.diagnosis as DiagnosisData;
    return {
      available: true,
      bottleneck: diagnosis.bottleneck,
      reasoning: diagnosis.reasoning,
      competitive_context: diagnosis.competitive_context,
      primary_lever: diagnosis.primary_lever,
      confidence: diagnosis.confidence,
      status: app.diagnosis_status,
      refresh_status: app.diagnosis_refresh_status,
      last_refresh_at: app.last_diagnosis_refresh_at,
    };
  },

  // Mirrors app/dashboard/apps/[id]/strategy/page.tsx's active-strategy query.
  async get_current_strategy(_input, ctx) {
    const { data: strategy } = await supabaseAdmin
      .from("strategies")
      .select("personas, content_pillars, tone, channels, twitter_strategy, linkedin_strategy, version, created_at")
      .eq("app_id", ctx.appId)
      .eq("workspace_id", ctx.workspaceId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!strategy) {
      return { available: false, message: "No active strategy for this app yet." };
    }

    return { available: true, ...strategy };
  },

  // Mirrors components/apps/app-opportunities-view.tsx's finding query +
  // lib/opportunity.ts's parseForumOpportunity, so the model gets the same
  // structured shape the dashboard card renders instead of a raw jsonb blob.
  async get_forum_opportunities(input, ctx) {
    const limit = typeof input.limit === "number" && input.limit > 0 ? Math.min(input.limit, 25) : 10;

    const { data: findings } = await supabaseAdmin
      .from("research_findings")
      .select("id, findings, status, created_at")
      .eq("app_id", ctx.appId)
      .eq("workspace_id", ctx.workspaceId)
      .eq("stream", "forum_opportunities")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!findings || findings.length === 0) {
      return { items: [], message: "No queued forum opportunities right now." };
    }

    return {
      items: findings.map((f) => {
        const parsed = parseForumOpportunity(f.findings);
        return {
          id: f.id,
          platform: parsed.platform,
          title: parsed.title,
          source_name: parsed.sourceName,
          relevance: parsed.relevance,
          posted_at: parsed.postedAt,
          url: parsed.url,
          has_drafted_reply: Boolean(parsed.draftedReply),
          created_at: f.created_at,
        };
      }),
    };
  },

  // Mirrors the four audit pages (app/dashboard/apps/[id]/{onboarding,
  // conversion,retention,pricing}/page.tsx) — same table-per-audit-type
  // dispatch as explain_finding above, but listing open findings instead of
  // looking up one by id.
  async get_audit_findings(input, ctx) {
    const auditType = String(input.audit_type ?? "");
    const table = AUDIT_TYPE_FINDINGS_TABLE[auditType];
    if (!table) {
      return { available: false, message: "Unknown audit type." };
    }

    const { data: findings } = await supabaseAdmin
      .from(table)
      .select("id, finding_type, severity, issue_description, suggested_fix, status")
      .eq("app_id", ctx.appId)
      .eq("workspace_id", ctx.workspaceId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(10);

    return { audit_type: auditType, open_findings: findings ?? [] };
  },

  // Mirrors app/dashboard/apps/[id]/outreach/page.tsx's status fields +
  // prospect query, collapsed to counts by status instead of full rows.
  async get_outreach_status(_input, ctx) {
    const [{ data: app }, { data: prospects }] = await Promise.all([
      supabaseAdmin
        .from("apps")
        .select("icp_status, first_outreach_completed")
        .eq("id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId)
        .maybeSingle(),
      supabaseAdmin
        .from("cold_email_prospects")
        .select("status")
        .eq("app_id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId),
    ]);

    const countsByStatus: Record<string, number> = {};
    for (const p of prospects ?? []) {
      countsByStatus[p.status] = (countsByStatus[p.status] ?? 0) + 1;
    }

    return {
      icp_status: app?.icp_status ?? null,
      first_outreach_completed: app?.first_outreach_completed ?? false,
      total_prospects: prospects?.length ?? 0,
      prospect_counts_by_status: countsByStatus,
    };
  },

  // STUB — no dedicated "Opportunities" pain-point feature/table exists yet.
  // Distinct from get_forum_opportunities (research_findings.stream =
  // 'forum_opportunities', real and wired above) and from the Research
  // tab's "Problems" data (research_findings.stream = 'problem_discovery',
  // also real but surfaced under Research, not under an "Opportunities"
  // label — see components/apps/app-research-view.tsx). Wire this to
  // whichever of those, or a new table, actually becomes "Opportunities"
  // once that's decided — returns an honest "not available" for now rather
  // than guessing which existing stream it should read.
  async get_opportunity_findings() {
    return { available: false, message: "Pain-point opportunity findings aren't available yet." };
  },

  // STUB — no influencer_candidates table or niche-influencer-discovery job
  // exists yet. Only hardcoded dummy data exists today, see
  // lib/dummy-data/platform-detail.ts and the TODOs in
  // components/apps/platform-top-influencers-tab.tsx.
  async get_influencer_candidates() {
    return { available: false, message: "Influencer candidate discovery isn't available yet." };
  },

  // Live external search — see lib/chat/forum-search.ts for the per-platform
  // dispatch, why Reddit reuses Firecrawl's site-filtered search instead of
  // a real Reddit API client (none exists in this project), and why Quora/
  // LinkedIn/X aren't covered. ctx (appId/workspaceId) is unused — this
  // reads public external data, not anything scoped to this app/workspace.
  async search_forums_live(input) {
    const platform = String(input.platform ?? "") as ForumSearchPlatform;
    const query = String(input.query ?? "").trim();
    if (!query) {
      return { platform, available: false, error: "No search query provided.", hits: [] };
    }
    return searchForumsLive(platform, query);
  },

  // Reads a skill's full SKILL.md verbatim, no summarization/preprocessing —
  // same design-time-only content the Audits-family jobs and the other
  // skill-wired prompts (see PHASES.md's 2026-08-01 entries) were manually
  // adapted from, now available to the live coordinator on demand instead of
  // only through whichever job happened to get it baked in at author time.
  async get_marketing_playbook(input) {
    const skillTopic = String(input.skill_topic ?? "");
    const relativePath = MARKETING_SKILLS[skillTopic];
    if (!relativePath) {
      return {
        found: false,
        error: `Unknown skill_topic "${skillTopic}". Known topics: ${Object.keys(MARKETING_SKILLS).join(", ")}.`,
      };
    }

    try {
      const content = await readFile(path.join(process.cwd(), relativePath), "utf-8");
      return { found: true, skill_topic: skillTopic, content };
    } catch {
      return { found: false, error: `Could not read the playbook for "${skillTopic}".` };
    }
  },

  // Mirrors app/api/apps/[id]/settings/route.ts's publishing_schedule read —
  // grounds add_content_to_plan's suggested_date/suggested_time in this
  // app's real cadence instead of the model guessing one.
  async get_publishing_schedule(_input, ctx) {
    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("app_settings")
      .eq("id", ctx.appId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    const currentSettings = (app?.app_settings ?? {}) as Record<string, unknown>;
    return parsePublishingSchedule(currentSettings.publishing_schedule);
  },
};

// ---------------------------------------------------------------------------
// Mutating tools — never executed on the first pass. `computeCreditCost`
// runs when the proposal is created (to decide whether to even show a
// confirm card, and what to store on pending_chat_actions.credit_cost);
// `execute` only ever runs from app/api/chat/confirm/route.ts, after the
// user confirms, and is where the real Trigger.dev job actually gets
// dispatched.
// ---------------------------------------------------------------------------

export interface MutatingToolHandlers {
  computeCreditCost: (input: Record<string, unknown>, ctx: ChatToolContext) => Promise<number>;
  execute: (input: Record<string, unknown>, ctx: ChatToolContext) => Promise<{ trackingId: string | null }>;
}

export const MUTATING_TOOL_HANDLERS: Record<string, MutatingToolHandlers> = {
  // Reuses the exact trigger call app/api/apps/[id]/approve/route.ts makes
  // for content-generation, including the pending_run_id bookkeeping the
  // System Health panel reads.
  trigger_content_generation: {
    async computeCreditCost() {
      return 0;
    },
    async execute(_input, ctx) {
      const handle = await tasks.trigger<typeof contentGeneration>(
        "content-generation",
        { app_id: ctx.appId, workspace_id: ctx.workspaceId },
        { tags: [appRunTag(ctx.appId)] }
      );
      await supabaseAdmin
        .from("apps")
        .update({ pending_run_id: handle.id, pending_run_task: "content-generation" })
        .eq("id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId);
      return { trackingId: handle.id };
    },
  },

  update_publishing_schedule: {
    async computeCreditCost() {
      return 0;
    },
    // Same read-parse-merge-write shape as app/api/apps/[id]/settings/route.ts's
    // PATCH handler — only the platforms present in `input` are overridden,
    // everything else keeps its current (or default) value.
    async execute(input, ctx) {
      const { data: app } = await supabaseAdmin
        .from("apps")
        .select("app_settings")
        .eq("id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId)
        .single();

      const currentSettings = (app?.app_settings ?? {}) as Record<string, unknown>;
      const current = parsePublishingSchedule(currentSettings.publishing_schedule);

      const partial = input as Partial<PublishingScheduleSettings>;
      const merged: PublishingScheduleSettings = {
        twitter: { ...current.twitter, ...partial.twitter },
        linkedin: { ...current.linkedin, ...partial.linkedin },
        instagram_facebook: { ...current.instagram_facebook, ...partial.instagram_facebook },
        devto: { ...current.devto, ...partial.devto },
        timezone: partial.timezone ?? current.timezone,
      };

      await supabaseAdmin
        .from("apps")
        .update({ app_settings: { ...currentSettings, publishing_schedule: merged } })
        .eq("id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId);

      return { trackingId: null };
    },
  },

  run_immediate_audit: {
    async computeCreditCost(input) {
      const actionType = AUDIT_TYPE_TO_ACTION_TYPE[String(input.audit_type)];
      return actionType ? AGENT_ACTION_COST[actionType] : 0;
    },
    // Same affordability -> cooldown -> debit -> trigger sequence as
    // app/api/apps/[id]/agent-action/route.ts, re-run here against the
    // CURRENT balance at confirm time (not whatever was true when the
    // proposal was made — see Part 5's re-check requirement).
    async execute(input, ctx) {
      const actionType = AUDIT_TYPE_TO_ACTION_TYPE[String(input.audit_type)];
      if (!actionType) {
        throw new ForbiddenError("Unknown audit type.", "UNKNOWN_AUDIT_TYPE");
      }

      const { data: app } = await supabaseAdmin
        .from("apps")
        .select("agent_credits_used_this_week, agent_credits_reset_at, agent_action_cooldowns")
        .eq("id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId)
        .single();

      if (!app) {
        throw new ForbiddenError(ErrorMessages.apps.NOT_FOUND_IN_WORKSPACE, "FORBIDDEN");
      }

      const { data: workspace } = await supabaseAdmin
        .from("workspaces")
        .select("plan_tier")
        .eq("id", ctx.workspaceId)
        .single();
      const planTier = (workspace?.plan_tier ?? "free") as PlanTier;

      const affordCheck = canAffordAction(app, actionType, planTier);
      if (!affordCheck.allowed) {
        throw new ForbiddenError(affordCheck.reason ?? ErrorMessages.research.NO_CREDITS_REMAINING);
      }

      const cooldowns = (app.agent_action_cooldowns ?? {}) as AgentActionCooldowns;
      const cooldownHoursRemaining = getCooldownHoursRemaining(cooldowns, actionType);
      if (cooldownHoursRemaining > 0) {
        throw new RateLimitError(ErrorMessages.research.COOLDOWN_ACTIVE, "RATE_LIMITED", {
          retryAfter: cooldownHoursRemaining,
        });
      }

      const cost = AGENT_ACTION_COST[actionType];
      const resetDue = isCreditsResetDue(app.agent_credits_reset_at);
      const currentUsed = resetDue ? 0 : app.agent_credits_used_this_week;
      const nowIso = new Date().toISOString();

      await supabaseAdmin
        .from("apps")
        .update({
          agent_credits_used_this_week: currentUsed + cost,
          agent_credits_reset_at: resetDue ? nowIso : app.agent_credits_reset_at,
          agent_action_cooldowns: { ...cooldowns, [actionType]: nowIso },
        })
        .eq("id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId);

      const jobPayload = { app_id: ctx.appId, workspace_id: ctx.workspaceId };
      const tagOptions = { tags: [appRunTag(ctx.appId)] };
      let handle: { id: string } | undefined;

      if (actionType === "onboarding_audit") {
        handle = await tasks.trigger<typeof onboardingAudit>("onboarding-audit", jobPayload, tagOptions);
      } else if (actionType === "churn_prevention_audit") {
        handle = await tasks.trigger<typeof churnAudit>("churn-audit", jobPayload, tagOptions);
      } else if (actionType === "cro_audit") {
        handle = await tasks.trigger<typeof croAudit>("cro-audit", jobPayload, tagOptions);
      } else if (actionType === "pricing_audit") {
        handle = await tasks.trigger<typeof pricingAudit>("pricing-audit", jobPayload, tagOptions);
      } else if (actionType === "seo_audit") {
        handle = await tasks.trigger<typeof seoGeoAudit>("seo-geo-audit", jobPayload, tagOptions);
      }

      return { trackingId: handle?.id ?? null };
    },
  },

  // Same affordability -> cooldown -> debit -> trigger sequence as
  // run_immediate_audit above, plus the two extra state preconditions
  // app/api/apps/[id]/agent-action/route.ts's diagnosis_refresh branch
  // checks before ever touching credits.
  run_diagnosis_refresh: {
    async computeCreditCost() {
      return AGENT_ACTION_COST.diagnosis_refresh;
    },
    async execute(_input, ctx) {
      const { data: app } = await supabaseAdmin
        .from("apps")
        .select(
          "agent_credits_used_this_week, agent_credits_reset_at, agent_action_cooldowns, diagnosis_status, diagnosis_refresh_status"
        )
        .eq("id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId)
        .single();

      if (!app) {
        throw new ForbiddenError(ErrorMessages.apps.NOT_FOUND_IN_WORKSPACE, "FORBIDDEN");
      }
      if (app.diagnosis_status !== "acknowledged") {
        throw new ForbiddenError(ErrorMessages.diagnosisRefresh.NOT_ELIGIBLE, "NOT_ELIGIBLE");
      }
      if (app.diagnosis_refresh_status === "proposal_ready") {
        throw new ForbiddenError(ErrorMessages.diagnosisRefresh.PROPOSAL_ALREADY_PENDING, "PROPOSAL_ALREADY_PENDING");
      }

      const { data: workspace } = await supabaseAdmin
        .from("workspaces")
        .select("plan_tier")
        .eq("id", ctx.workspaceId)
        .single();
      const planTier = (workspace?.plan_tier ?? "free") as PlanTier;

      const affordCheck = canAffordAction(app, "diagnosis_refresh", planTier);
      if (!affordCheck.allowed) {
        throw new ForbiddenError(affordCheck.reason ?? ErrorMessages.research.NO_CREDITS_REMAINING);
      }

      const cooldowns = (app.agent_action_cooldowns ?? {}) as AgentActionCooldowns;
      const cooldownHoursRemaining = getCooldownHoursRemaining(cooldowns, "diagnosis_refresh");
      if (cooldownHoursRemaining > 0) {
        throw new RateLimitError(ErrorMessages.research.COOLDOWN_ACTIVE, "RATE_LIMITED", {
          retryAfter: cooldownHoursRemaining,
        });
      }

      const cost = AGENT_ACTION_COST.diagnosis_refresh;
      const resetDue = isCreditsResetDue(app.agent_credits_reset_at);
      const currentUsed = resetDue ? 0 : app.agent_credits_used_this_week;
      const nowIso = new Date().toISOString();

      await supabaseAdmin
        .from("apps")
        .update({
          agent_credits_used_this_week: currentUsed + cost,
          agent_credits_reset_at: resetDue ? nowIso : app.agent_credits_reset_at,
          agent_action_cooldowns: { ...cooldowns, diagnosis_refresh: nowIso },
        })
        .eq("id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId);

      const handle = await tasks.trigger<typeof diagnosisRefreshCheck>(
        "diagnosis-refresh-check",
        { app_id: ctx.appId, workspace_id: ctx.workspaceId },
        { tags: [appRunTag(ctx.appId)] }
      );

      return { trackingId: handle.id };
    },
  },

  // Same supersede-active -> flip app status -> trigger sequence as
  // app/api/apps/[id]/strategy/regenerate/route.ts, plus threading the
  // user's chat-typed focus text into strategy-generation's existing
  // `diagnosis_correction` field (the same "founder-typed notes the model
  // should prioritise" field that route already accepts from the
  // diagnosis-acknowledge screen — reused here from a new call site rather
  // than adding a second field for the same purpose). Not credit-gated,
  // same as that route (no credit check there either).
  update_strategy_focus: {
    async computeCreditCost() {
      return 0;
    },
    async execute(input, ctx) {
      const { data: app } = await supabaseAdmin
        .from("apps")
        .select("status")
        .eq("id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId)
        .single();

      if (!app || app.status !== "active") {
        throw new ForbiddenError(ErrorMessages.apps.NOT_ACTIVE, "INVALID_STATE");
      }

      const { data: activeStrategy } = await supabaseAdmin
        .from("strategies")
        .select("id")
        .eq("app_id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!activeStrategy) {
        throw new ForbiddenError(ErrorMessages.strategy.NO_ACTIVE_STRATEGY_TO_REGENERATE, "NO_STRATEGY");
      }

      await supabaseAdmin
        .from("strategies")
        .update({ status: "superseded" })
        .eq("id", activeStrategy.id)
        .eq("workspace_id", ctx.workspaceId);

      await supabaseAdmin
        .from("apps")
        .update({ status: "strategy_pending" })
        .eq("id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId);

      const handle = await tasks.trigger<typeof strategyGeneration>("strategy-generation", {
        app_id: ctx.appId,
        workspace_id: ctx.workspaceId,
        diagnosis_correction: typeof input.focus_feedback === "string" ? input.focus_feedback : null,
      });

      await supabaseAdmin
        .from("apps")
        .update({ pending_run_id: handle.id, pending_run_task: "strategy-generation" })
        .eq("id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId);

      return { trackingId: handle.id };
    },
  },

  // Same affordability -> cooldown -> debit -> trigger sequence as
  // run_immediate_audit, for the single forum_opportunity_scan action type
  // (app/api/apps/[id]/agent-action/route.ts's forum_opportunity_scan branch).
  run_forum_discovery: {
    async computeCreditCost() {
      return AGENT_ACTION_COST.forum_opportunity_scan;
    },
    async execute(_input, ctx) {
      const { data: app } = await supabaseAdmin
        .from("apps")
        .select("agent_credits_used_this_week, agent_credits_reset_at, agent_action_cooldowns")
        .eq("id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId)
        .single();

      if (!app) {
        throw new ForbiddenError(ErrorMessages.apps.NOT_FOUND_IN_WORKSPACE, "FORBIDDEN");
      }

      const { data: workspace } = await supabaseAdmin
        .from("workspaces")
        .select("plan_tier")
        .eq("id", ctx.workspaceId)
        .single();
      const planTier = (workspace?.plan_tier ?? "free") as PlanTier;

      const affordCheck = canAffordAction(app, "forum_opportunity_scan", planTier);
      if (!affordCheck.allowed) {
        throw new ForbiddenError(affordCheck.reason ?? ErrorMessages.research.NO_CREDITS_REMAINING);
      }

      const cooldowns = (app.agent_action_cooldowns ?? {}) as AgentActionCooldowns;
      const cooldownHoursRemaining = getCooldownHoursRemaining(cooldowns, "forum_opportunity_scan");
      if (cooldownHoursRemaining > 0) {
        throw new RateLimitError(ErrorMessages.research.COOLDOWN_ACTIVE, "RATE_LIMITED", {
          retryAfter: cooldownHoursRemaining,
        });
      }

      const cost = AGENT_ACTION_COST.forum_opportunity_scan;
      const resetDue = isCreditsResetDue(app.agent_credits_reset_at);
      const currentUsed = resetDue ? 0 : app.agent_credits_used_this_week;
      const nowIso = new Date().toISOString();

      await supabaseAdmin
        .from("apps")
        .update({
          agent_credits_used_this_week: currentUsed + cost,
          agent_credits_reset_at: resetDue ? nowIso : app.agent_credits_reset_at,
          agent_action_cooldowns: { ...cooldowns, forum_opportunity_scan: nowIso },
        })
        .eq("id", ctx.appId)
        .eq("workspace_id", ctx.workspaceId);

      const handle = await tasks.trigger<typeof forumOpportunityFinder>(
        "forum-opportunity-finder",
        { app_id: ctx.appId, workspace_id: ctx.workspaceId },
        { tags: [appRunTag(ctx.appId)] }
      );

      return { trackingId: handle.id };
    },
  },

  // Re-runs icp-inference exactly as app/api/apps/[id]/approve/route.ts does
  // unconditionally on every approval — icp-inference chains into
  // outreach-preview itself (see that job) and replaces the prior preview
  // batch, so there's no separate "outreach-preview" trigger point to call
  // directly. Not credit-gated — icp-inference/outreach-preview aren't part
  // of the AgentActionType pool (see lib/agentCredits.ts), same as that
  // route's unconditional call.
  trigger_outreach_preview: {
    async computeCreditCost() {
      return 0;
    },
    async execute(_input, ctx) {
      const handle = await tasks.trigger<typeof icpInference>("icp-inference", {
        app_id: ctx.appId,
        workspace_id: ctx.workspaceId,
      });
      return { trackingId: handle.id };
    },
  },

  // STUB — no real job exists for this yet, see get_opportunity_findings'
  // TODO above for why. Registered with the same requiresConfirmation:true
  // shape as every other mutating tool (so the confirm-gate flow doesn't
  // need a special case) but execute() is a genuine no-op — describeToolProposal
  // below makes the confirm card itself say this isn't built yet, so
  // confirming never implies a scan actually ran.
  run_opportunity_scan: {
    async computeCreditCost() {
      return 0;
    },
    async execute() {
      return { trackingId: null };
    },
  },

  // STUB — no real job exists for this yet, see get_influencer_candidates'
  // TODO above. Same no-op shape as run_opportunity_scan.
  generate_outreach_message: {
    async computeCreditCost() {
      return 0;
    },
    async execute() {
      return { trackingId: null };
    },
  },

  // Writes to the exact same `content` table trigger/content-generation.ts
  // already queues scheduled drafts to — no second content-queue table or
  // path. content_type is always "post": that column only distinguishes
  // long-form articles (see content-generation.ts's devto branch) from
  // everything else, and every artifact this tool saves (social posts,
  // forum replies, outreach messages) is short-form. platform/strategy_id
  // are intentionally not restricted to the publishing-schedule platform
  // set or tied to a strategy — this tool is platform-agnostic and the
  // content it saves is chat-generated, not strategy-derived.
  add_content_to_plan: {
    async computeCreditCost() {
      return 0;
    },
    async execute(input, ctx) {
      const content = String(input.content ?? "").trim();
      const platform = String(input.platform ?? "").trim();
      const suggestedDate = String(input.suggested_date ?? "").trim();
      const suggestedTime = String(input.suggested_time ?? "").trim();

      if (!content || !platform) {
        throw new ForbiddenError(ErrorMessages.generic.UNKNOWN, "INVALID_CONTENT_INPUT");
      }

      const scheduledAt =
        suggestedDate && suggestedTime ? new Date(`${suggestedDate}T${suggestedTime}:00Z`) : null;
      const scheduledAtIso =
        scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt.toISOString() : null;

      const { data: inserted, error } = await supabaseAdmin
        .from("content")
        .insert({
          app_id: ctx.appId,
          workspace_id: ctx.workspaceId,
          platform,
          content_type: "post",
          body: content,
          status: "scheduled",
          scheduled_at: scheduledAtIso,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        throw new ForbiddenError(ErrorMessages.generic.UNKNOWN, "CONTENT_SAVE_FAILED");
      }

      return { trackingId: inserted.id };
    },
  },
};

// ---------------------------------------------------------------------------
// Human-readable confirm-card copy for a proposed mutating tool call — feeds
// ChatConfirmAction (types/index.ts) via app/api/chat/route.ts. Kept next to
// the tool registry itself so the two never drift apart.
// ---------------------------------------------------------------------------

export function describeToolProposal(
  toolName: string,
  input: Record<string, unknown>
): { label: string; severity: ChatActionSeverity; description: string; effect: string } {
  switch (toolName) {
    case "trigger_content_generation":
      return {
        label: "Generate content now",
        severity: "low",
        description: "Start a content generation run for this app right now.",
        effect: "New draft posts will be created from the active strategy, outside the normal schedule.",
      };
    case "update_publishing_schedule":
      return {
        label: "Update publishing schedule",
        severity: "medium",
        description: "Change how often (and when) this app's content publishes.",
        effect: "Future scheduling will use the new frequency/hours/days immediately.",
      };
    case "run_immediate_audit": {
      const actionType = AUDIT_TYPE_TO_ACTION_TYPE[String(input.audit_type)];
      const label = actionType ? AGENT_ACTION_LABEL[actionType] : "Audit";
      const cost = actionType ? AGENT_ACTION_COST[actionType] : 0;
      return {
        label: `Run ${label} now`,
        severity: "medium",
        description: `Run the ${label} scan right now instead of waiting for its next scheduled run.`,
        effect: `Uses ${cost} agent credit${cost === 1 ? "" : "s"} and starts the 6-hour manual-action cooldown.`,
      };
    }
    case "run_diagnosis_refresh": {
      const cost = AGENT_ACTION_COST.diagnosis_refresh;
      return {
        label: "Refresh growth diagnosis",
        severity: "medium",
        description: "Re-check the competitive landscape and propose an updated growth diagnosis.",
        effect: `Uses ${cost} agent credit${cost === 1 ? "" : "s"} and starts the 6-hour manual-action cooldown. The result is a proposal to review, not an automatic change.`,
      };
    }
    case "update_strategy_focus":
      return {
        label: "Regenerate strategy",
        severity: "medium",
        description: "Supersede the current active strategy and generate a new one" + (
          typeof input.focus_feedback === "string" && input.focus_feedback.trim()
            ? `, focused on: "${input.focus_feedback.trim()}".`
            : "."
        ),
        effect: "The current strategy is marked superseded immediately; the app returns to 'awaiting approval' until the new draft is reviewed.",
      };
    case "run_forum_discovery": {
      const cost = AGENT_ACTION_COST.forum_opportunity_scan;
      return {
        label: "Run forum opportunity scan",
        severity: "low",
        description: "Scan Reddit, Hacker News, and similar forums for new threads worth engaging with, right now.",
        effect: `Uses ${cost} agent credit${cost === 1 ? "" : "s"} and starts the 6-hour manual-action cooldown.`,
      };
    }
    case "trigger_outreach_preview":
      return {
        label: "Refresh outreach preview",
        severity: "low",
        description: "Re-run ICP inference and generate a fresh batch of prospect previews for outreach.",
        effect: "Replaces the current preview batch of prospects with a new one.",
      };
    case "run_opportunity_scan":
      return {
        label: "Run opportunity scan",
        severity: "low",
        description: "This feature isn't built yet.",
        effect: "Nothing will actually run — confirming just acknowledges that.",
      };
    case "generate_outreach_message":
      return {
        label: "Generate influencer outreach message",
        severity: "low",
        description: "This feature isn't built yet.",
        effect: "Nothing will actually run — confirming just acknowledges that.",
      };
    case "add_content_to_plan": {
      const platform = typeof input.platform === "string" && input.platform.trim() ? input.platform.trim() : "this platform";
      const date = typeof input.suggested_date === "string" ? input.suggested_date.trim() : "";
      const time = typeof input.suggested_time === "string" ? input.suggested_time.trim() : "";
      const when = date && time ? `${date} at ${time}` : date || "no suggested date/time was given";
      return {
        label: `Save ${platform} content to plan`,
        severity: "low",
        description: `Save this generated ${platform} content to your content queue, scheduled for ${when}.`,
        effect: `Adds one new "scheduled" item to your content queue for ${platform}. Nothing publishes automatically — it follows the same review path as every other queued item.`,
      };
    }
    default:
      return {
        label: toolName,
        severity: "medium",
        description: "The agent wants to run an action.",
        effect: "This will make a change in your workspace.",
      };
  }
}

export function isMutatingTool(toolName: string): boolean {
  return CHAT_TOOLS.some((t) => t.name === toolName && t.requiresConfirmation);
}

export function isKnownTool(toolName: string): boolean {
  return CHAT_TOOLS.some((t) => t.name === toolName);
}

// Explicit allowlist of "proactive offer" tools — mutating tools the
// coordinator calls unprompted, alongside its text answer, rather than only
// because the founder asked for that exact action. app/api/chat/route.ts
// logs a chat_action_suggestions row (status 'offered') only for tools in
// this set, and app/api/chat/confirm/route.ts flips it to 'confirmed'/
// 'dismissed'. Kept as an explicit opt-in rather than "every mutating tool
// logs here" so a future ordinary mutating tool doesn't silently start
// polluting this table.
const PROACTIVE_OFFER_TOOLS = new Set<string>(["add_content_to_plan"]);

export function isProactiveOfferTool(toolName: string): boolean {
  return PROACTIVE_OFFER_TOOLS.has(toolName);
}
