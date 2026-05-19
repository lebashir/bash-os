"use client";

import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { Loader2, Mic, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { createTask } from "@/app/board/actions";
import { resolveInboxColumn } from "@/app/board/command-actions";

interface CommandBarProps {
  initialMessages: UIMessage[];
}

const CAPTURE_PREFIXES = ["task:", "add:", "capture:", "todo:"];

function detectCapturePrefix(text: string): string | null {
  const lower = text.toLowerCase();
  for (const p of CAPTURE_PREFIXES) {
    if (lower.startsWith(p)) {
      return text.slice(p.length).trim();
    }
  }
  return null;
}

export function CommandBar({ initialMessages }: CommandBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [captureBusy, startCapture] = useTransition();

  const { messages, sendMessage, status, setMessages, stop } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest({ messages }) {
        // Backend only wants the latest user turn; history lives in Supabase.
        const last = messages[messages.length - 1];
        return { body: { message: last } };
      },
    }),
    onError: (err) => {
      toast.error(err.message);
    },
  });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const isMac =
        typeof navigator !== "undefined" &&
        /Mac/.test(navigator.platform ?? "");
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && popoverOpen) {
        setPopoverOpen(false);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [popoverOpen]);

  useEffect(() => {
    if (!popoverOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [popoverOpen]);

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");

    const captureTitle = detectCapturePrefix(value);
    if (captureTitle !== null) {
      if (!captureTitle) {
        toast.error("nothing to capture");
        return;
      }
      startCapture(async () => {
        try {
          const inboxId = await resolveInboxColumn();
          if (!inboxId) {
            toast.error("no inbox column");
            return;
          }
          await createTask({
            title: captureTitle,
            column_id: inboxId,
            owner: "bash",
          });
          toast.success(`captured: ${captureTitle.slice(0, 60)}`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "capture failed");
        }
      });
      return;
    }

    setPopoverOpen(true);
    sendMessage({ text: value });
  }

  function handleClear() {
    setMessages([]);
    setPopoverOpen(false);
  }

  const streaming = status === "streaming" || status === "submitted";
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");

  return (
    <div className="relative shrink-0">
      {popoverOpen && messages.length > 0 && (
        <div
          ref={popoverRef}
          className="absolute bottom-full left-3 right-3 mb-2 max-w-[480px] max-h-[50vh] overflow-y-auto rounded-[4px] border border-[var(--bash-border)] bg-[var(--bash-panel)] shadow-lg z-40 flex flex-col"
        >
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--bash-border-subtle)]">
            <span className="text-[10px] text-[var(--bash-text-muted)]">
              chat
            </span>
            <div className="flex items-center gap-1">
              {streaming && (
                <button
                  type="button"
                  onClick={stop}
                  className="text-[10px] text-[var(--bash-text-muted)] hover:text-[var(--bash-text)] px-1.5"
                >
                  stop
                </button>
              )}
              <button
                type="button"
                onClick={handleClear}
                className="text-[var(--bash-text-muted)] hover:text-[var(--bash-text)] p-1"
                aria-label="clear chat"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2 p-3">
            {messages.slice(-8).map((m) => (
              <div
                key={m.id}
                className={`text-[11px] leading-[1.4] ${
                  m.role === "assistant"
                    ? "text-[var(--bash-text)]"
                    : "text-[var(--bash-text-muted)]"
                }`}
              >
                <div className="text-[9px] text-[var(--bash-text-dim)] mb-0.5">
                  {m.role}
                </div>
                <div className="whitespace-pre-wrap">
                  {m.parts
                    .filter((p): p is { type: "text"; text: string } =>
                      p.type === "text",
                    )
                    .map((p) => p.text)
                    .join("")}
                </div>
              </div>
            ))}
            {streaming && !lastAssistant && (
              <div className="flex items-center gap-2 text-[10px] text-[var(--bash-text-dim)]">
                <Loader2 className="w-3 h-3 animate-spin" />
                thinking…
              </div>
            )}
          </div>
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="h-10 border-t border-[var(--bash-border-subtle)] bg-[var(--bash-panel)] flex items-center px-3 gap-2"
      >
        <button
          type="button"
          onClick={() => inputRef.current?.focus()}
          className="px-1.5 py-0.5 text-[10px] text-[var(--bash-text-muted)] border border-[var(--bash-border-subtle)] rounded-[3px] font-mono shrink-0 hover:border-[var(--bash-border)]"
          aria-label="focus command bar"
        >
          ⌘K
        </button>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="type a command, ask the agent, or paste to capture"
          className="flex-1 bg-transparent text-[12px] outline-none text-[var(--bash-text)] placeholder:text-[var(--bash-text-dim)]"
          disabled={captureBusy}
        />
        {captureBusy && (
          <Loader2 className="w-3 h-3 animate-spin text-[var(--bash-text-muted)]" />
        )}
        <button
          type="button"
          className="text-[var(--bash-text-dim)] hover:text-[var(--bash-text-muted)]"
          aria-label="voice (coming soon)"
          disabled
        >
          <Mic className="w-3 h-3" />
        </button>
      </form>
    </div>
  );
}
