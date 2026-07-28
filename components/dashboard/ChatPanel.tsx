"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageCircle, PanelRightClose, Send, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AuditFindingCard } from "@/components/apps/audit-finding-card";
import { useDashboardApp } from "@/components/dashboard/AppContext";
import { parseApiError } from "@/lib/errors/parseApiError";
import type { ChatMessage, ChatMessageRole } from "@/types";

const EXPANDED_STORAGE_KEY = "agentmark-chat-expanded";
const WIDTH_STORAGE_KEY = "agentmark-chat-width";
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;
const MAX_WIDTH = 640;

function ChatBubble({ role, children }: { role: ChatMessageRole; children: string }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-snug whitespace-pre-wrap",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        )}
      >
        {children}
      </div>
    </div>
  );
}

function ChatMessageRow({
  message,
  onDecision,
}: {
  message: ChatMessage;
  onDecision: (messageId: string, decision: "fixed" | "not_applicable") => Promise<void>;
}) {
  if (message.kind === "confirm_action" && message.confirmAction) {
    const action = message.confirmAction;
    return (
      <div className="flex flex-col gap-2">
        <ChatBubble role="assistant">{message.content}</ChatBubble>
        <AuditFindingCard
          findingType={action.label}
          severity={action.severity}
          issueDescription={action.description}
          suggestedFix={action.effect}
          status={action.status}
          confirmLabel="Confirm"
          declineLabel="Dismiss"
          statusLabels={{ fixed: "Confirmed", not_applicable: "Dismissed" }}
          hideFeedback
          onMarkFixed={() => onDecision(message.id, "fixed")}
          onMarkNotApplicable={() => onDecision(message.id, "not_applicable")}
          onSubmitFeedback={async () => {}}
        />
      </div>
    );
  }

  return <ChatBubble role={message.role}>{message.content}</ChatBubble>;
}

