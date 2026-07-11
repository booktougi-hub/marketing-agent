import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { runResearchStream } from "@/lib/research-job";

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
  triggered_manually: z.boolean(),
});

const problemSchema = z.object({
  statement: z.string(),
  source_platform: z.string(),
  source_url: z.string().nullable().optional(),
  app_fit: z.string(),
});

const SYSTEM_PROMPT = `You are a marketing research analyst finding real user problems a software product could credibly speak to.

You'll be given the product's DNA (name, tagline, problem, target audience, features, tone) and raw search results from the web (mostly Reddit threads and forum posts).

Respond with ONLY a JSON array matching this exact shape — no prose, no markdown code fences:
[{
  "statement": string,       // the problem in the user's own words, quotable — pull an actual sentence or close paraphrase from the source, don't invent one
  "source_platform": string, // where you found it, e.g. "Reddit", "Forum", "Hacker News"
  "source_url": string|null, // the URL of the result this came from
  "app_fit": string          // one sentence: how this specific product solves this problem, grounded in its actual features from the DNA
}]

Only include genuine, specific complaints or requests that this product's actual features address — do not force a connection or invent a problem that isn't in the source text. Return at most 6 problems. If nothing in the search results is relevant, return an empty array.`;

export const problemDiscovery = schemaTask({
  id: "problem-discovery",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id, triggered_manually } = payload;
    logger.info("problem-discovery: run started", { app_id, workspace_id, triggered_manually });

    try {
      const result = await runResearchStream({
        logger,
        appId: app_id,
        workspaceId: workspace_id,
        stream: "problem_discovery",
        buildQueries: (dna) => {
          const keyword = dna.target_audience || dna.problem || dna.name;
          if (!keyword) return [];
          return [
            {
              query: `site:reddit.com ${keyword} (annoying OR frustrating OR "wish there was" OR "does anyone know")`,
              label: "Reddit",
            },
            { query: `"${dna.problem}" complaints`, label: "Forum" },
          ];
        },
        systemPrompt: SYSTEM_PROMPT,
        itemsSchema: z.array(problemSchema).max(8),
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "problem-discovery failed unexpectedly.";
      logger.error("problem-discovery failed", { app_id, workspace_id, error: message });
      throw err;
    }
  },
});
