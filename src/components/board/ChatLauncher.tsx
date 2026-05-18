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
import { MessageSquare, Save, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  listChatMessages,
  sendChatMessage,
} from "@/app/board/chat-actions";
import { commitToMemory } from "@/app/board/memories";
import type { ChatMessage } from "@/lib/supabase/types";

export function ChatLauncher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [sending, startSending] = useTransition();
  const [savingId, startSaving] = useTransition();
  const [pendingSaveId, setPendingSaveId] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const initial = await listChatMessages();
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
  }, [open, loaded]);

  useEffect(() => {
    if (!open) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    setInput("");
    startSending(async () => {
      try {
        const { userMessage, assistantMessage, toolActions } =
          await sendChatMessage(trimmed);
        setMessages((prev) => [...prev, userMessage, assistantMessage]);
        if (toolActions.length > 0) {
          for (const action of toolActions) {
            const title =
              typeof action.result?.title === "string"
                ? action.result.title
                : "task";
            switch (action.name) {
              case "createTask":
                toast.success(`Created: ${title}`);
                break;
              case "moveTask": {
                const status =
                  typeof action.result?.status === "string"
                    ? action.result.status
                    : "another column";
                toast.success(`Moved "${title}" → ${status}`);
                break;
              }
              case "updateTask":
                toast.success(`Updated: ${title}`);
                break;
              case "deleteTask":
                toast.success(`Deleted: ${title}`);
                break;
            }
          }
          // Pull the server-rendered board so the new tasks appear without
          // a manual refresh.
          router.refresh();
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Send failed",
        );
        setInput(trimmed);
      }
    });
  }, [input, sending, router]);

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleRemember(message: ChatMessage) {
    if (savingId) return;
    setPendingSaveId(message.id);
    startSaving(async () => {
      try {
        await commitToMemory(message.content, ["from-chat"]);
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
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label="Open chat"
      >
        <MessageSquare />
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/20"
            onClick={() => setOpen(false)}
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
                onClick={() => setOpen(false)}
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
                  your board, today&apos;s calendar, and the last 48h of email.
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
              {sending ? (
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
                disabled={sending}
              />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                >
                  <Send />
                  <span>Send</span>
                </Button>
              </div>
            </footer>
          </aside>
        </div>
      ) : null}
    </>
  );
}

type MessageBubbleProps = {
  message: ChatMessage;
  onRemember: (m: ChatMessage) => void;
  saving: boolean;
};

function MessageBubble({ message, onRemember, saving }: MessageBubbleProps) {
  const isUser = message.role === "user";
  return (
    <div
      className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
    >
      <div
        className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        {message.content}
      </div>
      {isUser ? (
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
