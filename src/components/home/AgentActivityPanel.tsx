"use client";

import { useEffect, useState } from "react";
import { listAgentEvents } from "@/app/board/agent-events";
import type { AgentEvent } from "@/lib/supabase/types";

interface AgentActivityPanelProps {
  initialEvents: AgentEvent[];
}

const REFRESH_INTERVAL_MS = 30_000;

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "";
  const seconds = Math.round(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export function AgentActivityPanel({ initialEvents }: AgentActivityPanelProps) {
  const [events, setEvents] = useState<AgentEvent[]>(initialEvents);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const next = await listAgentEvents();
        setEvents(next);
      } catch {
        // Stale data is fine; surface nothing on transient errors.
      }
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col">
      <div className="px-3 pt-2 pb-1 text-[11px] text-[var(--bash-text-muted)]">
        agent activity
      </div>
      {events.length === 0 ? (
        <div className="px-3 py-4 text-[10px] text-[var(--bash-text-dim)] leading-[1.4]">
          no events yet. internal actions (chat, sync, cron) and external
          ingest (claude code hook, cowork) will surface here.
        </div>
      ) : (
        <ul className="flex flex-col">
          {events.map((e) => {
            const isOpen = expanded === e.id;
            const hasPayload =
              e.payload && Object.keys(e.payload).length > 0;
            return (
              <li
                key={e.id}
                className="px-3 py-1.5 border-t border-[var(--bash-border-subtle)] first:border-t-0"
              >
                <button
                  type="button"
                  onClick={() =>
                    hasPayload
                      ? setExpanded(isOpen ? null : e.id)
                      : undefined
                  }
                  className="w-full text-left"
                  disabled={!hasPayload}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] text-[var(--bash-text-muted)] truncate">
                      {e.source}
                      {e.project ? (
                        <span className="text-[var(--bash-text-dim)]">
                          {" "}
                          / {e.project}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[9px] text-[var(--bash-text-dim)] tabular-nums shrink-0">
                      {timeAgo(e.created_at)}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--bash-text)] truncate">
                    {e.action}
                    {e.target ? (
                      <span className="text-[var(--bash-text-muted)]">
                        {" "}
                        · {e.target}
                      </span>
                    ) : null}
                  </div>
                </button>
                {isOpen && hasPayload && (
                  <pre className="mt-1 text-[10px] text-[var(--bash-text-muted)] bg-[var(--bash-card)] border border-[var(--bash-border-subtle)] rounded-[2px] p-2 overflow-x-auto">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
