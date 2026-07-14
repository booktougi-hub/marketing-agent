import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { parseCompetitorGap, parseProblem, parseTopic } from "@/lib/research";
import { buildDevtoSystemPrompt, buildRealLinksBlock } from "@/lib/devto-article";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { createAnthropicClient } from "@/lib/anthropic-client";
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  InternalError,
  ExternalServiceError,
} from "@/lib/errors/AppError";
import type { AppDna, ResearchStream } from "@/types";

const CLAUDE_MODEL = "claude-sonnet-5";

const DRAFT_PLATFORMS = ["twitter", "linkedin", "devto"] as const;
type DraftPlatform = (typeof DRAFT_PLATFORMS)[number];

const postSchema = z.object({
  research_finding_id: z.string().uuid(),
  type: z.enum(["topic", "problem", "competitor_gap"]),
  platform: z.enum(DRAFT_PLATFORMS),
});

// Maps each UI-facing "type" to the research_findings.stream value it
// should be reading from, so a stale/mismatched id can't silently generate
// a post from the wrong kind of finding.
const STREAM_BY_TYPE: Record<z.infer<typeof postSchema>["type"], ResearchStream> = {
  topic: "topic_research",
  problem: "problem_discovery",
  competitor_gap: "competitor_gap",
};

const PILLAR_BY_TYPE: Record<z.infer<typeof postSchema>["type"], string> = {
  topic: "Trending Topic",
  problem: "Problem-Driven",
  competitor_gap: "Competitor Comparison",
};

const CONTENT_TYPE_BY_PLATFORM: Record<DraftPlatform, "post" | "article"> = {
  twitter: "post",
  linkedin: "post",
  devto: "article",
};

const MAX_TOKENS_BY_PLATFORM: Record<DraftPlatform, number> = {
  twitter: 512,
  linkedin: 768,
  devto: 2048,
};

// What to write about — shared across all three destination platforms.
// Format/length/voice constraints are layered on separately per platform
// in buildSystemPrompt.
function buildFindingInstruction(
  type: z.infer<typeof postSchema>["type"],
  dna: AppDna,
  findings: unknown
): string | null {
  const dnaBlock = `=== PRODUCT DNA ===\n${JSON.stringify(dna, null, 2)}`;

  if (type === "topic") {
    const parsed = parseTopic(findings);
    if (!parsed.topic) return null;
    return `${dnaBlock}\n\n=== TRENDING TOPIC ===\n${parsed.topic}${parsed.angle ? `\nSuggested angle: ${parsed.angle}` : ""}\n\nWrite about this trending topic as the subject, tied to the product's value proposition.`;
  }

  if (type === "problem") {
    const parsed = parseProblem(findings);
    if (!parsed.statement) return null;
    return `${dnaBlock}\n\n=== REAL USER PROBLEM ===\n"${parsed.statement}"${parsed.appFit ? `\nHow this product solves it: ${parsed.appFit}` : ""}\n\nOpen with this exact problem statement in the reader's own language, then position the product as the answer.`;
  }

  const parsed = parseCompetitorGap(findings);
  if (!parsed.gap) return null;
  return `${dnaBlock}\n\n=== COMPETITOR GAP ===\nCompetitor: ${parsed.competitorName ?? "a competitor"}\nGap: ${parsed.gap}${parsed.positioning ? `\nSuggested positioning: ${parsed.positioning}` : ""}\n\nWrite a comparison-style piece highlighting this specific gap as a differentiator.`;
}

const DEVTO_ANGLE_BY_TYPE: Record<z.infer<typeof postSchema>["type"], string> = {
  topic: "Write the article around this trending topic, tied to the product's value proposition. The hook must cite the actual topic detail above, not a paraphrase of it.",
  problem: "The hook must open with the exact real problem statement/quote from the finding above — not a paraphrase — then build the article around how the product solves it.",
  competitor_gap: "Write a comparison-style article positioning the product against the competitor named in the finding above, using the specific gap described as the throughline. The hook must cite the actual gap/data point above, not a generic paraphrase.",
};

