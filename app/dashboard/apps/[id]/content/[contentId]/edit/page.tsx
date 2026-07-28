import { notFound, redirect } from "next/navigation";
import { ArticleEditorView } from "@/components/apps/article-editor-view";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getWorkspaceContext } from "@/lib/workspace-context";

export default async function ContentEditPage({
  params,
}: {
  params: Promise<{ id: string; contentId: string }>;
}) {
  const { id, contentId } = await params;

  const context = await getWorkspaceContext();
  if (!context) {
    redirect("/auth/login");
  }

  const { workspaceId } = context;

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
