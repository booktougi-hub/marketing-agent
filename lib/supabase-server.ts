import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import WebSocket from "ws";

// This module must never be imported from a client component — the
// service role key bypasses RLS entirely. The `server-only` import
// makes any accidental client-side import fail at build time.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Admin client — use this in API routes and Trigger.dev jobs only.
// Bypasses RLS, so every query MUST filter by workspace_id manually.
//
// createClient() eagerly constructs a Realtime client even though we
// never use realtime here. Under Node 20 (no native WebSocket in the
// Trigger.dev build worker) that constructor throws unless a transport
// is supplied explicitly — hence the `ws` package below.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    // `ws`'s constructor overloads don't structurally match
    // WebSocketLikeConstructor (it has an extra `address: null` overload
    // for server-mode sockets we never use) — the runtime shape is
    // compatible, so this cast is safe.
    transport: WebSocket as unknown as WebSocketLikeConstructor,
  },
});