// Devto articles get the full raw finding JSON (not the summarized fields
// the other platforms use) plus every real URL available, so Claude has
// concrete specifics to cite and a fixed, non-hallucinated set of link
// targets — see PART 1 of the content-quality goal this implements.
function buildDevtoUserPrompt(
  type: z.infer<typeof postSchema>["type"],
  dna: AppDna,
  appSourceUrl: string,
  findings: unknown,
  findingSourceUrl: string | null
): string {
  const dnaBlock = `=== PRODUCT DNA ===\n${JSON.stringify(dna, null, 2)}`;
  const findingBlock = `=== FULL RESEARCH FINDING (reference material — cite exact specifics from this, don't write generically) ===\n${JSON.stringify(findings, null, 2)}`;
  const linksBlock = buildRealLinksBlock([appSourceUrl, ...(dna.additional_urls ?? []), findingSourceUrl]);

  return `${dnaBlock}\n\n${findingBlock}\n\n${linksBlock}\n\n${DEVTO_ANGLE_BY_TYPE[type]}`;
}

// Devto has its own dedicated prompt path (buildDevtoUserPrompt +
// buildDevtoSystemPrompt from lib/devto-article) — this only covers the two
// short-form platforms.
function buildSystemPrompt(
  platform: "twitter" | "linkedin",
  strategy: { tone: string | null; twitter_strategy: string | null; linkedin_strategy: string | null }
): string {
  if (platform === "twitter") {
    return `You are a social media copywriter writing a single Twitter post for a software product.

You will be given the product's DNA (name, tagline, problem, features, target audience, tone) and a research finding to build the post around. Follow the specific instruction for that finding exactly.
${strategy.twitter_strategy ? `\nThe product's Twitter voice: ${strategy.twitter_strategy}\n` : ""}
Constraints: HARD LIMIT of 280 characters total, including spaces and punctuation — count carefully and leave margin, a post that gets cut off is worse than a shorter one. Punchy, written like a real founder tweeting — no hashtag spam (at most 1 hashtag if it fits naturally), no markdown formatting.

Respond with ONLY the post text — no prose about what you're doing, no quotes around it, no code fences.`;
  }

  return `You are a LinkedIn content writer for a software product.

You will be given the product's DNA (name, tagline, problem, features, target audience, tone) and a research finding to build the post around. Follow the specific instruction for that finding exactly.
${strategy.linkedin_strategy ? `\nThe product's LinkedIn voice: ${strategy.linkedin_strategy}\n` : ""}
Constraints: 150-300 words, professional tone, written like a founder sharing a genuine insight — no hashtag spam (at most 2-3 relevant hashtags at the end), no markdown formatting. End with a clear call to action.

Respond with ONLY the post text — no prose about what you're doing, no quotes around it, no code fences.`;
}

