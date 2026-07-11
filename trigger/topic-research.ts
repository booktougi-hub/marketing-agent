import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { runResearchStream } from "@/lib/research-job";

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
  triggered_manually: z.boolean(),
});

const topicSchema = z.object({
  topic: z.string(),
  search_volume: z.number().nullable().optional(),
  trend: z.enum(["up", "down", "flat"]).nullable().optional(),
  source: z.enum(["google_trends", "reddit", "twitter"]),
  angle: z.string(),
});

const SYSTEM_PROMPT = `You are a marketing research analyst finding trending topics a software product could credibly join the conversation on.

You'll be given the product's DNA (name, tagline, problem, target audience, tone) and raw search results gathered under three source labels: google_trends, reddit, twitter. Use the "source:" label on each result as that topic's source.

Respond with ONLY a JSON array matching this exact shape — no prose, no markdown code fences:
[{
  "topic": string,                // the trending topic or keyword phrase
  "search_volume": number|null,   // estimated monthly search volume if inferable from the result content, else null
  "trend": "up"|"down"|"flat"|null,
  "source": "google_trends"|"reddit"|"twitter",
  "angle": string                 // one sentence: how this product could join this conversation with a post
}]

Only include topics genuinely relevant to the product's target audience and problem space — do not force a connection. Return at most 6 topics. If nothing in the search results is relevant, return an empty array.`;

// Manually re-run from Settings > App Identity ("Re-analyse App") or the
// Research page's "Run Research Now" (triggered_manually: true), and
// automatically as part of the first-approval kickoff and the weekly Sunday
// scan (triggered_manually: false). triggered_manually isn't currently used
// inside the run — kept in the payload so a future revision can, say, ask
// for more results on a manual run without changing every caller.
export const topicResearch = schemaTask({
  id: "topic-research",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id, triggered_manually } = payload;
    logger.info("topic-research: run started", { app_id, workspace_id, triggered_manually });

    try {
      const result = await runResearchStream({
        logger,
        appId: app_id,
        workspaceId: workspace_id,
        stream: "topic_research",
        buildQueries: (dna) => {
          const keyword = dna.target_audience || dna.problem || dna.name;
          if (!keyword) return [];
          return [
            { query: `${keyword} trends 2026`, label: "google_trends" },
            { query: `site:reddit.com ${keyword}`, label: "reddit" },
            { query: `site:twitter.com OR site:x.com ${keyword}`, label: "twitter" },
          ];
        },
        systemPrompt: SYSTEM_PROMPT,
        itemsSchema: z.array(topicSchema).max(8),
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "topic-research failed unexpectedly.";
      logger.error("topic-research failed", { app_id, workspace_id, error: message });
      throw err;
    }
  },
});
