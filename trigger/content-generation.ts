// brand_information.tone_descriptors/words_to_avoid now flow into both
// system prompts below via buildBrandVoiceBlock() (lib/devto-article.ts) —
// resolves the standing TODO that used to live here (extraction + Settings
// UI existed via trigger/brand-info-extraction.ts, but nothing downstream
// ever read the result). key_stats is not wired in this pass — proof-point
// citation is a separate concern from voice/word-choice and would need its
// own no-fabrication framing; left for a follow-up rather than folded in
// here as an afterthought.
import { logger, schemaTask } from "@trigger.dev/sdk";
import OpenAI, { BadRequestError, NotFoundError, RateLimitError } from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { buildBrandVoiceBlock, buildDevtoSystemPrompt, buildRealLinksBlock } from "@/lib/devto-article";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { callExternalService, ExternalServiceError } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import { MODELS } from "@/lib/ai/models";
import type { AppDna, StrategyContentPillar } from "@/types";

interface BrandVoice {
  tone_descriptors: string[] | null;
  words_to_avoid: string[] | null;
}

// Pinned, predictable model for public-facing brand content — per
// MODELS.BULK_CONTENT_FREE (lib/ai/models.ts). The previous unpinned
// "openrouter/free" routing alias was a deliberate choice to dodge
// rate-limiting under free-tier load, not an oversight — that protection
// is preserved below as an explicit fallback (see
// createOpenRouterCompletion), attempted only after the pinned model
// itself is rate-limited OR no longer exists, with the fallback path
// logged so it's visible how often it actually triggers in practice.
//
// 2026-07-27: both this model and the old FALLBACK_OPENROUTER_MODEL value
// ("openrouter/free") had been silently retired by OpenRouter — every
// call was failing instantly with a model-not-found error, breaking
// content generation for every app (see lib/ai/models.ts's comment on
// BULK_CONTENT_FREE for the full incident note). That's why the fallback
// trigger below now also covers NotFoundError/BadRequestError, not just
// RateLimitError — a retired/renamed model is a real, recurring failure
// mode on OpenRouter's free tier, not just rate-limiting.
const OPENROUTER_MODEL: string = MODELS.BULK_CONTENT_FREE;
const FALLBACK_OPENROUTER_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

// Devto articles use Claude, not the free OpenRouter tier the short-form
// posts below use — long-form structured Markdown (headers, tables, cited
// links, varied prose) is exactly the harder formatting task the free tier
// struggles with, and article volume is low enough that the cost is small.
const CLAUDE_MODEL: string = MODELS.STANDARD;
const DEVTO_MAX_TOKENS = 2048;

// Diagnosis-first redesign (PHASES.md, 2026-07-14): shifted from one 30-day
// batch to ~7-8 days per run, so the product feels alive/current instead of
// dumping a month of content then going quiet. Counts scaled down from the
// old 15/8-per-30-days pace to roughly the same daily rate over a week.
// trigger/content-regeneration-check.ts (new) re-triggers this run weekly,
// once an app's remaining scheduled posts drop low.
const TWITTER_POST_COUNT = 4;
const LINKEDIN_POST_COUNT = 2;
const SCHEDULE_WINDOW_DAYS = 7;
const POST_HOURS_UTC = [13, 16, 20];
// Long-form articles at the old monthly pace (2 per 30 days) would be
// excessive weekly — scaled down to 1 per weekly run.
const WEEKLY_DEVTO_ARTICLE_COUNT = 1;
// How many of the freshest Topics/Problems findings to pull in per stream —
// enough to give real variety without dominating the prompt.
const RESEARCH_FINDINGS_PER_STREAM = 5;

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

const generatedPostsSchema = z.object({
  posts: z
    .array(
      z.object({
        pillar: z.string(),
        body: z.string(),
      })
    )
    .min(1),
});

function buildSchedule(count: number, startDate: Date): Date[] {
  return Array.from({ length: count }, (_, i) => {
    const dayOffset = Math.floor((i * SCHEDULE_WINDOW_DAYS) / count);
    const hour = POST_HOURS_UTC[i % POST_HOURS_UTC.length];
    const date = new Date(startDate);
    date.setUTCDate(date.getUTCDate() + dayOffset);
    date.setUTCHours(hour, 0, 0, 0);
    return date;
  });
}

