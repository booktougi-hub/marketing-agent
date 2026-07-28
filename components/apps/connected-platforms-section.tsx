"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  SiFramer,
  SiGithub,
  SiGoogleanalytics,
  SiGooglesearchconsole,
  SiSanity,
  SiTelegram,
  SiWebflow,
  SiWhatsapp,
  SiWordpress,
} from "react-icons/si";
import type { IconType } from "react-icons";
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
import { cn } from "@/lib/utils";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { parseApiError } from "@/lib/errors/parseApiError";
import { PLATFORM_BRAND_COLOR, PLATFORM_BRAND_ICON } from "@/lib/platform";
import type { ContentPlatform } from "@/types";

// TODO(cleanup-before-prod): every card below except Dev.to is a "coming
// soon" placeholder — none of these integrations (WordPress, WordPress
// Self-Hosted, Webflow, Framer, Sanity, GitHub PR publishing, Google
// Analytics, Google Search Console, WhatsApp, Telegram) are in the V1
// checklist (PHASES.md) or have any backing platform_credentials support
// (SCHEMA.md's platform enum doesn't cover them) — per CLAUDE.md rule #4
// ("Never build V2+ features during V1"), only the visual directory is
// built here, not real connect flows. Wire each one up for real only once
// its own credential storage + OAuth/API-key flow actually exists —
// Dev.to's flow below (a workspace-level platform_credentials row) is the
// template to copy.
interface IntegrationDef {
  id: string;
  name: string;
  description: string;
  icon: IconType;
  color: string;
}

const ARTICLE_PUBLISHING_PLATFORMS: IntegrationDef[] = [
  {
    id: "wordpress",
    name: "WordPress",
    description: "Publish articles to WordPress.com",
    icon: SiWordpress,
    color: "#21759B",
  },
  {
    id: "wordpress-self-hosted",
    name: "WordPress (Self-Hosted)",
    description: "Connect via application password",
    icon: SiWordpress,
    color: "#21759B",
  },
  {
    id: "webflow",
    name: "Webflow",
    description: "Publish to Webflow CMS collections",
    icon: SiWebflow,
    color: "#146EF5",
  },
  {
    id: "framer",
    name: "Framer",
    description: "Publish to Framer CMS collections",
    icon: SiFramer,
    color: "#0055FF",
  },
  {
    id: "sanity",
    name: "Sanity",
    description: "Publish articles to your Sanity dataset",
    icon: SiSanity,
    color: "#F03E2F",
  },
];

const SOCIAL_PLATFORMS: { id: ContentPlatform; name: string; description: string }[] = [
  { id: "twitter", name: "X (Twitter)", description: "Post tweets and threads" },
  { id: "linkedin", name: "LinkedIn", description: "Share professional content" },
  { id: "instagram", name: "Instagram", description: "Post to your Instagram account" },
  { id: "facebook", name: "Facebook", description: "Post to your Facebook page" },
  { id: "youtube", name: "YouTube", description: "Publish videos to your channel" },
];

const CODE_REPOSITORY_PLATFORMS: IntegrationDef[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Let the SEO agent open pull requests against your repository.",
    icon: SiGithub,
    color: "#e3e2e2",
  },
];

const ANALYTICS_PLATFORMS: IntegrationDef[] = [
  {
    id: "google-analytics",
    name: "Google Analytics",
    description: "Track website traffic and user behaviour",
    icon: SiGoogleanalytics,
    color: "#E8710A",
  },
  {
    id: "google-search-console",
    name: "Google Search Console",
    description: "Monitor SEO performance and indexing",
    icon: SiGooglesearchconsole,
    color: "#458CF5",
  },
];

const MESSAGING_PLATFORMS: IntegrationDef[] = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Receive daily digests and chat with your AI CMO on WhatsApp",
    icon: SiWhatsapp,
    color: "#25D366",
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Receive daily digests and chat with your AI CMO on Telegram",
    icon: SiTelegram,
    color: "#26A5E4",
  },
];

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span className={cn("size-1.5 shrink-0 rounded-full", connected ? "bg-emerald-500" : "bg-muted-foreground/50")} />
  );
}

