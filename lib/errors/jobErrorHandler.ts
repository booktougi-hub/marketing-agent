import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { AppError } from "./AppError";
import { ErrorMessages } from "./messages";
import { captureError } from "./sentry";

interface JobErrorContext {
  appId?: string;
  workspaceId?: string;
  jobName: string;
  // Only the three pipeline jobs (dna-extraction, strategy-generation,
  // content-generation) flip apps.status to 'error' and clear
  // pending_run_id/pending_run_task on failure. The four research-stream
  // jobs (topic-research, problem-discovery, forum-opportunity-finder,
  // competitor-gap-analysis) intentionally leave the app's status alone —
  // one research stream failing shouldn't mark the whole app broken, and
  // they never set pending_run_id in the first place. Defaults to true to
  // match the pipeline jobs; research jobs pass false explicitly.
  updateAppStatus?: boolean;
}

// Shared catch-block helper for every Trigger.dev job — standardizes how a
// job failure is logged, optionally recorded on the apps row, and reported
// to Sentry, mirroring the API routes' handleApiError.
export async function handleJobError(
  error: unknown,
  context: JobErrorContext
): Promise<{ message: string; errorCode: string }> {
  const { appId, workspaceId, jobName, updateAppStatus = true } = context;

  const message = error instanceof AppError ? error.message : ErrorMessages.generic.UNKNOWN;
  const errorCode = error instanceof AppError ? error.errorCode : "UNKNOWN_JOB_ERROR";

  console.error(`[JOB ERROR] ${jobName}`, {
    error: error instanceof Error ? error.message : error,
    stack: error instanceof Error ? error.stack : undefined,
    appId,
    workspaceId,
  });

  if (appId && workspaceId && updateAppStatus) {
    await supabaseAdmin
      .from("apps")
      .update({
        status: "error",
        error_message: message,
        pending_run_id: null,
        pending_run_task: null,
      })
      .eq("id", appId)
      .eq("workspace_id", workspaceId);
  }

  if (!(error instanceof AppError) || !error.isOperational) {
    captureError(error, { jobName, appId, workspaceId });
  }

  return { message, errorCode };
}
