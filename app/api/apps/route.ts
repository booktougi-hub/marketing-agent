import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { tasks } from "@trigger.dev/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, ValidationError, InternalError } from "@/lib/errors/AppError";
import type { dnaExtraction } from "@/trigger/dna-extraction";
import type { ProductType } from "@/types";

const PRODUCT_TYPES = [
  "developer_tool",
  "mobile_app",
  "web_app",
  "saas",
  "browser_extension",
  "other",
] as const;

const MAX_DOCS = 3;
const MAX_DOC_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_DOC_EXTENSIONS = new Set(["pdf", "docx", "txt", "md"]);

function getExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function isProductType(value: string): value is ProductType {
  return (PRODUCT_TYPES as readonly string[]).includes(value);
}

const urlSchema = z.string().url();

export const POST = withErrorHandling(async (request: NextRequest) => {
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

    // getUser() revalidates the token against the Supabase Auth server.
    // getSession() only reads the cookie and must not be trusted here.
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

    const formData = await request.formData();
    const url = (formData.get("url") as string | null) ?? "";
    const productTypeRaw = (formData.get("product_type") as string | null) || "other";
    const additionalContextRaw =
      (formData.get("additional_context") as string | null) || "";
    const docs = formData
      .getAll("docs")
      .filter((entry): entry is File => entry instanceof File);

    const urlResult = urlSchema.safeParse(url);
    if (!urlResult.success) {
      throw new ValidationError(ErrorMessages.apps.INVALID_URL);
    }

    const productType: ProductType = isProductType(productTypeRaw)
      ? productTypeRaw
      : "other";
    const additionalContext = additionalContextRaw.trim();

    const { data: workspace } = await supabaseAdmin
      .from("workspaces")
      .select("plan_tier")
      .eq("id", workspaceId)
      .single();

    // TODO(prod): this gate is disabled outside production so the free-tier
    // limit doesn't block local testing. Before shipping, verify the check
    // still works end-to-end in production and consider driving it off
    // something more explicit than NODE_ENV (e.g. a feature flag).
    if (process.env.NODE_ENV === "production" && workspace?.plan_tier === "free") {
      const { count } = await supabaseAdmin
        .from("apps")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId);

      if ((count ?? 0) >= 1) {
        throw new ForbiddenError(ErrorMessages.apps.PLAN_LIMIT_REACHED, "PLAN_LIMIT_REACHED");
      }
    }

    const { data: newApp, error: insertError } = await supabaseAdmin
      .from("apps")
      .insert({
        workspace_id: workspaceId,
        source_url: urlResult.data,
        product_type: productType,
        additional_context: additionalContext || null,
        status: "extracting",
        name: null,
      })
      .select("id")
      .single();

    if (insertError || !newApp) {
      throw new InternalError(ErrorMessages.apps.CREATE_FAILED);
    }

    if (docs.length > 0) {
      const docPaths: string[] = [];

      for (const file of docs.slice(0, MAX_DOCS)) {
        if (file.size > MAX_DOC_SIZE_BYTES) {
          console.error(`Skipping ${file.name}: exceeds 10MB limit`);
          continue;
        }
        if (!ACCEPTED_DOC_EXTENSIONS.has(getExtension(file.name))) {
          console.error(`Skipping ${file.name}: unsupported file type`);
          continue;
        }

        try {
          const bytes = await file.arrayBuffer();
          const buffer = Buffer.from(bytes);
          const path = `${workspaceId}/${newApp.id}/${file.name}`;

          const { error: uploadError } = await supabaseAdmin.storage
            .from("app-docs")
            .upload(path, buffer, {
              contentType: file.type || undefined,
              upsert: true,
            });

          if (uploadError) {
            console.error(`Failed to upload ${file.name}:`, uploadError.message);
            continue;
          }

          docPaths.push(path);
        } catch (err) {
          console.error(`Failed to upload ${file.name}:`, err);
        }
      }

      if (docPaths.length > 0) {
        await supabaseAdmin
          .from("apps")
          .update({ doc_paths: docPaths })
          .eq("id", newApp.id)
          .eq("workspace_id", workspaceId);
      }
    }

    try {
      const handle = await tasks.trigger<typeof dnaExtraction>("dna-extraction", {
        app_id: newApp.id,
        workspace_id: workspaceId,
        source_url: urlResult.data,
        has_additional_context: !!additionalContext,
        has_docs: docs.length > 0,
      });
      // Tracked so trigger/job-watchdog.ts can detect a run that never gets
      // to execute its own error handling (worker unavailable, killed
      // mid-run, etc.) instead of leaving this app stuck at "extracting".
      await supabaseAdmin
        .from("apps")
        .update({ pending_run_id: handle.id, pending_run_task: "dna-extraction" })
        .eq("id", newApp.id)
        .eq("workspace_id", workspaceId);
    } catch (err) {
      console.error("Failed to trigger dna-extraction:", err);
      // The app record was created successfully even if the job trigger
      // fails, so we don't fail the request — surface it on the record.
      await supabaseAdmin
        .from("apps")
        .update({
          status: "error",
          error_message: ErrorMessages.apps.TRIGGER_DNA_EXTRACTION_FAILED,
        })
        .eq("id", newApp.id)
        .eq("workspace_id", workspaceId);
    }

    return NextResponse.json({ id: newApp.id }, { status: 201 });
});
