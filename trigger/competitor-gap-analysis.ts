import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { runResearchStream } from "@/lib/research-job";

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

const gapSchema = z.object({
  competitor_name: z.string(),
  gap: z.string(),
  source: z.string(), // e.g. "G2 Reviews", "Capterra", "Changelog"
  positioning: z.string(),
});

const SYSTEM_PROMPT = `You are a competitive positioning analyst finding real weaknesses in a software product's named competitors.

You'll be given the product's DNA (name, tagline, problem, features, competitors) and raw search results — review sites, changelogs, complaint threads — about those competitors.

Respond with ONLY a JSON array matching this exact shape — no prose, no markdown code fences:
[{
  "competitor_name": string,  // which competitor this gap is about
  "gap": string,               // the specific weakness or missing feature, grounded in what the source actually says
  "source": string,            // where you found it, e.g. "G2 Reviews", "Capterra", "Reddit"
  "positioning": string        // one sentence: how to use this gap in this product's marketing copy, grounded in its actual features from the DNA — don't claim a feature the product doesn't have
}]

Only include gaps that are actually stated or clearly implied in the search results — do not invent weaknesses. Return at most 6 gaps. If nothing in the search results is usable, return an empty array.`;

export const competitorGapAnalysis = schemaTask({
  id: "competitor-gap-analysis",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;
    logger.info("competitor-gap-analysis: run started", { app_id, workspace_id });

    try {
      const result = await runResearchStream({
        logger,
        appId: app_id,
        workspaceId: workspace_id,
        stream: "competitor_gap",
        buildQueries: (dna) => {
          const competitors = (dna.competitors ?? []).filter(Boolean).slice(0, 3);
          return competitors.flatMap((competitor) => [
            { query: `"${competitor}" reviews complaints`, label: competitor, limit: 3 },
            { query: `site:g2.com OR site:capterra.com "${competitor}"`, label: competitor, limit: 2 },
          ]);
        },
        systemPrompt: SYSTEM_PROMPT,
        itemsSchema: z.array(gapSchema).max(6),
        cadence: "monthly",
      });

      return result;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "competitor-gap-analysis failed unexpectedly.";
      logger.error("competitor-gap-analysis failed", { app_id, workspace_id, error: message });
      throw err;
    }
  },
});
