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

const PRODUCT_TYPES = [
  "developer_tool",
  "mobile_app",
  "web_app",
  "saas",
  "browser_extension",
  "other",
] as const;

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
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHENTICATED" },
        { status: 401 }
      );
    }

    const { data: membership } = await supabaseAdmin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .single();

    const workspaceId = membership?.workspace_id as string | undefined;

    if (!workspaceId) {
      return NextResponse.json(
        { error: "No workspace found for this account.", code: "NO_WORKSPACE" },
        { status: 403 }
      );
    }

    const json = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid request body.",
          code: "VALIDATION_ERROR",
        },
        { status: 422 }
      );
    }

    const { data: existing } = await supabaseAdmin
      .from("apps")
      .select("id, app_settings")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: "App not found.", code: "NOT_FOUND" },
        { status: 404 }
      );
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
    if (parsed.data.publishing_schedule !== undefined) {
      const currentSettings = (existing.app_settings ?? {}) as Record<string, unknown>;
      update.app_settings = {
        ...currentSettings,
        publishing_schedule: parsed.data.publishing_schedule,
      };
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "No changes provided.", code: "VALIDATION_ERROR" },
        { status: 422 }
      );
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("apps")
      .update(update)
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "Failed to save changes.", code: "SERVER_ERROR" },
        { status: 500 }
      );
    }

    return NextResponse.json({ app: updated }, { status: 200 });
  } catch (error) {
    console.error("PATCH /api/apps/[id]/settings error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
