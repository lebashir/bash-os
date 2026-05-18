"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listRecentBriefs } from "@/app/board/brief-actions";
import type { Brief } from "@/lib/supabase/types";

export function BriefDrawer() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label="Open today's brief"
      >
        <FileText />
      </Button>
      {open ? <Drawer onClose={() => setOpen(false)} /> : null}
    </>
  );
}

type DrawerProps = { onClose: () => void };

function Drawer({ onClose }: DrawerProps) {
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listRecentBriefs();
        if (!cancelled) {
          setBriefs(data);
          setSelectedId(data[0]?.id ?? null);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to load briefs",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => briefs?.find((b) => b.id === selectedId) ?? null,
    [briefs, selectedId],
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
        aria-label="Close brief"
      />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l bg-background shadow-2xl">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Daily brief</span>
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
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <BriefBody briefs={briefs} selected={selected} />
        </div>
        {briefs && briefs.length > 0 ? (
          <footer className="border-t px-4 py-3">
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Recent
            </p>
            <ul className="space-y-1">
              {briefs.map((b) => {
                const isSelected = b.id === selectedId;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(b.id)}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ${
                        isSelected
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      }`}
                    >
                      <span>{formatBriefDate(b.brief_date)}</span>
                      <span className="text-muted-foreground">
                        {dayLabel(b.brief_date)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}

type BriefBodyProps = {
  briefs: Brief[] | null;
  selected: Brief | null;
};

function BriefBody({ briefs, selected }: BriefBodyProps) {
  if (briefs === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (briefs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No briefs yet. One is generated each morning at 9:30 Dubai time.
      </p>
    );
  }
  if (!selected) {
    return null;
  }
  return (
    <article className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {formatBriefDate(selected.brief_date)}
      </p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">
        {selected.content}
      </p>
    </article>
  );
}

function formatBriefDate(briefDate: string): string {
  // brief_date is a DATE column (YYYY-MM-DD). Render without TZ shifts by
  // splitting the string rather than passing through Date() which would apply
  // the browser's local zone offset.
  const [y, m, d] = briefDate.split("-").map(Number);
  if (!y || !m || !d) return briefDate;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function dayLabel(briefDate: string): string {
  const today = todayLocalDate();
  if (briefDate === today) return "today";
  const yesterday = offsetDateString(today, -1);
  if (briefDate === yesterday) return "yesterday";
  return "";
}

function todayLocalDate(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function offsetDateString(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  const shifted = new Date(y, m - 1, d + days);
  return [
    shifted.getFullYear(),
    String(shifted.getMonth() + 1).padStart(2, "0"),
    String(shifted.getDate()).padStart(2, "0"),
  ].join("-");
}
