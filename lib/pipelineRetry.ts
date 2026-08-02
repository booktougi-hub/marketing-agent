import "server-only";
import { runs, tasks } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { appRunTag } from "@/lib/jobHealthRegistry";
import { ErrorMessages } from "@/lib/errors/messages";
import { InternalError, ValidationError } from "@/lib/errors/AppError";
import { NEVER_RAN_STATUSES } from "@/lib/triggerRunStatus";
import type { AppStatus } from "@/types";
import type { dnaExtraction } from "@/trigger/dna-extraction";
import type { competitorResearch } from "@/trigger/competitor-research";
import type { strategyGeneration } from "@/trigger/strategy-generation";
import type { contentGeneration } from "@/trigger/content-generation";

// Every in-progress pipeline status — mirrors app-content-gate.tsx's
// LOADING_STATUSES, duplicated rather than imported since that's a client
// component constant and this is a server-only module.
const LOADING_STATUSES = new Set<AppStatus>([
  "pending",
  "extracting",
  "competitor_research_pending",
  "diagnosis_pending",
  "strategy_pending",
]);

export type PipelineRetryStage =
  | "dna-extraction"
  | "competitor-research"
  | "strategy-generation"
  | "content-generation";

// Shared by POST /api/apps/[id]/retry (the app-level error card in
// components/apps/app-content-gate.tsx) and POST /api/apps/[id]/retry-job
// when the failed job is "content-generation" or "diagnosis" (both of which
// flip apps.status to 'error' on failure — see
// lib/errors/jobErrorHandler.ts) — one retry implementation, not two.
//
// Which stage actually failed isn't recoverable from stored state alone —
// every pipeline job's own catch block clears pending_run_id/
// pending_run_task on failure, so by the time an app sits in 'error' that
// trail is already gone. Instead this infers the correct stage from what's
// actually been produced so far: no DNA means dna-extraction never
// finished; DNA but no diagnosis means competitor-research (which always
// chains into diagnosis itself, on zero-competitors or any other outcome)
// needs to run again; diagnosis but no active strategy means
// strategy-generation; otherwise content-generation is the only thing left
// that could have failed.
function inferRetryStage(app: {
  dna: unknown;
  diagnosis: unknown;
  hasActiveStrategy: boolean;
}): PipelineRetryStage {
  if (!app.dna) return "dna-extraction";
  if (!app.diagnosis) return "competitor-research";
  if (!app.hasActiveStrategy) return "strategy-generation";
  return "content-generation";
}

const IN_FLIGHT_STATUS: Record<PipelineRetryStage, string> = {
  "dna-extraction": "extracting",
  "competitor-research": "competitor_research_pending",
  "strategy-generation": "strategy_pending",
  "content-generation": "active",
};

const TRIGGER_FAILED_MESSAGE: Record<PipelineRetryStage, string> = {
  "dna-extraction": ErrorMessages.apps.TRIGGER_DNA_EXTRACTION_FAILED,
  "competitor-research": ErrorMessages.apps.TRIGGER_COMPETITOR_RESEARCH_FAILED,
  "strategy-generation": ErrorMessages.apps.TRIGGER_STRATEGY_GENERATION_FAILED,
  "content-generation": ErrorMessages.apps.TRIGGER_CONTENT_GENERATION_FAILED,
};

// Free — an app landing in 'error' is our pipeline failing, not something
// the founder did, so retrying it never costs an agent credit.
export async function retryPipeline(
  appId: string,
  workspaceId: string
): Promise<{ stage: PipelineRetryStage }> {
  const { data: app } = await supabaseAdmin
    .from("apps")
    .select("id, status, pending_run_id, source_url, additional_context, doc_paths, dna, diagnosis")
    .eq("id", appId)
    .eq("workspace_id", workspaceId)
    .single();

  if (!app) {
    throw new ValidationError(ErrorMessages.apps.NOT_IN_ERROR_STATE, "NOT_IN_ERROR_STATE");
  }

  // A founder clicking Retry while the app is still in a genuine
  // in-progress status (not yet 'error') is only valid if the run we're
  // actually tracking has already died — checked here directly against
  // Trigger.dev rather than trusting trigger/job-watchdog.ts to have
  // already flagged it, since that cron only runs if a worker happens to
  // be online (see that file's own comment) and shouldn't be a single
  // point of failure for recovering a stuck app.
  if (app.status !== "error") {
    const stillGenuinelyRunning = new ValidationError(
      ErrorMessages.apps.NOT_IN_ERROR_STATE,
      "NOT_IN_ERROR_STATE"
    );

    if (!LOADING_STATUSES.has(app.status as AppStatus) || !app.pending_run_id) {
      throw stillGenuinelyRunning;
    }

    try {
      const run = await runs.retrieve(app.pending_run_id);
      if (!NEVER_RAN_STATUSES.has(run.status)) {
        throw stillGenuinelyRunning;
      }
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      // A lookup failure against Trigger.dev's API is not evidence the run
      // itself died — fail safe by treating the app as still running rather
      // than letting a transient API error trigger a duplicate pipeline run.
      throw stillGenuinelyRunning;
    }
  }

  const { count: activeStrategyCount } = await supabaseAdmin
    .from("strategies")
    .select("id", { count: "exact", head: true })
    .eq("app_id", appId)
    .eq("workspace_id", workspaceId)
    .eq("status", "active");

  const stage = inferRetryStage({
    dna: app.dna,
    diagnosis: app.diagnosis,
    hasActiveStrategy: (activeStrategyCount ?? 0) > 0,
  });

  await supabaseAdmin
    .from("apps")
    .update({ status: IN_FLIGHT_STATUS[stage], error_message: null })
    .eq("id", appId)
    .eq("workspace_id", workspaceId);

  try {
    const tagOptions = { tags: [appRunTag(appId)] };
    let handle: { id: string };

    if (stage === "dna-extraction") {
      handle = await tasks.trigger<typeof dnaExtraction>(
        "dna-extraction",
        {
          app_id: appId,
          workspace_id: workspaceId,
          source_url: app.source_url,
          has_additional_context: !!app.additional_context,
          has_docs: (app.doc_paths?.length ?? 0) > 0,
        },
        tagOptions
      );
    } else if (stage === "competitor-research") {
      handle = await tasks.trigger<typeof competitorResearch>(
        "competitor-research",
        { app_id: appId, workspace_id: workspaceId },
        tagOptions
      );
    } else if (stage === "strategy-generation") {
      handle = await tasks.trigger<typeof strategyGeneration>(
        "strategy-generation",
        { app_id: appId, workspace_id: workspaceId, diagnosis_correction: null },
        tagOptions
      );
    } else {
      handle = await tasks.trigger<typeof contentGeneration>(
        "content-generation",
        { app_id: appId, workspace_id: workspaceId },
        tagOptions
      );
    }

    await supabaseAdmin
      .from("apps")
      .update({ pending_run_id: handle.id, pending_run_task: stage })
      .eq("id", appId)
      .eq("workspace_id", workspaceId);
  } catch (err) {
    console.error(`Failed to retry ${stage}:`, err);
    await supabaseAdmin
      .from("apps")
      .update({
        status: "error",
        error_message: TRIGGER_FAILED_MESSAGE[stage],
        pending_run_id: null,
        pending_run_task: null,
      })
      .eq("id", appId)
      .eq("workspace_id", workspaceId);
    throw new InternalError(ErrorMessages.apps.RETRY_FAILED);
  }

  return { stage };
}
