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
import type { contentGeneration } from "@/trigger/content-generation";
import type { onboardingAudit } from "@/trigger/onboarding-audit";
import type { churnAudit } from "@/trigger/churn-audit";
import type { croAudit } from "@/trigger/cro-audit";
import type { pricingAudit } from "@/trigger/pricing-audit";
import type { seoGeoAudit } from "@/trigger/seo-geo-audit";
import type { ChatActionSeverity, PlanTier } from "@/types";

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
      "Get this app's remaining weekly agent credits, its allowance, when it resets, and whether the manual-action cooldown is active. Call this before proposing a credit-costing action, or when the user asks how many credits/scans they have left.",
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
];

// What actually gets sent as the API request's `tools` param — our
// `requiresConfirmation` field stripped, since it isn't part of Anthropic's
// tool schema. Tools render before `system` in the cached prefix (see
// SKILL.md's prompt-caching quick reference), so this array's stability is
// exactly as load-bearing for the cache as the system prompt's.
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
      .select("agent_credits_used_this_week, agent_credits_reset_at, last_agent_action_at")
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

    return {
      remaining,
      allowance,
      resets_at: resetsAt.toISOString(),
      cooldown_hours_remaining: getCooldownHoursRemaining(app?.last_agent_action_at ?? null),
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
        .select("agent_credits_used_this_week, agent_credits_reset_at, last_agent_action_at")
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

      const cooldownHoursRemaining = getCooldownHoursRemaining(app.last_agent_action_at);
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
          last_agent_action_at: nowIso,
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
