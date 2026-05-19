"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ExternalLink, MailOpen, Plus, Trash2, X, Clock } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  dismissPendingEmail,
  listPendingEmails,
  promotePendingEmailToTask,
  snoozePendingEmail,
} from "@/app/board/triage-actions";
import type { PendingEmail } from "@/lib/supabase/types";

interface TriageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SNOOZE_HOURS = 24;

export function TriageModal({ open, onOpenChange }: TriageModalProps) {
  const [emails, setEmails] = useState<PendingEmail[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listPendingEmails()
      .then((rows) => {
        setEmails(rows);
        setActiveIndex(0);
      })
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      const active = emails[activeIndex];
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, emails.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (active) {
        if (e.key.toLowerCase() === "t") handlePromote(active);
        else if (e.key.toLowerCase() === "d") handleDismiss(active);
        else if (e.key.toLowerCase() === "o") openInGmail(active);
        else if (e.key.toLowerCase() === "s") handleSnooze(active);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, emails, activeIndex]);

  useEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function withRemoval(id: string, label: string, op: () => Promise<void>) {
    startTransition(async () => {
      try {
        await op();
        setEmails((prev) => prev.filter((e) => e.id !== id));
        setActiveIndex((i) => Math.min(i, Math.max(0, emails.length - 2)));
        toast.success(label);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "action failed");
      }
    });
  }

  function handlePromote(email: PendingEmail) {
    withRemoval(email.id, "made task", () =>
      promotePendingEmailToTask({ id: email.id }),
    );
  }

  function handleDismiss(email: PendingEmail) {
    withRemoval(email.id, "dismissed", () =>
      dismissPendingEmail({ id: email.id }),
    );
  }

  function handleSnooze(email: PendingEmail) {
    withRemoval(email.id, `snoozed ${SNOOZE_HOURS}h`, () =>
      snoozePendingEmail({ id: email.id, hours: SNOOZE_HOURS }),
    );
  }

  function openInGmail(email: PendingEmail) {
    const url = `https://mail.google.com/mail/u/0/#inbox/${email.gmail_message_id}`;
    window.open(url, "_blank");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bash-panel)] border-[var(--bash-border)] text-[var(--bash-text)] max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[13px] font-medium">
            email triage
          </DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--bash-text-muted)]">
            score 4-7 emails awaiting your call. arrows to navigate · t make
            task · d dismiss · o open in gmail · s snooze 24h.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="text-[11px] text-[var(--bash-text-dim)] py-4">
            loading…
          </div>
        ) : emails.length === 0 ? (
          <div className="text-[11px] text-[var(--bash-text-dim)] py-4">
            no pending emails. inbox is clear.
          </div>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto flex flex-col gap-1">
            {emails.map((email, idx) => {
              const isActive = idx === activeIndex;
              return (
                <li
                  key={email.id}
                  ref={(el) => {
                    rowRefs.current[idx] = el;
                  }}
                  onClick={() => setActiveIndex(idx)}
                  className={`rounded-[3px] border px-2 py-1.5 cursor-pointer transition-colors ${
                    isActive
                      ? "border-[var(--bash-accent)] bg-[var(--bash-accent)]/8"
                      : "border-[var(--bash-border-subtle)] bg-[var(--bash-card)]"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-[var(--bash-text-muted)] truncate">
                      {email.sender}
                    </span>
                    <span className="text-[9px] px-1.5 py-px rounded-[2px] bg-[var(--bash-amber)]/15 text-[var(--bash-amber)] shrink-0">
                      {email.score}
                    </span>
                  </div>
                  <div className="text-[12px] text-[var(--bash-text)] truncate">
                    {email.subject}
                  </div>
                  {email.snippet && (
                    <div className="text-[10px] text-[var(--bash-text-dim)] line-clamp-2 mt-0.5">
                      {email.snippet}
                    </div>
                  )}
                  <div className="flex items-center gap-1 mt-1.5">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePromote(email);
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-[2px] bg-[var(--bash-accent)]/15 text-[var(--bash-accent)] hover:bg-[var(--bash-accent)]/25"
                    >
                      <Plus className="w-2.5 h-2.5" /> task
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDismiss(email);
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-[2px] text-[var(--bash-text-muted)] hover:bg-[var(--bash-border-subtle)] hover:text-[var(--bash-text)]"
                    >
                      <Trash2 className="w-2.5 h-2.5" /> dismiss
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSnooze(email);
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-[2px] text-[var(--bash-text-muted)] hover:bg-[var(--bash-border-subtle)] hover:text-[var(--bash-text)]"
                    >
                      <Clock className="w-2.5 h-2.5" /> snooze
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openInGmail(email);
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-[2px] text-[var(--bash-text-muted)] hover:bg-[var(--bash-border-subtle)] hover:text-[var(--bash-text)]"
                    >
                      <MailOpen className="w-2.5 h-2.5" /> open
                      <ExternalLink className="w-2 h-2" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex justify-end pt-2 border-t border-[var(--bash-border-subtle)]">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--bash-text-muted)] hover:text-[var(--bash-text)]"
          >
            <X className="w-3 h-3" /> close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
