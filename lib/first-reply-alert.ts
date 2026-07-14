import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";

// PHASES.md Notes Log (2026-07-14): the Telegram bot itself is V2 scope and
// not built yet — `telegraf` is an installed dependency (package.json) but
// nothing in this codebase constructs a bot client, and TELEGRAM_BOT_TOKEN
// is still a blank placeholder in .env.local. This function is the
// documented trigger-condition check the spec asked for; call it from
// wherever `email_interactions.replied_at` actually gets written once that
// exists (there is currently NO such call site in this codebase — the only
// place that reads `replied_at` is the "mark as actioned" toggle in
// app/api/apps/[id]/replies/[interactionId]/route.ts, which never writes
// it; setting it for real requires the Instantly.ai reply webhook, which is
// part of the V3 cold-email pipeline this pull-forward explicitly did NOT
// include).
//
// Call this immediately after the write that sets
// email_interactions.replied_at, passing the id of the row that was just
// written.
export async function checkAndSendFirstReplyAlert({
  appId,
  workspaceId,
  interactionId,
  prospectId,
}: {
  appId: string;
  workspaceId: string;
  interactionId: string;
  prospectId: string;
}): Promise<void> {
  const { count, error } = await supabaseAdmin
    .from("email_interactions")
    .select("id", { count: "exact", head: true })
    .eq("app_id", appId)
    .eq("workspace_id", workspaceId)
    .not("replied_at", "is", null)
    .neq("id", interactionId);

  if (error) {
    console.error("[first-reply-alert] failed to check prior replies:", error.message);
    return;
  }

  const isFirstReply = (count ?? 0) === 0;
  if (!isFirstReply) return;

  const [{ data: prospect }, { data: app }] = await Promise.all([
    supabaseAdmin
      .from("cold_email_prospects")
      .select("first_name, last_name, company")
      .eq("id", prospectId)
      .eq("workspace_id", workspaceId)
      .single(),
    supabaseAdmin.from("apps").select("name, source_url").eq("id", appId).eq("workspace_id", workspaceId).single(),
  ]);

  const prospectName = [prospect?.first_name, prospect?.last_name].filter(Boolean).join(" ") || "A prospect";
  const company = prospect?.company ?? "their company";
  const appName = app?.name ?? app?.source_url ?? "your app";

  const message = `🎉 ${prospectName} at ${company} just replied to your outreach for ${appName}. This is your first reply — go check it out.`;

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log(
      `[TODO first-reply-alert] Would send Telegram message (bot not configured — TELEGRAM_BOT_TOKEN is a blank placeholder, and no bot client exists yet, see PHASES.md V2 scope): "${message}"`
    );
    return;
  }

  // Bot token present but no bot client is wired up anywhere in this
  // codebase yet — still a TODO rather than a real send, since building
  // that client is the actual V2 Telegram bot work this function
  // intentionally doesn't include.
  console.log(`[TODO first-reply-alert] TELEGRAM_BOT_TOKEN is set but no bot client exists yet: "${message}"`);
}
