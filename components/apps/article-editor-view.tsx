"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import remarkGfm from "remark-gfm";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";
import { Button } from "@/components/ui/button";
import { PlatformBadge } from "@/components/apps/content-post-card";
import { getArticleTitle } from "@/lib/markdown";
import type { Content } from "@/types";

// The editor touches `document`/`window` at import time, which breaks SSR —
// load it client-side only.
const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

export function ArticleEditorView({
  appId,
  item,
}: {
  appId: string;
  item: Pick<Content, "id" | "body" | "platform" | "pillar">;
}) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [body, setBody] = useState(item.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = getArticleTitle(body) ?? "Untitled article";

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/content/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const message = json?.error ?? "Failed to save changes.";
        setError(message);
        toast.error(message);
        return;
      }
      toast.success("Article saved");
      router.back();
    } catch {
      setError("Failed to save changes.");
      toast.error("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    router.back();
  }

  return (
    <div
      className="flex flex-col gap-4"
      data-color-mode={resolvedTheme === "dark" ? "dark" : "light"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <PlatformBadge platform={item.platform} />
            {item.pillar && <span className="text-xs text-muted-foreground">{item.pillar}</span>}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-xs text-muted-foreground">
            The title is the first line of the article — edit it there to rename the article.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || body.trim().length === 0}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-hidden rounded-lg border">
        <MDEditor
          value={body}
          onChange={(value) => setBody(value ?? "")}
          height={640}
          preview="live"
          previewOptions={{ remarkPlugins: [remarkGfm] }}
        />
      </div>
    </div>
  );
}