function IntegrationCard({
  icon: Icon,
  color,
  name,
  description,
  connected,
  comingSoon,
  connecting,
  disconnecting,
  onConnect,
  onDisconnect,
}: {
  icon: IconType;
  color: string;
  name: string;
  description: string;
  connected: boolean;
  comingSoon: boolean;
  connecting?: boolean;
  disconnecting?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-lg"
            style={{
              backgroundColor: `color-mix(in oklch, ${color} 16%, transparent)`,
              color,
            }}
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{name}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot connected={connected} />
            {comingSoon ? "Coming soon" : connected ? "Connected" : "Not connected"}
          </span>

          {comingSoon ? (
            <Button type="button" variant="outline" size="sm" disabled>
              Connect
            </Button>
          ) : connected ? (
            <Button type="button" variant="outline" size="sm" onClick={onDisconnect} disabled={disconnecting}>
              {disconnecting && <Loader2 className="animate-spin" />}
              Disconnect
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={onConnect} disabled={connecting}>
              {connecting && <Loader2 className="animate-spin" />}
              Connect
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function IntegrationGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

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
      if (!res.ok) {
        const { message } = await parseApiError(res);
        setError(message);
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
        <CardDescription>Manage every integration this app publishes to or reads from.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-8">
        <IntegrationGroup
          title="Article Publishing"
          description="Publish articles directly to your CMS or blog platform"
        >
          <IntegrationCard
            icon={PLATFORM_BRAND_ICON.devto!}
            color={PLATFORM_BRAND_COLOR.devto!}
            name="Dev.to"
            description="Publish articles to your Dev.to blog."
            connected={connected}
            comingSoon={false}
            onConnect={() => setModalOpen(true)}
            onDisconnect={handleDisconnect}
            disconnecting={disconnecting}
          />
          {ARTICLE_PUBLISHING_PLATFORMS.map((platform) => (
            <IntegrationCard
              key={platform.id}
              icon={platform.icon}
              color={platform.color}
              name={platform.name}
              description={platform.description}
              connected={false}
              comingSoon
            />
          ))}
        </IntegrationGroup>

        <IntegrationGroup title="Socials" description="Connect your social accounts to post and share content">
          {SOCIAL_PLATFORMS.map((platform) => (
            <IntegrationCard
              key={platform.id}
              icon={PLATFORM_BRAND_ICON[platform.id]!}
              color={PLATFORM_BRAND_COLOR[platform.id]!}
              name={platform.name}
              description={platform.description}
              connected={false}
              comingSoon
            />
          ))}
        </IntegrationGroup>

        <IntegrationGroup
          title="Code Repository"
          description="Connect a GitHub repo so the SEO agent can open pull requests against it"
        >
          {CODE_REPOSITORY_PLATFORMS.map((platform) => (
            <IntegrationCard
              key={platform.id}
              icon={platform.icon}
              color={platform.color}
              name={platform.name}
              description={platform.description}
              connected={false}
              comingSoon
            />
          ))}
        </IntegrationGroup>

        <IntegrationGroup
          title="Analytics"
          description="Connect analytics tools to track performance. Disconnecting will remove the connector and all collected data."
        >
          {ANALYTICS_PLATFORMS.map((platform) => (
            <IntegrationCard
              key={platform.id}
              icon={platform.icon}
              color={platform.color}
              name={platform.name}
              description={platform.description}
              connected={false}
              comingSoon
            />
          ))}
        </IntegrationGroup>

        <IntegrationGroup title="Messaging" description="Chat with your AI CMO directly from your phone">
          {MESSAGING_PLATFORMS.map((platform) => (
            <IntegrationCard
              key={platform.id}
              icon={platform.icon}
              color={platform.color}
              name={platform.name}
              description={platform.description}
              connected={false}
              comingSoon
            />
          ))}
        </IntegrationGroup>
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
            {error && <ErrorMessage message={error} />}
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