export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
    const { id } = await params;

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new UnauthorizedError(ErrorMessages.auth.UNAUTHORIZED);
    }

    const { data: membership } = await supabaseAdmin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .single();

    const workspaceId = membership?.workspace_id as string | undefined;

    if (!workspaceId) {
      throw new ForbiddenError(ErrorMessages.auth.NO_WORKSPACE, "NO_WORKSPACE");
    }

    const { data: app } = await supabaseAdmin
      .from("apps")
      .select("id, dna, source_url")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!app) {
      throw new NotFoundError(ErrorMessages.apps.NOT_FOUND);
    }

    if (!app.dna) {
      throw new ValidationError(ErrorMessages.apps.NO_DNA, "NO_DNA");
    }

    const json = await request.json().catch(() => null);
    const parsed = postSchema.safeParse(json);

    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? ErrorMessages.generic.INVALID_REQUEST_BODY);
    }

    const { research_finding_id, type, platform } = parsed.data;
    const expectedStream = STREAM_BY_TYPE[type];

    const { data: finding } = await supabaseAdmin
      .from("research_findings")
      .select("id, stream, findings, status")
      .eq("id", research_finding_id)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!finding) {
      throw new NotFoundError(ErrorMessages.research.FINDING_NOT_FOUND);
    }

    if (finding.stream !== expectedStream) {
      throw new ValidationError(ErrorMessages.research.TYPE_MISMATCH, "TYPE_MISMATCH");
    }

    const findingInstruction = buildFindingInstruction(type, app.dna as AppDna, finding.findings);
    if (!findingInstruction) {
      throw new ValidationError(ErrorMessages.research.INCOMPLETE_FINDING, "INCOMPLETE_FINDING");
    }

    const { data: activeStrategy } = await supabaseAdmin
      .from("strategies")
      .select("id, tone, twitter_strategy, linkedin_strategy")
      .eq("app_id", id)
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let systemPrompt: string;
    let userPrompt: string;

    if (platform === "devto") {
      const findingSourceUrl = type === "problem" ? parseProblem(finding.findings).sourceUrl : null;
      userPrompt = buildDevtoUserPrompt(
        type,
        app.dna as AppDna,
        app.source_url,
        finding.findings,
        findingSourceUrl
      );
      systemPrompt = buildDevtoSystemPrompt({
        includeComparisonTable: type === "competitor_gap",
        tone: activeStrategy?.tone ?? null,
      });
    } else {
      userPrompt = findingInstruction;
      systemPrompt = buildSystemPrompt(platform, {
        tone: activeStrategy?.tone ?? null,
        twitter_strategy: activeStrategy?.twitter_strategy ?? null,
        linkedin_strategy: activeStrategy?.linkedin_strategy ?? null,
      });
    }

    const anthropic = createAnthropicClient();
    let body: string;
    try {
      const message = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS_BY_PLATFORM[platform],
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      body = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim()
        .replace(/^```(?:\w+)?\s*/, "")
        .replace(/```\s*$/, "")
        .replace(/^"([\s\S]*)"$/, "$1")
        .trim();
    } catch (err) {
      console.error("from-research: Claude call failed:", err);
      throw new ExternalServiceError(ErrorMessages.content.FROM_RESEARCH_FAILED, "claude", "LLM_ERROR");
    }

    if (!body) {
      throw new InternalError(ErrorMessages.content.EMPTY_LLM_OUTPUT, "LLM_ERROR");
    }

    // Claude doesn't reliably self-enforce an exact character count, and
    // Twitter's 280-char limit is a hard platform constraint, not a style
    // preference — clamp as a safety net rather than trust the prompt alone.
    const TWITTER_MAX_LENGTH = 280;
    if (platform === "twitter" && body.length > TWITTER_MAX_LENGTH) {
      const truncated = body.slice(0, TWITTER_MAX_LENGTH - 1);
      const lastSpace = truncated.lastIndexOf(" ");
      body = `${lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated}…`;
    }

    const { data: created, error: insertError } = await supabaseAdmin
      .from("content")
      .insert({
        app_id: id,
        workspace_id: workspaceId,
        strategy_id: activeStrategy?.id ?? null,
        platform,
        content_type: CONTENT_TYPE_BY_PLATFORM[platform],
        body,
        pillar: PILLAR_BY_TYPE[type],
        status: "draft",
        source_research_finding_id: finding.id,
      })
      .select()
      .single();

    if (insertError || !created) {
      throw new InternalError(ErrorMessages.content.SAVE_GENERATED_FAILED);
    }

    await supabaseAdmin
      .from("research_findings")
      .update({ status: "acted_on" })
      .eq("id", finding.id)
      .eq("app_id", id)
      .eq("workspace_id", workspaceId);

    return NextResponse.json({ content: created }, { status: 201 });
});
