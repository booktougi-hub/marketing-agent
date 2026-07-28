import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { supabaseAdmin } from "@/lib/supabase-server";
import { timed } from "@/lib/perf-log";

export interface WorkspaceContext {
  user: { id: string; email: string | null };
  workspaceId: string | null;
}

// React's cache() memoizes by call within a single request/render pass —
// every dashboard layout.tsx and page.tsx used to independently re-run
// auth.getUser() (an Auth-server round trip) plus a workspace_members
// query to get to the exact same workspaceId, meaning a single navigation
// paid for that pair of round trips 2-3x over (once in the layout, again
// in whichever page.tsx rendered inside it). Calling this instead of
// duplicating that logic collapses it back down to one execution per
// request, however many layouts/pages call it.
//
// Middleware's own auth.getUser() call is separate and intentionally not
// covered by this cache: it runs in the Edge runtime before this RSC
// render even starts, so there's nothing to share it with, and it needs
// to stay a real revalidation against the Auth server for the reason
// documented on that call in middleware.ts (getSession() alone can't be
// trusted there).
export const getWorkspaceContext = cache(async (): Promise<WorkspaceContext | null> => {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Server Components can't set cookies; middleware handles refresh.
        },
      },
    }
  );

  const {
    data: { user },
  } = await timed("workspaceContext:getUser", () => supabase.auth.getUser());

  if (!user) return null;

  const { data: membership } = await timed("workspaceContext:workspace_members", () =>
    supabaseAdmin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .single()
  );

  return {
    user: { id: user.id, email: user.email ?? null },
    workspaceId: (membership?.workspace_id as string | undefined) ?? null,
  };
});
