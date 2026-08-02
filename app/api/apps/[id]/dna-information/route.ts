import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, ValidationError, InternalError } from "@/lib/errors/AppError";
import type { AppDna, DnaExtractionSource } from "@/types";

// Every field the Product Information page lets the customer edit directly
// on the `dna` jsonb column — deliberately excludes `app_store_urls` (shown
// read-only; re-derived from badge links on the site, not something a
// customer types in) and `overview` (a display-only projection of name/
// tagline/website assembled in lib/dna-extraction-core.ts, not stored
// independently). `business_model.source` is never accepted from the
// client — see below, it's forced to null on any manual edit.
const patchSchema = z
  .object({
    name: z.string(),
    tagline: z.string(),
    problem: z.string(),
    target_audience: z.string(),
    competitors: z.array(z.string()),
    additional_urls: z.array(z.string()),
    tone: z.enum(["casual", "professional", "technical"]),
    what_it_does: z.string().nullable(),
    key_features: z.array(z.string()),
    product_category: z.array(z.string()),
    product_type: z.string().nullable(),
    target_customers: z.string().nullable(),
    primary_cta: z.string().nullable(),
    tech_signals: z.object({
      model_or_stack_used: z.string().nullable(),
      supported_formats_or_languages: z.array(z.string()),
      integrations: z.array(z.string()),
      architecture_description: z.string().nullable(),
    }),
    business_model: z.object({ narrative: z.string().nullable() }),
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
  const fieldNames = Object.keys(fields) as (keyof typeof fields)[];

  if (fieldNames.length === 0) {
    throw new ValidationError(ErrorMessages.apps.NO_CHANGES_PROVIDED);
  }

  const { data: appRow, error: appRowError } = await supabaseAdmin
    .from("apps")
    .select("dna, dna_extraction_source")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (appRowError || !appRow?.dna) {
    throw new InternalError(ErrorMessages.dnaInformation.NOT_FOUND);
  }

  const existingDna = appRow.dna as AppDna;
  const existingSource: DnaExtractionSource = (appRow.dna_extraction_source ?? {}) as DnaExtractionSource;

  // Every field the customer explicitly edits is stamped "manual" so a
  // later Re-analyze (trigger/dna-reextraction.ts) never silently
  // overwrites it — same promise/mechanism as brand_information's PATCH
  // route, kept here on every save regardless of whether the value
  // actually changed (re-saving the same value still means "the customer
  // looked at this and confirmed it").
  const mergedDna: AppDna = { ...existingDna };
  const nextSource: DnaExtractionSource = { ...existingSource };

  for (const name of fieldNames) {
    if (name === "business_model") {
      // `source` is metadata about where the narrative came from
      // (extraction vs. Brand Identity) — once the customer edits it by
      // hand, neither label is accurate anymore, so it's cleared rather
      // than trusting whatever the client sent.
      mergedDna.business_model = { narrative: fields.business_model!.narrative, source: null };
    } else {
      (mergedDna as unknown as Record<string, unknown>)[name] = fields[name];
    }
    nextSource[name] = "manual";
  }

  const { error: updateError } = await supabaseAdmin
    .from("apps")
    .update({ dna: mergedDna, dna_extraction_source: nextSource })
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (updateError) {
    throw new InternalError(ErrorMessages.dnaInformation.UPDATE_FAILED);
  }

  return NextResponse.json({ success: true }, { status: 200 });
});
