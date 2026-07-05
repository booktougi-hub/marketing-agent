"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

const COMING_SOON_PLATFORMS = [
  { label: "Twitter / X", description: "Auto-publish posts to your Twitter/X account." },
  { label: "LinkedIn", description: "Auto-publish posts to your LinkedIn page." },
  { label: "Instagram", description: "Auto-publish posts to your Instagram account." },
  { label: "Facebook", description: "Auto-publish posts to your Facebook page." },
  { label: "YouTube", description: "Auto-publish videos to your YouTube channel." },
];

export function ConnectedPlatformsSection({
  appId,
  initialDevtoConnected,
}: {
  appId: string;
  initialDevtoConnected: boolean;
}) {
  const [connected, setConnected] = useState(initialDevtoConnected);
  const [modalOpen, setModalOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  function closeModal() {
    setModalOpen(false);
    setApiKey("");
    setError(null);
  }

  async function handleSaveKey() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/platforms/devto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Failed to connect Dev.to.");
        return;
      }
      setConnected(true);
      closeModal();
    } catch {
      setError("Failed to connect Dev.to.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/apps/${appId}/platforms/devto`, { method: "DELETE" });
      if (res.ok) {
        setConnected(false);
      }
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected Platforms</CardTitle>
        <CardDescription>Manage the social accounts this app publishes to.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-md border p-4">
          <div>
            <p className="text-sm font-semibold">Dev.to</p>
            <p className="text-xs text-muted-foreground">Publish articles to your Dev.to blog.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={connected ? "default" : "outline"}>
              {connected ? "Connected" : "Not Connected"}
            </Badge>
            {connected ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting && <Loader2 className="animate-spin" />}
                Disconnect
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => setModalOpen(true)}>
                Connect
              </Button>
            )}
          </div>
        </div>

        {COMING_SOON_PLATFORMS.map((platform) => (
          <div
            key={platform.label}
            className="flex items-center justify-between gap-3 rounded-md border p-4 opacity-60"
          >
            <div>
              <p className="text-sm font-semibold">{platform.label}</p>
              <p className="text-xs text-muted-foreground">{platform.description}</p>
            </div>
            <Badge variant="secondary">Coming soon</Badge>
          </div>
        ))}
      </CardContent>

      <Dialog open={modalOpen} onOpenChange={(open) => (open ? setModalOpen(true) : closeModal())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Dev.to</DialogTitle>
            <DialogDescription>
              Enter your Dev.to API key to allow publishing articles to your blog.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="devto-api-key">API Key</Label>
            <Input
              id="devto-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">Find at dev.to/settings/account</p>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeModal} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveKey} disabled={saving || !apiKey.trim()}>
              {saving && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
