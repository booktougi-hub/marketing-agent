import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { runResearchStream } from "@/lib/research-job";
import { supabaseAdmin } from "@/lib/supabase-server";
import { handleJobError } from "@/lib/errors/jobErrorHandler";

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

const opportunitySchema = z.object({
  platform: z.enum(["reddit", "hackernews", "quora", "linkedin", "x"]),
  source_name: z.string(), // e.g. "r/webdev", "Hacker News"
  title: z.string(),
  url: z.string(),
  content: z.string(), // thread excerpt, used for the 200-char preview on the Opportunities page
  posted_at: z.string().nullable().optional(),
  engagement_count: z.number().nullable().optional(),
  relevance: z.enum(["high", "medium", "low"]),
  drafted_reply: z.string(),
});

// Reasoning framework swapped for .claude/skills/community-marketing/
// SKILL.md + .claude/skills/social/SKILL.md combined — same pattern as the
// Audits-family jobs (trigger/pricing-audit.ts:79 etc.), condensed for the
// BULK_CLASSIFICATION tier this call runs on via lib/research-job.ts's
// shared runResearchStream (one call per candidate thread, the
// highest-call-volume LLM path in this codebase).
const SYSTEM_PROMPT = `You are a community manager finding forum threads where a software product could genuinely help by replying — not advertise, actually help.

=== CORE FRAMEWORK — AUTHENTIC COMMUNITY ENGAGEMENT (apply this reasoning, do not just restate it) ===
1. GIVE BEFORE YOU ASK — the reply's primary job is solving the poster's actual problem; the product is a secondary mention, never the point of the reply.
2. REAL FIT AND TIMING, NOT TOPICAL ADJACENCY — a genuine opportunity is a poster with a current, specific problem this product actually solves, in a conversation that's still active — not just a thread that happens to share a keyword. Judge "relevance" honestly against this bar, not against how good a bridge you could write to the product.
3. AVOID THE SPAM SIGNALS — a reply that could be pasted into any similar thread unchanged, or that leads with the pitch instead of the answer, is a spam signal even when politely worded. Mention the product only when it's the single most helpful, specific answer to what was actually asked.

=== CORE FRAMEWORK — PLATFORM-NATIVE VOICE ===
1. MATCH THE PLATFORM'S REGISTER — a reply that reads as native to Reddit (blunt, no marketing polish) would read wrong on LinkedIn, and vice versa; write "drafted_reply" in the voice that specific platform actually rewards.
2. SPECIFICITY SIGNALS AUTHENTICITY — a reply grounded in a concrete detail from this exact thread reads as real; a generic reply that could answer any similar-sounding thread reads as copy-paste, no matter how well-written.

You'll be given the product's DNA (name, tagline, problem, target audience, features, tone) and raw search results gathered under source labels: reddit, hackernews, quora, linkedin, x.

Respond with ONLY a JSON array matching this exact shape — no prose, no markdown code fences:
[{
  "platform": "reddit"|"hackernews"|"quora"|"linkedin"|"x",   // from the result's "source:" label
  "source_name": string,     // subreddit or site, e.g. "r/webdev", "Hacker News"
  "title": string,           // the thread title
  "url": string,
  "content": string,         // a short excerpt of the actual thread content (max ~250 chars)
  "posted_at": string|null,  // ISO date if you can tell when the thread was posted, else null
  "engagement_count": number|null,  // upvotes/points/comments if visible in the result, else null
  "relevance": "high"|"medium"|"low",  // how directly this product could help — be honest, most things are "low" or not worth including at all
  "drafted_reply": string    // a genuinely helpful, non-salesy reply a human could post as-is or lightly edit — mention the product only if it's a natural fit, don't force it
}]

Only include threads where the product would be a genuine, specific fit — not just tangentially related. Return at most 5 threads. If nothing in the search results is a real fit, return an empty array.`;

export const forumOpportunityFinder = schemaTask({
  id: "forum-opportunity-finder",
  schema: payloadSchema,
  run: async (payload) => {
    const { app_id, workspace_id } = payload;
    logger.info("forum-opportunity-finder: run started", { app_id, workspace_id });

    try {
      // Keywords seeded from Problem Discovery / Competitor Gap findings via
      // the Research page's "Search Forums For This" action — read alongside
      // the normal DNA-derived keyword, then marked consumed below so they
      // only ever influence this one run.
      const { data: seedRows } = await supabaseAdmin
        .from("forum_search_seeds")
        .select("id, keyword")
        .eq("app_id", app_id)
        .eq("workspace_id", workspace_id)
        .is("consumed_at", null)
        .order("created_at", { ascending: true })
        .limit(10);

      const seeds = seedRows ?? [];

      const result = await runResearchStream({
        logger,
        appId: app_id,
        workspaceId: workspace_id,
        stream: "forum_opportunities",
        buildQueries: (dna) => {
          const keyword = dna.target_audience || dna.problem || dna.name;
          const base = keyword
            ? [
                { query: `site:reddit.com ${keyword}`, label: "reddit", limit: 3 },
                { query: `site:news.ycombinator.com ${keyword}`, label: "hackernews", limit: 3 },
                { query: `site:quora.com ${keyword}`, label: "quora", limit: 3 },
                { query: `site:linkedin.com ${keyword}`, label: "linkedin", limit: 2 },
                { query: `site:twitter.com OR site:x.com ${keyword}`, label: "x", limit: 3 },
              ]
            : [];
          const seedQueries = seeds.map((seed) => ({
            query: `site:reddit.com ${seed.keyword.slice(0, 150)}`,
            label: "reddit" as const,
            limit: 3,
          }));
          return [...base, ...seedQueries];
        },
        systemPrompt: SYSTEM_PROMPT,
        itemsSchema: z.array(opportunitySchema).max(5),
      });

      if (seeds.length > 0) {
        await supabaseAdmin
          .from("forum_search_seeds")
          .update({ consumed_at: new Date().toISOString() })
          .in(
            "id",
            seeds.map((seed) => seed.id)
          );
      }

      return result;
    } catch (err) {
      await handleJobError(err, {
        appId: app_id,
        workspaceId: workspace_id,
        jobName: "forum-opportunity-finder",
        updateAppStatus: false,
      });
      throw err;
    }
  },
});
