import { createBrowserClient } from "@supabase/auth-helpers-nextjs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Browser client — use this in React components only. Respects RLS.
// Stores the session in cookies (not localStorage) so middleware.ts can
// read it on the server for route protection.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
