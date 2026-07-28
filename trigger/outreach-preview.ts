import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { callExternalService } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { searchApolloPeople, enrichApolloPeople, type ApolloPerson } from "@/lib/apollo-client";
import { verifyEmail, findEmail } from "@/lib/hunter-client";
import { MODELS } from "@/lib/ai/models";
import type { AppDna, ApolloFilters } from "@/types";

const CLAUDE_MODEL: string = MODELS.STANDARD;
const PREVIEW_COUNT = 5;
// Apollo's People Search is free, so a bigger raw pool costs nothing — but
// enrichment (the only call that reveals email/trigger-event data) consumes
// real Apollo credits per record and caps at 10 per bulk_match call, so only
// the first ENRICH_POOL_SIZE search results get enriched, not the whole
// search pool.
const SEARCH_POOL_SIZE = 20;
const ENRICH_POOL_SIZE = 10;

const apolloFiltersSchema = z.object({
  person_titles: z.array(z.string()),
  person_seniorities: z.array(z.string()),
  organization_num_employees_ranges: z.array(z.string()),
  organization_industries: z.array(z.string()),
  technologies: z.array(z.string()),
});

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
  apollo_filters: apolloFiltersSchema,
});

const emailResponseSchema = z.object({
  body: z.string(),
  personalization_score: z.number().min(0).max(100),
});

const EMAIL_SYSTEM_PROMPT = `You write a single, fully personalized cold outreach email for a software product's founder to send to one specific prospect.

You will be given the product's DNA and the prospect's name/title/company, plus — if available — a specific trigger event or real detail about them or their company.

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "body": string,
  "personalization_score": number
}

"body" is the full email text (no subject line, ready to send as-is) — 4-6 sentences, casual and direct, not salesy. If a trigger event is given, the opening line MUST reference that specific event or detail — not a generic compliment. If no trigger event is given, open with the most specific real detail available (their exact title, their company's actual name, something concrete from the product DNA that connects to their likely role) rather than a generic greeting. End with a soft, low-pressure call to action, not a hard sell.

"personalization_score" is 0-100 — your own honest assessment of how specific and non-generic this exact email actually is, given what was available. A trigger-event email grounded in a real, current fact should score high (80+); an email with only a title/company to work with, done well, should score moderate (50-70). Do not inflate this — a generic-sounding email should score low even if you wrote it confidently.`;

interface ResolvedEmail {
  email: string | null;
  verified: boolean;
}

async function resolveEmail(person: ApolloPerson, appId: string): Promise<ResolvedEmail> {
  let email = person.email;

  if (!email && person.organization_domain && person.first_name && person.last_name) {
    const { email: found, error } = await findEmail(
      person.organization_domain,
      person.first_name,
      person.last_name
    );
    if (error) {
      logger.warn(`outreach-preview: Hunter email-finder failed for "${person.first_name} ${person.last_name}": ${error}`, {
        appId,
      });
    }
    email = found;
  }

  if (!email) return { email: null, verified: false };

  // Apollo's own email_status already said "verified" — trust it and skip
  // the redundant Hunter call rather than requiring both.
  if (person.email_verified_by_apollo) {
    return { email, verified: true };
  }

  const { result, error } = await verifyEmail(email);
  if (error) {
    logger.warn(`outreach-preview: Hunter email-verifier failed for ${email}: ${error}`, { appId });
    return { email, verified: false };
  }

  const verified = result?.status === "valid" || result?.status === "accept_all";
  return { email, verified };
}

async function writePersonalizedEmail(
  dna: AppDna,
  person: ApolloPerson,
  appId: string
): Promise<{ body: string; score: number } | null> {
  const anthropic = createAnthropicClient();

  const prospectBlock = `=== PROSPECT ===
Name: ${[person.first_name, person.last_name].filter(Boolean).join(" ") || "Unknown"}
Title: ${person.title ?? "Unknown"}
Company: ${person.organization_name ?? "Unknown"}
${person.trigger_event ? `Trigger event / specific detail: ${person.trigger_event}` : "No trigger event available — personalize from title/company/product fit instead."}`;

  const userMessage = `=== PRODUCT DNA ===\n${JSON.stringify(dna, null, 2)}\n\n${prospectBlock}`;

  try {
    const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
      anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 512,
        system: EMAIL_SYSTEM_PROMPT,
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

    const parsed = emailResponseSchema.parse(JSON.parse(responseText));
    return { body: parsed.body, score: Math.round(parsed.personalization_score) };
  } catch (err) {
    logger.warn(
      `outreach-preview: failed to write personalized email for "${person.first_name} ${person.last_name}" (app ${appId})`,
      { appId, error: err instanceof Error ? err.message : String(err) }
    );
    return null;
  }
}

