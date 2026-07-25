import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { tasks } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { JOB_HEALTH_REGISTRY, appRunTag, isJobCurrentlyFailed } from "@/lib/jobHealthRegistry";
import { retryPipeline } from "@/lib/pipelineRetry";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors/AppError";
import type { topicResearch } from "@/trigger/topic-research";
import type { problemDiscovery } from "@/trigger/problem-discovery";
import type { forumOpportunityFinder } from "@/trigger/forum-opportunity-finder";
import type { competitorGapAnalysis } from "@/trigger/competitor-gap-analysis";
import type { onboardingAudit } from "@/trigger/onboarding-audit";
import type { churnAudit } from "@/trigger/churn-audit";
import type { croAudit } from "@/trigger/cro-audit";
import type { pricingAudit } from "@/trigger/pricing-audit";
import type { seoGeoAudit } from "@/trigger/seo-geo-audit";

const postSchema = z.object({
  jobName: z.string(),
});

const REGISTRY_JOB_NAMES = new Set(JOB_HEALTH_REGISTRY.map((j) => j.jobName));

// "Retry" on a failed row in the System Health panel
// (components/apps/app-system-health-card.tsx). Free, unlike a fresh manual
// run via POST /api/apps/[id]/agent-action — the founder didn't cause this
// job to fail, so retrying it shouldn't cost a credit. Gated by
// isJobCurrentlyFailed so this can't be used as a free bypass of the credit
// system for jobs that haven't actually failed.
//
// "content-generation" and "diagnosis" both flip apps.status to 'error' on
// failure (see lib/errors/jobErrorHandler.ts) and share their retry logic
// with the app-level error card via lib/pipelineRetry.ts. Every other
// registry job intentionally leaves apps.status alone on failure
// (updateAppStatus: false in each job's own catch block), so retrying one
// of those is just a direct re-trigger with its normal payload.
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

  const json = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(json);

  if (!parsed.success || !REGISTRY_JOB_NAMES.has(parsed.data.jobName)) {
    throw new ValidationError(ErrorMessages.generic.INVALID_REQUEST_BODY);
  }

  const jobName = parsed.data.jobName;

  const { data: app } = await supabaseAdmin
    .from("apps")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!app) {
    throw new NotFoundError(ErrorMessages.apps.NOT_FOUND);
  }

  const currentlyFailed = await isJobCurrentlyFailed(jobName, id);
  if (!currentlyFailed) {
    throw new ValidationError("This job hasn't failed — nothing to retry.", "NOT_FAILED");
  }

  if (jobName === "content-generation" || jobName === "diagnosis") {
    const { stage } = await retryPipeline(id, workspaceId);
    return NextResponse.json({ success: true, stage }, { status: 200 });
  }

  const jobPayload = { app_id: id, workspace_id: workspaceId };
  const tagOptions = { tags: [appRunTag(id)] };

  if (jobName === "topic-research") {
    await tasks.trigger<typeof topicResearch>(
      "topic-research",
      { ...jobPayload, triggered_manually: true },
      tagOptions
    );
  } else if (jobName === "problem-discovery") {
    await tasks.trigger<typeof problemDiscovery>(
      "problem-discovery",
      { ...jobPayload, triggered_manually: true },
      tagOptions
    );
  } else if (jobName === "forum-opportunity-finder") {
    await tasks.trigger<typeof forumOpportunityFinder>("forum-opportunity-finder", jobPayload, tagOptions);
  } else if (jobName === "competitor-gap-analysis") {
    await tasks.trigger<typeof competitorGapAnalysis>("competitor-gap-analysis", jobPayload, tagOptions);
  } else if (jobName === "onboarding-audit") {
    await tasks.trigger<typeof onboardingAudit>("onboarding-audit", jobPayload, tagOptions);
  } else if (jobName === "churn-audit") {
    await tasks.trigger<typeof churnAudit>("churn-audit", jobPayload, tagOptions);
  } else if (jobName === "cro-audit") {
    await tasks.trigger<typeof croAudit>("cro-audit", jobPayload, tagOptions);
  } else if (jobName === "pricing-audit") {
    await tasks.trigger<typeof pricingAudit>("pricing-audit", jobPayload, tagOptions);
  } else if (jobName === "seo-geo-audit") {
    await tasks.trigger<typeof seoGeoAudit>("seo-geo-audit", jobPayload, tagOptions);
  }

  return NextResponse.json({ success: true }, { status: 200 });
});
