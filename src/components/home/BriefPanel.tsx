"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { AlertCircle, Bell, BellRing, Calendar, Eye, Mail } from "lucide-react";
import type {
  AttentionBar,
  AttentionBarKind,
  BriefState,
} from "@/app/board/brief-state";

interface BriefPanelProps {
  state: BriefState;
}

const KIND_ICON: Record<AttentionBarKind, typeof Bell> = {
  "calendar-imminent": Calendar,
  "tasks-overdue": AlertCircle,
  "emails-urgent": Mail,
  "needs-review": Eye,
  "emails-triage": Mail,
  "items-unsnoozed": BellRing,
};

const TREATMENT_CLASSES = {
  urgent: {
    border: "border-[var(--bash-urgent)]/40",
    bg: "bg-[var(--bash-urgent)]/10 hover:bg-[var(--bash-urgent)]/15",
    text: "text-[var(--bash-urgent)]",
  },
  amber: {
    border: "border-[var(--bash-amber)]/40",
    bg: "bg-[var(--bash-amber)]/10 hover:bg-[var(--bash-amber)]/15",
    text: "text-[var(--bash-amber)]",
  },
  info: {
    border: "border-[var(--bash-accent)]/40",
    bg: "bg-[var(--bash-accent)]/10 hover:bg-[var(--bash-accent)]/15",
    text: "text-[var(--bash-accent)]",
  },
} as const;

export function BriefPanel({ state }: BriefPanelProps) {
  const [, startTransition] = useTransition();

  function handleBarClick(bar: AttentionBar) {
    startTransition(() => {
      switch (bar.kind) {
        case "calendar-imminent":
          toast.info(`event in ${bar.message}`);
          break;
        case "tasks-overdue":
          toast.info(`overdue: ${bar.count} task${bar.count === 1 ? "" : "s"}`);
          break;
        case "emails-urgent":
          toast.info(`${bar.count} urgent email${bar.count === 1 ? "" : "s"}`);
          break;
        case "needs-review":
          // Once Phase 5 ships, this dispatches a board-filter event.
          window.dispatchEvent(
            new CustomEvent("bash-os:filter-column", {
              detail: { columnId: bar.payload?.columnId },
            }),
          );
          break;
        case "emails-triage":
          // Phase 9 wires this to the TriageModal open event.
          window.dispatchEvent(new CustomEvent("bash-os:open-triage"));
          toast.info(`${bar.count} pending review`);
          break;
        case "items-unsnoozed":
          toast.info(`${bar.count} just unsnoozed`);
          break;
      }
    });
  }

  const { attentionBars, dayUpdate } = state;
  const next = dayUpdate.nextEvent;

  return (
    <div className="flex flex-col">
      <div className="px-3 pt-2 pb-1 text-[11px] text-[var(--bash-text-muted)]">
        brief
      </div>
      {attentionBars.length > 0 && (
        <ul className="px-2 pb-2 flex flex-col gap-1">
          {attentionBars.map((bar) => {
            const Icon = KIND_ICON[bar.kind];
            const t = TREATMENT_CLASSES[bar.treatment];
            return (
              <li key={bar.kind}>
                <button
                  type="button"
                  onClick={() => handleBarClick(bar)}
                  className={`w-full text-left px-2 py-1.5 rounded-[3px] border flex items-center gap-2 transition-colors ${t.border} ${t.bg}`}
                >
                  <Icon className={`w-3 h-3 ${t.text} shrink-0`} />
                  <span className={`text-[11px] leading-tight ${t.text}`}>
                    {bar.message}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mx-2 mb-2 p-2 rounded-[3px] border border-[var(--bash-border-subtle)] bg-[var(--bash-card)]">
        {next ? (
          <div className="mb-1.5">
            <div className="text-[10px] text-[var(--bash-text-dim)] mb-0.5">
              next event
            </div>
            <div className="text-[12px] text-[var(--bash-text)] truncate">
              {next.title}
            </div>
            <div className="text-[10px] text-[var(--bash-text-muted)]">
              in {next.minutesUntil} min
            </div>
          </div>
        ) : (
          <div className="mb-1.5 text-[10px] text-[var(--bash-text-dim)]">
            no upcoming events
          </div>
        )}
        <div className="text-[11px] text-[var(--bash-text-muted)] leading-tight">
          {dayUpdate.onPlate} on plate · {dayUpdate.urgent} urgent ·{" "}
          {dayUpdate.inbox} in inbox
        </div>
      </div>
    </div>
  );
}
