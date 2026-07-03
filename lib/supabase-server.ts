import "server-only";
import { createClient } from "@supabase/supabase-js";

// This module must never be imported from a client component — the
// service role key bypasses RLS entirely. The `server-only` import
// makes any accidental client-side import fail at build time.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Admin client — use this in API routes and Trigger.dev jobs only.
// Bypasses RLS, so every query MUST filter by workspace_id manually.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