// CRAFT_PRINCIPLES_CONDENSED below: reasoning framework swapped for
// .claude/skills/content-strategy/SKILL.md + .claude/skills/copywriting/
// SKILL.md + .claude/skills/copy-editing/SKILL.md + .claude/skills/
// marketing-psychology/SKILL.md combined — same skill-credit pattern as the
// four Audits-family jobs (trigger/pricing-audit.ts:79 etc.) and this
// file's own long-form path (lib/devto-article.ts's CRAFT_PRINCIPLES), but
// deliberately compressed to one line per skill instead of that file's
// fuller numbered list: this path runs on MODELS.BULK_CONTENT_FREE, a
// pinned free-tier model kept cheap and fast on purpose (see the model
// comment above) — bloating its prompt undermines exactly what that model
// choice is for.
const CRAFT_PRINCIPLES_CONDENSED = `- Be specific, not vague: a real number or concrete detail beats an abstract claim ("saves 3 hours a week," not "saves time").
- Lead with the benefit, not the feature — what does the reader actually get, not what the product technically does.
- Every non-obvious claim needs something to back it up — a real detail from the DNA/research given, not an assertion on its own.
- A post either answers something people are already searching for, or says something genuinely worth sharing (a real insight, a specific number, a take) — not generic filler either way.`;

function buildSystemPrompt(platform: "twitter" | "linkedin", count: number) {
  const constraints =
    platform === "twitter"
      ? "Each post must be under 280 characters, punchy, and written like a real founder tweeting — no hashtag spam, at most 1 hashtag if it fits naturally."
      : "Each post should be 3-6 short paragraphs, professional but personable, written like a founder sharing a genuine insight on LinkedIn — no hashtag spam, at most 2-3 relevant hashtags at the end.";

  return `You are a social media copywriter creating ${platform} posts for a software product's marketing strategy.

You will be given the product's DNA (name, tagline, problem, features), its target personas, its content pillars (each with example topics), and — when available — this week's freshest trending topics and real user problems from ongoing research. Use this to write ${count} distinct, specific, non-repetitive posts that would genuinely resonate with the target personas. When a fresh topic or real problem is available and fits a pillar, prefer it over that pillar's static example topics — this is what keeps the content current week to week instead of repeating the same angles the strategy was written with.

${constraints}

Writing principles:
${CRAFT_PRINCIPLES_CONDENSED}

If a "=== BRAND VOICE ===" section appears in what you're given, it always overrides the writing principles above whenever they conflict — the founder's specific stated tone and words-to-avoid win over this general guidance every time.

Distribute the ${count} posts across the given content pillars as evenly as possible. Each post's "pillar" field must exactly match one of the pillar names you were given.

Respond with ONLY a JSON object matching this exact shape — no prose, no markdown code fences:
{
  "posts": [{ "pillar": string, "body": string }]
}
Return exactly ${count} posts.`;
}

// LinkedIn posts run 3-6 paragraphs each and "openrouter/free" can route to
// reasoning models that spend a chunk of the token budget on hidden
// reasoning before the actual answer — 4096 was getting exhausted mid-string
// for the (longer, 8-post) LinkedIn batch. Twitter posts are short enough
// that the original budget is fine.
const MAX_TOKENS_BY_PLATFORM: Record<"twitter" | "linkedin", number> = {
  twitter: 4096,
  linkedin: 8192,
};

