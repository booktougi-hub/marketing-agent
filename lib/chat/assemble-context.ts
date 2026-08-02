import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { AppDna } from "@/types";

// Lean, per-app "identity" summary for the chat system prompt — name,
// one-liner, category only. Deliberately excludes findings, content
// history, credit balances, or anything that changes daily: that content
// belongs behind a read-only tool (get_seo_geo_status, get_credit_balance,
// ...) so it's fetched only when the model actually asks for it, instead of
// bloating and invalidating the cached prefix on every turn. See
// lib/chat/tools.ts.
export async function assembleIdentityBlock(appId: string, workspaceId: string): Promise<string> {
  const [{ data: app }, { data: brand }] = await Promise.all([
    supabaseAdmin
      .from("apps")
      .select("name, dna, product_type")
      .eq("id", appId)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    supabaseAdmin
      .from("brand_information")
      .select("brand_name, one_liner, category")
      .eq("app_id", appId)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);

  const dna = (app?.dna ?? null) as AppDna | null;

  // brand_information is the founder-confirmed source of truth when it
  // exists; apps.dna (auto-populated on every app, even before brand
  // extraction has run) is the fallback.
  const name = brand?.brand_name || app?.name || "this app";
  const oneLiner = brand?.one_liner || dna?.tagline || null;
  const category = brand?.category || app?.product_type || null;

  const lines = [`App: ${name}`];
  if (oneLiner) lines.push(`One-liner: ${oneLiner}`);
  if (category) lines.push(`Category: ${category}`);

  return lines.join("\n");
}
