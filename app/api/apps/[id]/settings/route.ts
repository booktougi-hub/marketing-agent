import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  DEVTO_FREQUENCIES,
  IGFB_FREQUENCIES,
  LINKEDIN_FREQUENCIES,
  TWITTER_FREQUENCIES,
  TWITTER_HOURS,
  WEEK_DAYS,
} from "@/lib/app-settings";
import { withErrorHandling } from "@/lib/errors/apiHandler";
import { ErrorMessages } from "@/lib/errors/messages";
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError, InternalError } from "@/lib/errors/AppError";
import { RESEARCH_DAYS } from "@/types";

const PRODUCT_TYPES = [
  "developer_tool",
  "mobile_app",
  "web_app",
  "saas",
  "browser_extension",
  "other",
] as const;

// All fields optional/nullable — founder-provided context the
// onboarding-audit agent cannot infer on its own. See SCHEMA.md.
const conversionRetentionSchema = z.object({
  trial_length_days: z.number().min(0).nullable().optional(),
  has_free_tier: z.boolean().nullable().optional(),
  onboarding_step_count: z.number().min(0).nullable().optional(),
  known_signup_conversion_rate: z.number().min(0).max(100).nullable().optional(),
  known_activation_rate: z.number().min(0).max(100).nullable().optional(),
  known_churn_rate: z.number().min(0).max(100).nullable().optional(),
});

const publishingScheduleSchema = z.object({
  twitter: z.object({
    frequency: z.enum(TWITTER_FREQUENCIES),
    hours: z.array(z.enum(TWITTER_HOURS)).min(1, "Select at least one posting hour."),
  }),
  linkedin: z.object({
    frequency: z.enum(LINKEDIN_FREQUENCIES),
    days: z.array(z.enum(WEEK_DAYS)).min(1, "Select at least one posting day."),
  }),
  instagram_facebook: z.object({
    frequency: z.enum(IGFB_FREQUENCIES),
    include_weekends: z.boolean(),
  }),
  devto: z.object({
    frequency: z.enum(DEVTO_FREQUENCIES),
  }),
  timezone: z.string().trim().min(1),
});

// Each settings section saves independently, so every field is optional here
// — only the fields present in a given request get updated.
const patchSchema = z.object({
  name: z.string().trim().min(1, "App name can't be empty.").max(200).optional(),
  product_type: z.enum(PRODUCT_TYPES).optional(),
  additional_context: z.string().trim().max(5000).optional().nullable(),
  publishing_schedule: publishingScheduleSchema.optional(),
  conversion_retention: conversionRetentionSchema.optional(),
  preferred_research_day: z.enum(RESEARCH_DAYS).optional(),
  preferred_research_hour: z.number().int().min(0).max(23).optional(),
});

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
    const parsed = patchSchema.safeParse(json);

    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? ErrorMessages.generic.INVALID_REQUEST_BODY);
    }

    const { data: existing } = await supabaseAdmin
      .from("apps")
      .select("id, app_settings")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!existing) {
      throw new NotFoundError(ErrorMessages.apps.NOT_FOUND);
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) {
      update.name = parsed.data.name;
    }
    if (parsed.data.product_type !== undefined) {
      update.product_type = parsed.data.product_type;
    }
    if (parsed.data.additional_context !== undefined) {
      update.additional_context = parsed.data.additional_context?.trim() || null;
    }
    // Merges onto whatever this request has already staged in `update`
    // (not always `existing.app_settings`) — a request that touches more
    // than one app_settings key (e.g. publishing_schedule AND
    // conversion_retention together) must not have the second block
    // clobber the first with stale pre-request data.
    if (parsed.data.publishing_schedule !== undefined) {
      const currentSettings = (update.app_settings ?? existing.app_settings ?? {}) as Record<
        string,
        unknown
      >;
      update.app_settings = {
        ...currentSettings,
        publishing_schedule: parsed.data.publishing_schedule,
      };
    }
    if (parsed.data.conversion_retention !== undefined) {
      const currentSettings = (update.app_settings ?? existing.app_settings ?? {}) as Record<
        string,
        unknown
      >;
      update.app_settings = {
        ...currentSettings,
        conversion_retention: parsed.data.conversion_retention,
      };
    }
    if (parsed.data.preferred_research_day !== undefined) {
      update.preferred_research_day = parsed.data.preferred_research_day;
    }
    if (parsed.data.preferred_research_hour !== undefined) {
      update.preferred_research_hour = parsed.data.preferred_research_hour;
    }

    if (Object.keys(update).length === 0) {
      throw new ValidationError(ErrorMessages.apps.NO_CHANGES_PROVIDED);
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("apps")
      .update(update)
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (updateError || !updated) {
      throw new InternalError(ErrorMessages.apps.UPDATE_FAILED);
    }

    return NextResponse.json({ app: updated }, { status: 200 });
});