// Tries the pinned MODELS.BULK_CONTENT_FREE first; falls back to a second
// pinned free model only if the primary is rate-limited (429) OR has
// itself become unavailable — OpenRouter periodically retires free-tier
// models without notice (see the 2026-07-27 incident note above), and a
// retired model surfaces as a 404/400 (NotFoundError/BadRequestError),
// not a 429. Both fallback models stay explicitly pinned — never an
// unpinned "whichever has capacity" alias — for anything that produces
// public-facing brand content. Logs whenever the fallback actually
// fires, so real-world frequency is visible rather than assumed.
async function createOpenRouterCompletion(
  openrouter: OpenAI,
  platform: "twitter" | "linkedin",
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model">
): Promise<OpenAI.Chat.ChatCompletion> {
  try {
    return await openrouter.chat.completions.create({ ...params, model: OPENROUTER_MODEL });
  } catch (err) {
    const primaryModelUnavailable =
      err instanceof RateLimitError || err instanceof NotFoundError || err instanceof BadRequestError;
    if (!primaryModelUnavailable) throw err;
    logger.warn(
      `content-generation: "${OPENROUTER_MODEL}" unavailable (${err.constructor.name}) generating ${platform} posts — falling back to "${FALLBACK_OPENROUTER_MODEL}" for this call`,
      { platform, pinnedModel: OPENROUTER_MODEL, fallbackModel: FALLBACK_OPENROUTER_MODEL, errorType: err.constructor.name }
    );
    return openrouter.chat.completions.create({ ...params, model: FALLBACK_OPENROUTER_MODEL });
  }
}

async function generatePosts(
  openrouter: OpenAI,
  platform: "twitter" | "linkedin",
  count: number,
  contextBlock: string
) {
  logger.info(`content-generation: generating ${platform} posts`, { count });

  const completion = await callExternalService(
    "openrouter",
    ErrorMessages.external.OPENROUTER_FAILED,
    () =>
      createOpenRouterCompletion(openrouter, platform, {
        max_tokens: MAX_TOKENS_BY_PLATFORM[platform],
        messages: [
          { role: "system", content: buildSystemPrompt(platform, count) },
          { role: "user", content: contextBlock },
        ],
      })
  );

  const finishReason = completion.choices[0]?.finish_reason;
  let responseText = completion.choices[0]?.message?.content ?? "";
  responseText = responseText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  let parsed: z.infer<typeof generatedPostsSchema>;
  try {
    parsed = generatedPostsSchema.parse(JSON.parse(responseText));
  } catch (err) {
    logger.error(`content-generation: failed to parse ${platform} response`, {
      finish_reason: finishReason,
      raw_response: responseText.slice(0, 2000),
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ExternalServiceError(ErrorMessages.external.OPENROUTER_FAILED, "openrouter");
  }

  logger.info(`content-generation: ${platform} posts generated`, {
    received: parsed.posts.length,
  });

  return parsed.posts;
}

// Devto articles aren't seeded from a research finding the way the
// from-research route's are — the "specific real detail" they need to cite
// comes from the app's own DNA and founder-provided additional_context
// instead. One content pillar becomes one article's angle.
function buildDevtoUserPrompt(
  dna: AppDna,
  additionalContext: string | null,
  pillar: StrategyContentPillar,
  realLinks: (string | null | undefined)[],
  brandVoice: BrandVoice | null
): string {
  const dnaBlock = `=== PRODUCT DNA ===\n${JSON.stringify(dna, null, 2)}`;
  const contextBlock = additionalContext
    ? `\n\n=== ADDITIONAL CONTEXT FROM THE FOUNDER ===\n${additionalContext}`
    : "";
  const pillarBlock = `=== CONTENT PILLAR ===\n${JSON.stringify(pillar, null, 2)}`;
  const linksBlock = buildRealLinksBlock(realLinks);
  const brandVoiceBlock = buildBrandVoiceBlock(brandVoice);

  return `${dnaBlock}${contextBlock}\n\n${pillarBlock}\n\n${linksBlock}${brandVoiceBlock ? `\n\n${brandVoiceBlock}` : ""}\n\nWrite the article around this content pillar's theme — pick one of its example topics as the specific angle. The hook must cite a specific, real detail from the product DNA or additional context above (an exact feature, an exact tagline phrase, a specific fact) — not a generic paraphrase.`;
}

async function generateDevtoArticles(
  anthropic: Anthropic,
  dna: AppDna,
  additionalContext: string | null,
  sourceUrl: string,
  pillars: StrategyContentPillar[],
  tone: string | null,
  brandVoice: BrandVoice | null
): Promise<{ pillar: string; body: string }[]> {
  const selectedPillars = pillars.slice(0, WEEKLY_DEVTO_ARTICLE_COUNT);
  if (selectedPillars.length === 0) return [];

  logger.info("content-generation: generating devto articles", {
    count: selectedPillars.length,
  });

  const systemPrompt = buildDevtoSystemPrompt({ includeComparisonTable: false, tone });
  const realLinks = [sourceUrl, ...(dna.additional_urls ?? [])];

  const articles: { pillar: string; body: string }[] = [];
  // Sequential, same as the twitter/linkedin calls above — this only runs a
  // couple of times per job, so there's no rate-limit pressure to justify
  // the added complexity of parallelizing.
  for (const pillar of selectedPillars) {
    const message = await callExternalService("claude", ErrorMessages.external.CLAUDE_FAILED, () =>
      anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: DEVTO_MAX_TOKENS,
        system: systemPrompt,
        messages: [
          { role: "user", content: buildDevtoUserPrompt(dna, additionalContext, pillar, realLinks, brandVoice) },
        ],
      })
    );

    const body = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim()
      .replace(/^```(?:\w+)?\s*/, "")
      .replace(/```\s*$/, "")
      .trim();

    if (!body) {
      throw new ExternalServiceError(ErrorMessages.external.CLAUDE_FAILED, "claude");
    }

    articles.push({ pillar: pillar.name, body });
  }

  logger.info("content-generation: devto articles generated", { received: articles.length });
  return articles;
}

