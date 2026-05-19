"use client";

import { useMemo } from "react";
import type { TimelineEvent } from "@/app/board/timeline";

interface TimelinePanelProps {
  events: TimelineEvent[];
}

const HOUR_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  hour12: false,
});

const KIND_STYLES: Record<
  TimelineEvent["kind"],
  { dot: string; text: string; prefix?: string }
> = {
  calendar: {
    dot: "bg-[var(--bash-accent)]",
    text: "text-[var(--bash-text)]",
  },
  "task-created": {
    dot: "bg-[var(--bash-text-dim)]",
    text: "text-[var(--bash-text-muted)]",
    prefix: "+",
  },
  "task-completed": {
    dot: "bg-[var(--bash-success)]",
    text: "text-[var(--bash-text-muted)]",
    prefix: "✓",
  },
  "task-moved": {
    dot: "bg-[var(--bash-text-dim)]",
    text: "text-[var(--bash-text-muted)]",
    prefix: "→",
  },
  "task-updated": {
    dot: "bg-[var(--bash-text-dim)]",
    text: "text-[var(--bash-text-muted)]",
  },
  "task-deleted": {
    dot: "bg-[var(--bash-text-dim)]",
    text: "text-[var(--bash-text-dim)]",
    prefix: "−",
  },
};

export function TimelinePanel({ events }: TimelinePanelProps) {
  // Group events by hour bucket. Empty hours still get a row to keep the
  // axis legible. Default range: 9:00 to 21:00 user-local. Auto-extend if
  // an event falls outside.
  const buckets = useMemo(() => groupByHour(events), [events]);

  return (
    <div className="flex flex-col">
      <div className="px-3 pt-2 pb-1 text-[11px] text-[var(--bash-text-muted)]">
        today
      </div>
      <div className="flex flex-col">
        {buckets.map((b) => (
          <div
            key={b.hourKey}
            className="flex items-start gap-2 px-3 py-1 border-t border-[var(--bash-border-subtle)] first:border-t-0"
          >
            <div className="w-10 shrink-0 pt-0.5 text-[10px] text-[var(--bash-text-dim)] tabular-nums">
              {b.label}
            </div>
            <div className="flex-1 min-w-0">
              {b.events.length === 0 ? (
                <div className="h-3" aria-hidden />
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {b.events.map((e) => (
                    <TimelineRow key={e.id} event={e} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {buckets.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-[var(--bash-text-dim)]">
            no events today.
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  const style = KIND_STYLES[event.kind];
  const time = new Date(event.at);
  const isNear =
    event.kind === "calendar" &&
    time.getTime() - Date.now() < 60 * 60 * 1000 &&
    time.getTime() > Date.now();

  return (
    <li className="flex items-center gap-1.5 min-w-0">
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot} ${
          isNear ? "ring-2 ring-[var(--bash-accent)]/30" : ""
        }`}
      />
      <span className="text-[10px] text-[var(--bash-text-dim)] tabular-nums shrink-0">
        {HOUR_FORMAT.format(time)}
      </span>
      <span className={`text-[11px] truncate ${style.text} ${isNear ? "font-medium text-[var(--bash-text)]" : ""}`}>
        {style.prefix ? `${style.prefix} ` : ""}
        {event.title}
        {event.meta && (
          <span className="text-[var(--bash-text-dim)]"> {event.meta}</span>
        )}
      </span>
    </li>
  );
}

interface HourBucket {
  hourKey: string;
  label: string;
  events: TimelineEvent[];
}

const DEFAULT_FROM_HOUR = 9;
const DEFAULT_TO_HOUR = 21;

function groupByHour(events: TimelineEvent[]): HourBucket[] {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  let fromHour = DEFAULT_FROM_HOUR;
  let toHour = DEFAULT_TO_HOUR;
  for (const e of events) {
    const d = new Date(e.at);
    if (d.toDateString() !== startOfDay.toDateString()) continue;
    fromHour = Math.min(fromHour, d.getHours());
    toHour = Math.max(toHour, d.getHours());
  }

  const buckets: HourBucket[] = [];
  for (let h = fromHour; h <= toHour; h++) {
    const slot = new Date(startOfDay);
    slot.setHours(h);
    buckets.push({
      hourKey: `h-${h}`,
      label: `${String(h).padStart(2, "0")}:00`,
      events: [],
    });
  }
  for (const e of events) {
    const d = new Date(e.at);
    if (d.toDateString() !== startOfDay.toDateString()) continue;
    const h = d.getHours();
    const idx = h - fromHour;
    if (idx >= 0 && idx < buckets.length) {
      buckets[idx].events.push(e);
    }
  }
  for (const b of buckets) {
    b.events.sort((a, b2) => Date.parse(a.at) - Date.parse(b2.at));
  }

  return buckets;
}
