"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleSwitch } from "@/components/ui/toggle-switch";

export function DangerZoneSection({
  appId,
  appName,
  sourceUrl,
  initialIsPaused,
}: {
  appId: string;
  appName: string | null;
  sourceUrl: string;
  initialIsPaused: boolean;
}) {
  const router = useRouter();
  const [isPaused, setIsPaused] = useState(initialIsPaused);
  const [pausing, setPausing] = useState(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmationTarget = appName || sourceUrl;

  async function handleTogglePause(next: boolean) {
    setPausing(true);
    try {
      const res = await fetch(`/api/apps/${appId}/pause`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_paused: next }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error ?? "Failed to update pause state.");
        return;
      }
      setIsPaused(next);
      toast.success(
        next ? "All marketing paused for this app." : "Marketing resumed for this app."
      );
    } catch {
      toast.error("Failed to update pause state.");
    } finally {
      setPausing(false);
    }
  }

  function closeDeleteModal() {
    setDeleteModalOpen(false);
    setConfirmText("");
    setDeleteError(null);
  }

  async function handleConfirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_name: confirmText }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setDeleteError(json?.error ?? "Failed to delete app.");
        return;
      }
      router.push("/dashboard/apps");
    } catch {
      setDeleteError("Failed to delete app.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="border-destructive">
      <CardHeader>
        <CardTitle className="text-destructive">Danger Zone</CardTitle>
        <CardDescription>Irreversible actions that affect this app.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 rounded-md border p-4">
          <div>
            <p className="text-sm font-semibold">Pause All Marketing</p>
            <p className="text-xs text-muted-foreground">
              Stops publishing, research, and outreach for this app until resumed.
            </p>
          </div>
          <ToggleSwitch checked={isPaused} onCheckedChange={handleTogglePause} disabled={pausing} />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 p-4">
          <div>
            <p className="text-sm font-semibold">Delete App</p>
            <p className="text-xs text-muted-foreground">
              Permanently removes this app from your dashboard.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="border-destructive text-destructive hover:bg-destructive/10"
            onClick={() => setDeleteModalOpen(true)}
          >
            Delete App
          </Button>
        </div>
      </CardContent>

      <Dialog
        open={deleteModalOpen}
        onOpenChange={(open) => (open ? setDeleteModalOpen(true) : closeDeleteModal())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirmationTarget}?</DialogTitle>
            <DialogDescription>
              This can&apos;t be undone from the dashboard. Type{" "}
              <strong className="text-foreground">{confirmationTarget}</strong> to confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-delete">App name</Label>
            <Input
              id="confirm-delete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
            {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDeleteModal} disabled={deleting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleting || confirmText !== confirmationTarget}
            >
              {deleting && <Loader2 className="animate-spin" />}
              Delete App
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
