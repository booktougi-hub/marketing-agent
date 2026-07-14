import { logger, schemaTask, tasks } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { callExternalService, ExternalServiceError } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import type { outreachPreview } from "@/trigger/outreach-preview";
import type { AppDna, StrategyPersona } from "@/types";

// Spec called for "claude-sonnet-4-20250514" — CLAUDE.md is explicit and
// non-negotiable: always claude-sonnet-5, never a different model string.
// Every other job in this codebase already follows that; this one does too.
const CLAUDE_MODEL = "claude-sonnet-5";

const adjustmentSchema = z.object({
  company_stage: z.enum(["bootstrapped", "funded", "established"]).nullable(),
  exclusions: z.string().nullable(),
  geographic_focus: z.string().nullable(),
  persona_feedback: z.string().nullable(),
});

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
  // Present when this run comes from "Adjust this" — a founder-submitted
  // correction folded in as extra context for a re-run, not persisted as
  // its own column (see components/apps/outreach-icp-card.tsx).
  adjustment: adjustmentSchema.nullable().optional(),
});

const apolloFiltersSchema = z.object({
  person_titles: z.array(z.string()),
  person_seniorities: z.array(z.string()),
  organization_num_employees_ranges: z.array(z.string()),
  organization_industries: z.array(z.string()),
  technologies: z.array(z.string()),
});

const icpResponseSchema = z.object({
  summary: z.string(),
  apollo_filters: apolloFiltersSchema,
});

const SYSTEM_PROMPT = `You infer a software product's Ideal Customer Profile (ICP) from its DNA and marketing personas, for cold outreach targeting.

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "summary": string,
  "apollo_filters": {
    "person_titles": string[],
    "person_seniorities": string[],
    "organization_num_employees_ranges": string[],
    "organization_industries": string[],
    "technologies": string[]
  }
}

"summary" is a plain-language description a founder will read directly, 3-4 sentences, written like: "Your ideal customer is likely a solo developer or small SaaS founder, running a bootstrapped or early-stage company, who has shipped a product but has no dedicated marketing resource." Ground it in specifics from the DNA and personas — don't write something generic enough to apply to any product.

"apollo_filters" are structured filters for Apollo's people-search API:
- person_titles: specific job titles to target (e.g. "Founder", "Head of Growth"), not broad categories
- person_seniorities: from this exact set only: "owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior", "entry", "intern"
- organization_num_employees_ranges: ranges in the form "1,10" / "11,50" / "51,200" / "201,500" / "501,1000" / "1001,5000" / "5001,10000" / "10001,"
- organization_industries: real industry names Apollo would recognize (e.g. "computer software", "marketing and advertising"), not invented categories
- technologies: ONLY include this if a specific tech stack is actually inferable from the DNA/category (e.g. the product is itself a Shopify app, so its customers run Shopify) — return an empty array rather than guessing when nothing is inferable

Base every field on what's actually in the DNA and personas given — do not invent a persona or industry that isn't supported by the input.`;

export const icpInference = schemaTask({
  id: "icp-inference",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id, adjustment } = payload;
    logger.info("icp-inference: run started", { app_id, workspace_id, has_adjustment: !!adjustment });

    try {
      const anthropic = createAnthropicClient();

      const { data: app, error: appError } = await supabaseAdmin
        .from("apps")
        .select("dna, additional_context")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appError) {
        throw new Error(`Failed to load app record: ${appError.message}`);
      }

      if (!app.dna) {
        logger.warn(`icp-inference: app ${app_id} has no DNA yet, skipping`, { app_id });
        return { app_id, status: "skipped" as const };
      }

      const dna = app.dna as AppDna;

      const { data: strategy } = await supabaseAdmin
        .from("strategies")
        .select("personas")
        .eq("app_id", app_id)
        .eq("workspace_id", workspace_id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const personas = (strategy?.personas as StrategyPersona[] | null) ?? [];

      const adjustmentBlock = adjustment
        ? `\n\n=== FOUNDER-SUBMITTED ADJUSTMENT (prioritize this over your first inference) ===\n${JSON.stringify(
            adjustment,
            null,
            2
          )}`
        : "";

      const userMessage = `=== APP DNA ===\n${JSON.stringify(dna, null, 2)}\n\n=== MARKETING PERSONAS ===\n${JSON.stringify(
        personas,
        null,
        2
      )}${app.additional_context ? `\n\n=== ADDITIONAL DEVELOPER NOTES ===\n${app.additional_context}` : ""}${adjustmentBlock}`;

      const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
        anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1536,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        })
      );

      let responseText = "";
      for (const block of message.content) {
        if (block.type === "text") responseText += block.text;
      }
      responseText = responseText
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "");

      let icp: z.infer<typeof icpResponseSchema>;
      try {
        icp = icpResponseSchema.parse(JSON.parse(responseText));
      } catch (err) {
        logger.error("icp-inference: failed to parse Claude's response", {
          app_id,
          raw_response: responseText.slice(0, 2000),
          error: err instanceof Error ? err.message : String(err),
        });
        throw new ExternalServiceError(ErrorMessages.external.CLAUDE_FAILED, "claude");
      }

      const { error: updateError } = await supabaseAdmin
        .from("apps")
        .update({
          icp_data: { summary: icp.summary, apollo_filters: icp.apollo_filters },
          icp_status: "pending_review",
        })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      if (updateError) {
        throw new Error(`Failed to save ICP data: ${updateError.message}`);
      }

      logger.info(`icp-inference: saved ICP for app ${app_id}, triggering outreach-preview`, { app_id });

      await tasks.trigger<typeof outreachPreview>("outreach-preview", {
        app_id,
        workspace_id,
        apollo_filters: icp.apollo_filters,
      });

      return { app_id, status: "pending_review" as const };
    } catch (err) {
      // Supplementary to the core pipeline (dna-extraction/strategy-generation/
      // content-generation) — a failure here shouldn't mark the whole app
      // 'error', same as the four research-stream jobs.
      await handleJobError(err, {
        appId: app_id,
        workspaceId: workspace_id,
        jobName: "icp-inference",
        updateAppStatus: false,
      });
      throw err;
    }
  },
});
