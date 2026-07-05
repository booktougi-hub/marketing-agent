import { logger, schemaTask } from "@trigger.dev/sdk";
import OpenAI from "openai";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";

// Routes across whichever free-tier models currently have capacity, instead
// of pinning to one popular model (meta-llama/llama-3.3-70b-instruct:free)
// that gets rate-limited under free-tier load.
const OPENROUTER_MODEL = "openrouter/free";

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

async function generatePosts(
  openrouter: OpenAI,
  platform: "twitter" | "linkedin",
  count: number,
  contextBlock: string
) {
  logger.info(`content-generation: generating ${platform} posts`, { count });

  const completion = await openrouter.chat.completions.create({
    model: OPENROUTER_MODEL,
    max_tokens: 4096,
    messages: [
      { role: "system", content: buildSystemPrompt(platform, count) },
      { role: "user", content: contextBlock },
    ],
  });

  let responseText = completion.choices[0]?.message?.content ?? "";
  responseText = responseText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  let parsed: z.infer<typeof generatedPostsSchema>;
  try {
    parsed = generatedPostsSchema.parse(JSON.parse(responseText));
  } catch (err) {
    throw new Error(
      `${platform} generation returned unparseable output: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  logger.info(`content-generation: ${platform} posts generated`, {
    received: parsed.posts.length,
  });

  return parsed.posts;
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
      });

      const { data: app, error: appError } = await supabaseAdmin
        .from("apps")
        .select("dna")
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
      ];

      const { error: insertError } = await supabaseAdmin.from("content").insert(rows);

      if (insertError) {
        throw new Error(`Failed to save generated content: ${insertError.message}`);
      }

      logger.info("content-generation: content saved", { count: rows.length });

      return { app_id, posts_created: rows.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Content generation failed.";
      logger.error("content-generation failed", {
        app_id,
        workspace_id,
        error: message,
        stack: err instanceof Error ? err.stack : undefined,
      });

      await supabaseAdmin
        .from("apps")
        .update({ status: "error", error_message: message })
        .eq("id", app_id)
        .eq("workspace_id", workspace_id);

      throw err;
    }
  },
});
