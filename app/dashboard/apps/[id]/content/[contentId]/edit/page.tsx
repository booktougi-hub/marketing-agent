import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { ArticleEditorView } from "@/components/apps/article-editor-view";
import { supabaseAdmin } from "@/lib/supabase-server";

export default async function ContentEditPage({
  params,
}: {
  params: Promise<{ id: string; contentId: string }>;
}) {
  const { id, contentId } = await params;

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
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: membership } = await supabaseAdmin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  const workspaceId = membership?.workspace_id as string | undefined;

  if (!workspaceId) {
    notFound();
  }

  const { data: item } = await supabaseAdmin
    .from("content")
    .select("id, body, platform, pillar, app_id")
    .eq("id", contentId)
    .eq("app_id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!item) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <ArticleEditorView appId={id} item={item} />
    </div>
  );
}
