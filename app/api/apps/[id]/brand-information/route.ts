import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, ValidationError, InternalError } from "@/lib/errors/AppError";
import type { BrandExtractionSource } from "@/types";

// Every customer-editable column — deliberately excludes the metadata
// columns (extraction_source/extraction_status/extraction_error/
// last_analyzed_at/updated_at/id/app_id/workspace_id), which only the
// extraction job and this route itself ever write.
const patchSchema = z
  .object({
    brand_name: z.string().nullable(),
    one_liner: z.string().nullable(),
    category: z.string().nullable(),
    website_url: z.string().url().nullable(),
    problem_solved: z.string().nullable(),
    target_customer: z.string().nullable(),
    differentiator: z.string().nullable(),
    known_competitors: z.array(z.string()).nullable(),
    tone_descriptors: z.array(z.string()).nullable(),
    words_to_avoid: z.array(z.string()).nullable(),
    writing_sample: z.string().nullable(),
    key_stats: z
      .array(z.object({ label: z.string(), value: z.string(), source_url: z.string().nullable() }))
      .nullable(),
    testimonial: z.string().nullable(),
    testimonial_source: z.string().nullable(),
    pricing_summary: z
      .array(z.object({ plan_name: z.string(), price: z.string(), billing_period: z.string().nullable() }))
      .nullable(),
    social_handles: z.record(z.string(), z.string()).nullable(),
    github_repo_url: z.string().nullable(),
    founder_name: z.string().nullable(),
    founder_bio: z.string().nullable(),
    claims_to_avoid: z.array(z.string()).nullable(),
    target_regions: z.array(z.string()).nullable(),
    primary_color_hex: z.string().nullable(),
    secondary_color_hex: z.string().nullable(),
    font_preference: z.string().nullable(),
  })
  .partial();

async function resolveWorkspaceId(userId: string) {
  const { data: membership } = await supabaseAdmin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .single();
  return membership?.workspace_id as string | undefined;
}

export const PATCH = withErrorHandling(async (
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

  const workspaceId = await resolveWorkspaceId(user.id);
  if (!workspaceId) {
    throw new ForbiddenError(ErrorMessages.auth.NO_WORKSPACE, "NO_WORKSPACE");
  }

  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);

  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? ErrorMessages.generic.INVALID_REQUEST_BODY);
  }

  const fields = parsed.data;
  const fieldNames = Object.keys(fields);

  if (fieldNames.length === 0) {
    throw new ValidationError(ErrorMessages.apps.NO_CHANGES_PROVIDED);
  }

  const { data: existingRow, error: existingRowError } = await supabaseAdmin
    .from("brand_information")
    .select("extraction_source")
    .eq("app_id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (existingRowError) {
    throw new InternalError(ErrorMessages.brandInformation.UPDATE_FAILED);
  }

  // Every field the customer explicitly edits is stamped "manual" so a
  // later Re-analyze never silently overwrites it — this is the only place
  // that promise gets kept, so it has to run on every save, not just the
  // fields that changed value (re-saving the same value still means "the
  // customer looked at this and confirmed it").
  const nextSource: BrandExtractionSource = { ...(existingRow?.extraction_source as BrandExtractionSource | null) };
  for (const name of fieldNames) {
    nextSource[name] = "manual";
  }

  const update = { ...fields, extraction_source: nextSource };

  const { error: upsertError } = await supabaseAdmin.from("brand_information").upsert(
    {
      app_id: id,
      workspace_id: workspaceId,
      ...update,
    },
    { onConflict: "app_id" }
  );

  if (upsertError) {
    throw new InternalError(ErrorMessages.brandInformation.UPDATE_FAILED);
  }

  return NextResponse.json({ success: true }, { status: 200 });
});