// Mounted independently at each breakpoint's overlay site (see ChatPanel
// below) so every instance gets its own scroll ref / auto-scroll effect —
// sharing one ref across multiple simultaneously-mounted copies would only
// ever scroll the last one rendered.
function ChatPanelBody({
  messages,
  sending,
  loadingHistory,
  input,
  onInputChange,
  onSend,
  onClear,
  onCollapse,
  onDecision,
  collapseIcon,
  collapseLabel,
}: {
  messages: ChatMessage[];
  sending: boolean;
  loadingHistory: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClear: () => void;
  onCollapse: () => void;
  onDecision: (messageId: string, decision: "fixed" | "not_applicable") => Promise<void>;
  collapseIcon: React.ReactNode;
  collapseLabel: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-3">
        <p className="font-heading text-sm font-semibold tracking-tight">Ask AgentMark</p>
        <div className="flex items-center gap-1">
          {messages.length > 0 && !loadingHistory && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={onClear}
                    aria-label="Clear conversation"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  />
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Clear conversation</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={onCollapse}
                  aria-label={collapseLabel}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                />
              }
            >
              {collapseIcon}
            </TooltipTrigger>
            <TooltipContent side="bottom">{collapseLabel}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {loadingHistory ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <MessageCircle className="h-5 w-5" />
            </span>
            <p className="text-sm text-muted-foreground">
              Ask about your strategy, content, or research — or ask the agent to run something for
              you.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((message) => (
              <ChatMessageRow key={message.id} message={message} onDecision={onDecision} />
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Thinking...
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question or tell the agent what to do..."
            rows={1}
            className="max-h-32 flex-1"
            disabled={sending || loadingHistory}
          />
          <Button
            type="button"
            size="icon"
            aria-label="Send message"
            onClick={onSend}
            disabled={sending || loadingHistory || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// Layout-level, persistent chat panel — mounted once in DashboardShell (see
// AppSidebar for the equivalent left-nav pattern this mirrors) so its
// conversation state survives route changes across the whole dashboard.
// Collapsed/expanded is a plain localStorage-backed two-state toggle. Width
// is drag-resizable, but only at xl+ (see the resize handle below) — that's
// the only breakpoint where this panel is a reflowed flex sibling rather
// than a fixed overlay, so it's the only one where "wider panel, narrower
// content" is a sensible interaction.
export function ChatPanel() {
  const { selectedAppId } = useDashboardApp();
  const [expanded, setExpanded] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setExpanded(window.localStorage.getItem(EXPANDED_STORAGE_KEY) === "1");
    const storedWidth = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
    if (storedWidth >= MIN_WIDTH && storedWidth <= MAX_WIDTH) {
      setWidth(storedWidth);
    }
    setHydrated(true);
  }, []);

  // Drag session lives entirely in this closure's variables (startX,
  // startWidth, latestWidth) rather than component state — window listeners
  // are attached/torn down per-drag so there's nothing to clean up on
  // unmount, and `latestWidth` avoids reading stale state in
  // handlePointerUp (the `width` state var is only current as of the render
  // that started the drag).
  function handleResizeStart(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    let latestWidth = startWidth;
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(moveEvent: PointerEvent) {
      // Handle sits on the panel's left edge; dragging left (negative dx)
      // widens the panel since it's anchored to the right side.
      const dx = moveEvent.clientX - startX;
      latestWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth - dx));
      setWidth(latestWidth);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      setResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(latestWidth));
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  // Re-hydrates from the database on every app switch AND on initial
  // mount/refresh — this component is mounted once at the dashboard-shell
  // level (see the comment on ChatPanel below), so it never gets a fresh
  // per-app initial state for free from routing alone. Messages are cleared
  // immediately (not just on fetch success) so the previous app's
  // conversation is never left on screen while the new one loads or if the
  // fetch fails.
  useEffect(() => {
    let cancelled = false;
    setMessages([]);

    if (!selectedAppId) {
      setLoadingHistory(false);
      return;
    }

    setLoadingHistory(true);

    fetch(`/api/chat?appId=${selectedAppId}`)
      .then(async (res) => {
        if (!res.ok) {
          const { message } = await parseApiError(res);
          throw new Error(message);
        }
        return (await res.json()) as { conversationId: string; messages: ChatMessage[] };
      })
      .then((json) => {
        if (cancelled) return;
        setMessages(json.messages);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        toast.error(err.message || "Failed to load conversation history.");
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAppId]);

  function setExpandedPersisted(next: boolean) {
    setExpanded(next);
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, next ? "1" : "0");
  }

  function handleClear() {
    setMessages([]);
  }

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      kind: "text",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, appId: selectedAppId }),
      });
      const json = (await res.json().catch(() => null)) as
        | { message: ChatMessage }
        | { error?: string }
        | null;
      if (!res.ok || !json || !("message" in json)) {
        toast.error((json as { error?: string } | null)?.error ?? "Failed to send your message.");
        return;
      }
      setMessages((prev) => [...prev, json.message]);
    } catch {
      toast.error("Failed to send your message.");
    } finally {
      setSending(false);
    }
  }

  async function handleDecision(messageId: string, decision: "fixed" | "not_applicable") {
    const target = messages.find((m) => m.id === messageId);
    const actionId = target?.confirmAction?.actionId;
    if (!actionId) return;

    try {
      const res = await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId,
          decision: decision === "fixed" ? "confirm" : "decline",
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { success: true; trackingId?: string | null }
        | { error?: string }
        | null;
      if (!res.ok || !json || !("success" in json)) {
        toast.error((json as { error?: string } | null)?.error ?? "Failed to update this action.");
        return;
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.confirmAction
            ? { ...m, confirmAction: { ...m.confirmAction, status: decision } }
            : m
        )
      );
      toast.success(decision === "fixed" ? "Action confirmed" : "Action dismissed");
    } catch {
      toast.error("Failed to update this action.");
    }
  }

  const bodyProps = {
    messages,
    sending,
    loadingHistory,
    input,
    onInputChange: setInput,
    onSend: () => void handleSend(),
    onClear: handleClear,
    onDecision: handleDecision,
  };

  return (
    <>
      {/* Desktop / tablet rail — a flex sibling in DashboardShell's row
          (not position:fixed), same architecture as AppSidebar's own
          collapsed/expanded width toggle, mirrored on the right edge. */}
      <div
        style={{ "--chat-width": `${width}px` } as React.CSSProperties}
        className={cn(
          "hidden h-full shrink-0 flex-col border-l bg-sidebar md:flex",
          hydrated && !resizing && "transition-[width] duration-200 ease-out",
          expanded ? "w-14 xl:w-[var(--chat-width)]" : "w-14"
        )}
      >
        {expanded ? (
          // Below xl there isn't room to reflow, so this same box becomes a
          // fixed overlay instead of participating in the flex row's width;
          // at xl+ it goes relative (not static) and fills the --chat-width
          // slot above, which is the actual reflow. It has to stay a
          // positioned element (relative, not static) at xl+ too, or the
          // resize handle below — which is absolutely positioned against
          // this box — would escape to the nearest positioned ancestor up
          // the tree instead of anchoring to this panel's edge.
          <div
            className={cn(
              "fixed inset-y-0 right-0 z-50 flex h-full w-[360px] max-w-[90vw] flex-col border-l bg-sidebar shadow-xl",
              "xl:relative xl:z-auto xl:h-full xl:w-full xl:max-w-none xl:border-l-0 xl:shadow-none"
            )}
          >
            {/* Resize handle — xl+ only, since below xl this panel is a
                fixed overlay rather than a reflowed sibling (see comment
                above). */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat panel"
              onPointerDown={handleResizeStart}
              className={cn(
                "absolute inset-y-0 left-0 z-10 hidden w-1.5 -translate-x-1/2 cursor-col-resize touch-none xl:block",
                resizing ? "bg-primary/40" : "hover:bg-primary/30"
              )}
            />
            <ChatPanelBody
              {...bodyProps}
              onCollapse={() => setExpandedPersisted(false)}
              collapseIcon={<PanelRightClose className="h-3.5 w-3.5" />}
              collapseLabel="Collapse"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 p-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => setExpandedPersisted(true)}
                    aria-label="Open chat"
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  />
                }
              >
                <MessageCircle className="h-5 w-5" />
              </TooltipTrigger>
              <TooltipContent side="left">Chat with your agent</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Tablet / narrow-desktop scrim (md up to xl only) — closes the
          overlay panel above on click. Desktop reflow needs no scrim since
          nothing is covered; mobile uses its own full-screen sheet below. */}
      {expanded && (
        <button
          type="button"
          aria-label="Close chat"
          onClick={() => setExpandedPersisted(false)}
          className="fixed inset-0 z-40 hidden bg-black/40 md:block xl:hidden"
        />
      )}

      {/* Mobile floating action button — sits above MobileBottomNav (h-16)
          so the two never collide. */}
      <button
        type="button"
        aria-label="Open chat"
        onClick={() => setExpandedPersisted(true)}
        className={cn(
          "fixed right-4 bottom-20 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 md:hidden",
          expanded && "hidden"
        )}
      >
        <MessageCircle className="h-5 w-5" />
      </button>

      {/* Mobile full-screen sheet. */}
      {expanded && (
        <div className="fixed inset-0 z-50 flex flex-col bg-card md:hidden">
          <ChatPanelBody
            {...bodyProps}
            onCollapse={() => setExpandedPersisted(false)}
            collapseIcon={<X className="h-3.5 w-3.5" />}
            collapseLabel="Close"
          />
        </div>
      )}
    </>
  );
}
