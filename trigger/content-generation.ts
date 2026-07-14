import { logger, schemaTask } from "@trigger.dev/sdk";
import OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { buildDevtoSystemPrompt, buildRealLinksBlock } from "@/lib/devto-article";
import { handleJobError } from "@/lib/errors/jobErrorHandler";
import { callExternalService, ExternalServiceError } from "@/lib/errors/AppError";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import type { AppDna, StrategyContentPillar } from "@/types";

// Routes across whichever free-tier models currently have capacity, instead
// of pinning to one popular model (meta-llama/llama-3.3-70b-instruct:free)
// that gets rate-limited under free-tier load.
const OPENROUTER_MODEL = "openrouter/free";

// Devto articles use Claude, not the free OpenRouter tier the short-form
// posts below use — long-form structured Markdown (headers, tables, cited
// links, varied prose) is exactly the harder formatting task the free tier
// struggles with, and article volume is low enough that the cost is small.
const CLAUDE_MODEL = "claude-sonnet-5";
const DEVTO_MAX_TOKENS = 2048;
const DEVTO_ARTICLE_COUNT = 2;

const TWITTER_POST_COUNT = 15;
const LINKEDIN_POST_COUNT = 8;
const SCHEDULE_WINDOW_DAYS = 30;
const POST_HOURS_UTC = [13, 16, 20];

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

function buildSystemPrompt(platform: "twitter" | "linkedin", count: number) {
  const constraints =
    platform === "twitter"
      ? "Each post must be under 280 characters, punchy, and written like a real founder tweeting — no hashtag spam, at most 1 hashtag if it fits naturally."
      : "Each post should be 3-6 short paragraphs, professional but personable, written like a founder sharing a genuine insight on LinkedIn — no hashtag spam, at most 2-3 relevant hashtags at the end.";

  return `You are a social media copywriter creating ${platform} posts for a software product's marketing strategy.

You will be given the product's DNA (name, tagline, problem, features), its target personas, and its content pillars (each with example topics). Use this to write ${count} distinct, specific, non-repetitive posts that would genuinely resonate with the target personas.

${constraints}

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
      openrouter.chat.completions.create({
        model: OPENROUTER_MODEL,
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
  realLinks: (string | null | undefined)[]
): string {
  const dnaBlock = `=== PRODUCT DNA ===\n${JSON.stringify(dna, null, 2)}`;
  const contextBlock = additionalContext
    ? `\n\n=== ADDITIONAL CONTEXT FROM THE FOUNDER ===\n${additionalContext}`
    : "";
  const pillarBlock = `=== CONTENT PILLAR ===\n${JSON.stringify(pillar, null, 2)}`;
  const linksBlock = buildRealLinksBlock(realLinks);

  return `${dnaBlock}${contextBlock}\n\n${pillarBlock}\n\n${linksBlock}\n\nWrite the article around this content pillar's theme — pick one of its example topics as the specific angle. The hook must cite a specific, real detail from the product DNA or additional context above (an exact feature, an exact tagline phrase, a specific fact) — not a generic paraphrase.`;
}

async function generateDevtoArticles(
  anthropic: Anthropic,
  dna: AppDna,
  additionalContext: string | null,
  sourceUrl: string,
  pillars: StrategyContentPillar[],
  tone: string | null
): Promise<{ pillar: string; body: string }[]> {
  const selectedPillars = pillars.slice(0, DEVTO_ARTICLE_COUNT);
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
          { role: "user", content: buildDevtoUserPrompt(dna, additionalContext, pillar, realLinks) },
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

      const contextBlock = `=== APP DNA ===
${JSON.stringify(app.dna, null, 2)}

=== PERSONAS ===
${JSON.stringify(strategy.personas, null, 2)}

=== CONTENT PILLARS ===
${JSON.stringify(strategy.content_pillars, null, 2)}

=== TONE ===
${strategy.tone}`;

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
        strategy.tone
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
