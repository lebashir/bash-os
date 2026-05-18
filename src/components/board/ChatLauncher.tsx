"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { MessageSquare, Save, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listChatUIMessages } from "@/app/board/chat-actions";
import { commitToMemory } from "@/app/board/memories";

const TOOL_PART_TYPES = [
  "tool-createTask",
  "tool-moveTask",
  "tool-updateTask",
  "tool-deleteTask",
] as const;
type ToolPartType = (typeof TOOL_PART_TYPES)[number];

export function ChatLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label="Open chat"
      >
        <MessageSquare />
      </Button>
      {open ? <ChatDrawer onClose={() => setOpen(false)} /> : null}
    </>
  );
}

type ChatDrawerProps = { onClose: () => void };

function ChatDrawer({ onClose }: ChatDrawerProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [savingId, startSaving] = useTransition();
  const [pendingSaveId, setPendingSaveId] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, setMessages, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // Server uses chat_messages in Supabase as history; only the new turn
      // needs to be sent on the wire.
      prepareSendMessagesRequest: ({ messages }) => ({
        body: { message: messages[messages.length - 1] },
      }),
    }),
    onFinish: ({ message }) => {
      const toolToasts = collectToolToasts(message);
      if (toolToasts.length > 0) {
        for (const t of toolToasts) toast.success(t);
        router.refresh();
      }
    },
    onError: (err) => {
      toast.error(err.message || "Chat failed");
    },
  });

  // Hydrate prior messages once when the drawer opens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const initial = await listChatUIMessages();
        if (!cancelled) {
          setMessages(initial);
          setLoaded(true);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to load chat",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setMessages]);

  // Pin to bottom as new content streams in.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const isStreaming = status === "submitted" || status === "streaming";

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    sendMessage({ text: trimmed });
  }, [input, isStreaming, sendMessage]);

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleRemember(message: UIMessage) {
    if (savingId) return;
    const text = extractText(message);
    if (!text) return;
    setPendingSaveId(message.id);
    startSaving(async () => {
      try {
        await commitToMemory(text, ["from-chat"]);
        toast.success("Saved to memory");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Save failed",
        );
      } finally {
        setPendingSaveId(null);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
        aria-label="Close chat"
      />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l bg-background shadow-2xl">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Bash OS chat</span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X />
          </Button>
        </header>
        <div
          ref={scrollerRef}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
        >
          {!loaded ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Start a conversation. The assistant has read-only context on
              your board, today&apos;s calendar, the last 48h of email, and
              memories you&apos;ve saved.
            </p>
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onRemember={handleRemember}
                saving={pendingSaveId === m.id}
              />
            ))
          )}
          {isStreaming && lastIsUser(messages) ? (
            <p className="text-xs text-muted-foreground">Thinking…</p>
          ) : null}
        </div>
        <footer className="border-t p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask, draft, plan… Enter to send, Shift+Enter for newline."
            rows={3}
            className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50"
            disabled={isStreaming}
          />
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
            >
              <Send />
              <span>Send</span>
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

type MessageBubbleProps = {
  message: UIMessage;
  onRemember: (m: UIMessage) => void;
  saving: boolean;
};

function MessageBubble({ message, onRemember, saving }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const text = extractText(message);
  if (!text && message.parts.length === 0) return null;
  return (
    <div
      className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
    >
      {text ? (
        <div
          className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          }`}
        >
          {text}
        </div>
      ) : null}
      {isUser && text ? (
        <button
          type="button"
          onClick={() => onRemember(message)}
          disabled={saving}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <Save className="size-3" />
          {saving ? "Saving…" : "Remember"}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
}

function lastIsUser(messages: UIMessage[]): boolean {
  return messages[messages.length - 1]?.role === "user";
}

function collectToolToasts(message: UIMessage): string[] {
  const toasts: string[] = [];
  for (const part of message.parts) {
    if (!isToolUIPart(part)) continue;
    if (part.state !== "output-available") continue;
    if (!isKnownToolPart(part.type)) continue;
    const output = part.output as Record<string, unknown> | null | undefined;
    const title =
      typeof output?.title === "string" ? output.title : "task";
    switch (part.type) {
      case "tool-createTask":
        toasts.push(`Created: ${title}`);
        break;
      case "tool-moveTask": {
        const status =
          typeof output?.status === "string" ? output.status : "another column";
        toasts.push(`Moved "${title}" → ${status}`);
        break;
      }
      case "tool-updateTask":
        toasts.push(`Updated: ${title}`);
        break;
      case "tool-deleteTask":
        toasts.push(`Deleted: ${title}`);
        break;
    }
  }
  return toasts;
}

function isKnownToolPart(type: string): type is ToolPartType {
  return (TOOL_PART_TYPES as readonly string[]).includes(type);
}
