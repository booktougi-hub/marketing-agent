import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, ValidationError, InternalError } from "@/lib/errors/AppError";
import type { BrandExtractionSource } from "@/types";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const MAX_SCREENSHOTS = 6;

function getExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "bin";
}

// Shared by both the logo (single file, replaces logo_url) and screenshots
// (appends to product_screenshots, up to MAX_SCREENSHOTS) upload flows —
// same supabaseAdmin.storage upload pattern already used for doc uploads in
// app/api/apps/route.ts, just pointed at the 'brand-assets' bucket instead
// of 'app-docs'.
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

  const formData = await request.formData();
  const file = formData.get("file");
  const kind = formData.get("kind"); // "logo" | "screenshot"

  if (!(file instanceof File)) {
    throw new ValidationError(ErrorMessages.generic.INVALID_REQUEST_BODY);
  }
  if (kind !== "logo" && kind !== "screenshot") {
    throw new ValidationError(ErrorMessages.generic.INVALID_REQUEST_BODY);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new ValidationError(ErrorMessages.brandInformation.FILE_TOO_LARGE);
  }
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    throw new ValidationError(ErrorMessages.brandInformation.INVALID_FILE_TYPE);
  }

  const { data: existingRow } = await supabaseAdmin
    .from("brand_information")
    .select("product_screenshots, extraction_source")
    .eq("app_id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (kind === "screenshot" && (existingRow?.product_screenshots?.length ?? 0) >= MAX_SCREENSHOTS) {
    throw new ValidationError(ErrorMessages.brandInformation.TOO_MANY_SCREENSHOTS);
  }

  const path = `${workspaceId}/${id}/${kind}-${Date.now()}.${getExtension(file.name)}`;

  try {
    const bytes = await file.arrayBuffer();
    const { error: uploadError } = await supabaseAdmin.storage
      .from("brand-assets")
      .upload(path, Buffer.from(bytes), { contentType: file.type, upsert: true });

    if (uploadError) {
      throw new Error(uploadError.message);
    }
  } catch {
    throw new InternalError(ErrorMessages.brandInformation.UPLOAD_FAILED);
  }

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from("brand-assets").getPublicUrl(path);

  const nextSource: BrandExtractionSource = {
    ...(existingRow?.extraction_source as BrandExtractionSource | null),
  };

  const update: Record<string, unknown> = { extraction_source: nextSource };

  if (kind === "logo") {
    update.logo_url = publicUrl;
    nextSource.logo_url = "manual";
  } else {
    const nextScreenshots = [...(existingRow?.product_screenshots ?? []), publicUrl];
    update.product_screenshots = nextScreenshots;
    nextSource.product_screenshots = "manual";
  }

  const { error: upsertError } = await supabaseAdmin
    .from("brand_information")
    .upsert({ app_id: id, workspace_id: workspaceId, ...update }, { onConflict: "app_id" });

  if (upsertError) {
    throw new InternalError(ErrorMessages.brandInformation.UPLOAD_FAILED);
  }

  return NextResponse.json({ success: true, url: publicUrl }, { status: 200 });
});