export const contentGeneration = schemaTask({
  id: "content-generation",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;

    logger.info("content-generation: run started", { app_id, workspace_id });

    try {
      const openrouter = new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY!,
        baseURL: "https://openrouter.ai/api/v1",
        // Free-tier OpenRouter models rate-limit aggressively; the SDK's
        // default of 2 retries isn't enough headroom, so give it more.
        maxRetries: 6,
        // SDK default is a 10-minute timeout per attempt — with maxRetries
        // raised to 6 that's a 60-minute worst case for one call if a
        // request ever genuinely hangs instead of failing fast. 60s is
        // generous for these prompts; 6 retries on top is still bounded to
        // 6 minutes worst case instead of 60.
        timeout: 60_000,
      });
      const anthropic = createAnthropicClient();

      const { data: app, error: appError } = await supabaseAdmin
        .from("apps")
        .select("dna, additional_context, source_url")
        .eq("id", app_id)
        .eq("workspace_id", workspace_id)
        .single();

      if (appError || !app?.dna) {
        throw new Error(`Failed to load app DNA: ${appError?.message ?? "DNA missing"}`);
      }

      const { data: strategy, error: strategyError } = await supabaseAdmin
        .from("strategies")
        .select("id, personas, content_pillars, tone")
        .eq("app_id", app_id)
        .eq("workspace_id", workspace_id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (strategyError || !strategy) {
        throw new Error("No active strategy found to generate content from.");
      }

      // Weekly rhythm redesign (PHASES.md, 2026-07-14): each run now also
      // pulls in the freshest Topics/Problems research so week 3's content
      // reflects week 3's actual trending topics, not what was trending when
      // the strategy was first generated a month ago. This connection did
      // not exist before — content-generation previously only read the
      // static strategy. brand_information (2026-08-01) rides in the same
      // Promise.all — a maybeSingle() read since not every app has a brand
      // identity row yet (see trigger/brand-info-extraction.ts).
      const [{ data: topicRows }, { data: problemRows }, { data: brandInfo }] = await Promise.all([
        supabaseAdmin
          .from("research_findings")
          .select("findings")
          .eq("app_id", app_id)
          .eq("workspace_id", workspace_id)
          .eq("stream", "topic_research")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(RESEARCH_FINDINGS_PER_STREAM),
        supabaseAdmin
          .from("research_findings")
          .select("findings")
          .eq("app_id", app_id)
          .eq("workspace_id", workspace_id)
          .eq("stream", "problem_discovery")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(RESEARCH_FINDINGS_PER_STREAM),
        supabaseAdmin
          .from("brand_information")
          .select("tone_descriptors, words_to_avoid")
          .eq("app_id", app_id)
          .eq("workspace_id", workspace_id)
          .maybeSingle(),
      ]);

      const brandVoice: BrandVoice | null = brandInfo
        ? { tone_descriptors: brandInfo.tone_descriptors, words_to_avoid: brandInfo.words_to_avoid }
        : null;

      const researchBlock =
        (topicRows?.length ?? 0) > 0 || (problemRows?.length ?? 0) > 0
          ? `

=== THIS WEEK'S TRENDING TOPICS (prefer these over generic pillar examples when they fit) ===
${(topicRows ?? []).map((r) => JSON.stringify(r.findings)).join("\n") || "(none this week)"}

=== RECENT REAL USER PROBLEMS FOUND (prefer these over generic pillar examples when they fit) ===
${(problemRows ?? []).map((r) => JSON.stringify(r.findings)).join("\n") || "(none this week)"}`
          : "";

      const brandVoiceBlock = buildBrandVoiceBlock(brandVoice);

      const contextBlock = `=== APP DNA ===
${JSON.stringify(app.dna, null, 2)}

=== PERSONAS ===
${JSON.stringify(strategy.personas, null, 2)}

=== CONTENT PILLARS ===
${JSON.stringify(strategy.content_pillars, null, 2)}

=== TONE ===
${strategy.tone}${researchBlock}${brandVoiceBlock ? `\n\n${brandVoiceBlock}` : ""}`;

      // Run sequentially rather than in parallel — two simultaneous calls to
      // the same free-tier model compounds rate-limit pressure.
      const twitterPosts = await generatePosts(
        openrouter,
        "twitter",
        TWITTER_POST_COUNT,
        contextBlock
      );
      const linkedinPosts = await generatePosts(
        openrouter,
        "linkedin",
        LINKEDIN_POST_COUNT,
        contextBlock
      );
      const devtoArticles = await generateDevtoArticles(
        anthropic,
        app.dna as AppDna,
        app.additional_context,
        app.source_url,
        (strategy.content_pillars ?? []) as StrategyContentPillar[],
        strategy.tone,
        brandVoice
      );

      const startDate = new Date();
      startDate.setUTCDate(startDate.getUTCDate() + 1);

      const twitterSchedule = buildSchedule(twitterPosts.length, startDate);
      const linkedinSchedule = buildSchedule(linkedinPosts.length, startDate);

      const rows = [
        ...twitterPosts.map((post, i) => ({
          app_id,
          workspace_id,
          strategy_id: strategy.id,
          platform: "twitter" as const,
          content_type: "post" as const,
          body: post.body,
          pillar: post.pillar,
          status: "scheduled" as const,
          scheduled_at: twitterSchedule[i].toISOString(),
        })),
        ...linkedinPosts.map((post, i) => ({
          app_id,
          workspace_id,
          strategy_id: strategy.id,
          platform: "linkedin" as const,
          content_type: "post" as const,
          body: post.body,
          pillar: post.pillar,
          status: "scheduled" as const,
          scheduled_at: linkedinSchedule[i].toISOString(),
        })),
        // Draft, not scheduled — long-form articles are worth a human look
        // before they go out, unlike the short social posts above. No
        // publisher job auto-publishes any platform yet, so this is purely
        // about review workflow, not blocking automation.
        ...devtoArticles.map((article) => ({
          app_id,
          workspace_id,
          strategy_id: strategy.id,
          platform: "devto" as const,
          content_type: "article" as const,
          body: article.body,
          pillar: article.pillar,
          status: "draft" as const,
        })),
      ];

      const { error: insertError } = await supabaseAdmin.from("content").insert(rows);

      if (insertError) {
        throw new Error(`Failed to save generated content: ${insertError.message}`);
      }

      logger.info("content-generation: content saved", { count: rows.length });

      await supabaseAdmin
        .from("apps")
        .update({ pending_run_id: null, pending_run_task: null })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      return { app_id, posts_created: rows.length };
    } catch (err) {
      await handleJobError(err, { appId: app_id, workspaceId: workspace_id, jobName: "content-generation" });
      throw err;
    }
  },
});