export const outreachPreview = schemaTask({
  id: "outreach-preview",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id, apollo_filters } = payload;
    logger.info("outreach-preview: run started", { app_id, workspace_id });

    try {
      const { data: app, error: appError } = await supabaseAdmin
        .from("apps")
        .select("dna")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appError) {
        throw new Error(`Failed to load app record: ${appError.message}`);
      }

      if (!app.dna) {
        logger.warn(`outreach-preview: app ${app_id} has no DNA yet, skipping`, { app_id });
        return { app_id, savedCount: 0 };
      }

      const dna = app.dna as AppDna;

      // SOURCE 1 — Apollo people search (free, no credit cost). Requests a
      // larger pool than the final 5, but this only returns candidate IDs
      // and basic title/company — no email, no trigger-event data (Apollo's
      // search endpoint deliberately withholds both; see lib/apollo-client.ts).
      const { candidates, error: searchError } = await searchApolloPeople(
        apollo_filters as ApolloFilters,
        SEARCH_POOL_SIZE
      );

      if (searchError) {
        logger.warn(`outreach-preview: Apollo search failed for app ${app_id}: ${searchError}`, { app_id });
        return { app_id, savedCount: 0 };
      }

      if (candidates.length === 0) {
        logger.warn(`outreach-preview: Apollo returned no candidates for app ${app_id}`, { app_id });
        return { app_id, savedCount: 0 };
      }

      // SOURCE 2 — Apollo enrichment (costs real Apollo credits per record),
      // capped to ENRICH_POOL_SIZE candidates — this is the only call that
      // actually reveals email, full name, and trigger-event signal
      // (funding_events/employment_history), so prioritization can only
      // happen among this enriched subset, not the full search pool.
      const { people, error: enrichError } = await enrichApolloPeople(
        candidates.slice(0, ENRICH_POOL_SIZE).map((c) => c.id)
      );

      if (enrichError) {
        logger.warn(`outreach-preview: Apollo enrichment failed for app ${app_id}: ${enrichError}`, { app_id });
        return { app_id, savedCount: 0 };
      }

      if (people.length === 0) {
        logger.warn(`outreach-preview: Apollo enrichment returned no matches for app ${app_id}`, { app_id });
        return { app_id, savedCount: 0 };
      }

      // PRIORITIZATION — trigger-event candidates first, then best ICP
      // match (Apollo's own relevance ordering) filling any remaining slots.
      const withTriggerEvent = people.filter((p) => !!p.trigger_event);
      const withoutTriggerEvent = people.filter((p) => !p.trigger_event);
      const selected = [...withTriggerEvent, ...withoutTriggerEvent].slice(0, PREVIEW_COUNT);

      logger.info(
        `outreach-preview: selected ${selected.length}/${people.length} enriched candidate(s) (from ${candidates.length} searched) for app ${app_id} — ${withTriggerEvent.length} had a trigger event`,
        { app_id, searchPoolSize: candidates.length, enrichedPoolSize: people.length, withTriggerEvent: withTriggerEvent.length }
      );

      // Email resolution + verification, then personalized copy — run per
      // selected prospect in parallel since each is independent.
      interface ProspectResult {
        person: ApolloPerson;
        resolved: ResolvedEmail;
        draft: { body: string; score: number } | null;
      }

      const results: ProspectResult[] = await Promise.all(
        selected.map(async (person): Promise<ProspectResult> => {
          const resolved = await resolveEmail(person, app_id);
          const draft = await writePersonalizedEmail(dna, person, app_id);
          return { person, resolved, draft };
        })
      );

      const rows = results
        .filter((r) => r.draft !== null)
        .map((r) => ({
          workspace_id,
          app_id,
          first_name: r.person.first_name,
          last_name: r.person.last_name,
          email: r.resolved.email,
          company: r.person.organization_name,
          title: r.person.title,
          linkedin_url: r.person.linkedin_url,
          company_news: r.person.trigger_event,
          email_verified: r.resolved.verified,
          source: "apollo" as const,
          status: "personalised" as const,
          personalised_email: r.draft!.body,
          personalisation_score: r.draft!.score,
          is_preview: true,
        }));

      if (rows.length === 0) {
        logger.warn(`outreach-preview: no prospects survived email/draft generation for app ${app_id}`, {
          app_id,
        });
        return { app_id, savedCount: 0 };
      }

      // Replace any prior preview batch (e.g. from "Adjust this") only once
      // the new batch is actually ready — a failed run above leaves the old
      // preview set intact rather than wiping it with nothing to replace it.
      await supabaseAdmin
        .from("cold_email_prospects")
        .delete()
        .eq("app_id", app_id)
        .eq("workspace_id", workspace_id)
        .eq("is_preview", true);

      const { error: insertError } = await supabaseAdmin.from("cold_email_prospects").insert(rows);
      if (insertError) {
        throw new Error(`Failed to save preview prospects: ${insertError.message}`);
      }

      await supabaseAdmin
        .from("apps")
        .update({ first_outreach_completed: true })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      logger.info(`outreach-preview: saved ${rows.length} preview prospect(s) for app ${app_id}`, {
        app_id,
        savedCount: rows.length,
      });

      return { app_id, savedCount: rows.length };
    } catch (err) {
      await handleJobError(err, {
        appId: app_id,
        workspaceId: workspace_id,
        jobName: "outreach-preview",
        updateAppStatus: false,
      });
      throw err;
    }
  },
});
