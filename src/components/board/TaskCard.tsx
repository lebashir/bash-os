"use client";

import { forwardRef, type CSSProperties, type HTMLAttributes } from "react";
import { Calendar, Mail, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Task, TaskSource } from "@/lib/supabase/types";

type TaskCardProps = HTMLAttributes<HTMLDivElement> & {
  task: Task;
  isOverlay?: boolean;
  isDragging?: boolean;
  style?: CSSProperties;
};

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-amber-500",
  urgent: "bg-red-500",
};

const SOURCE_ICON: Partial<Record<TaskSource, LucideIcon>> = {
  gmail: Mail,
  calendar: Calendar,
  brief: Sparkles,
};

const SOURCE_TINT: Partial<Record<TaskSource, string>> = {
  gmail: "text-rose-500",
  calendar: "text-sky-500",
  brief: "text-amber-500",
};

export const TaskCard = forwardRef<HTMLDivElement, TaskCardProps>(
  function TaskCard({ task, isOverlay, isDragging, className, ...rest }, ref) {
    const dot = task.priority ? PRIORITY_DOT[task.priority] : undefined;
    const SourceIcon = SOURCE_ICON[task.source];
    const sourceTint = SOURCE_TINT[task.source] ?? "text-muted-foreground";

    return (
      <div
        ref={ref}
        {...rest}
        className={`group rounded-md border bg-card text-card-foreground shadow-sm hover:shadow transition cursor-pointer p-3 space-y-1 ${
          isDragging ? "opacity-40" : ""
        } ${isOverlay ? "shadow-lg rotate-1" : ""} ${className ?? ""}`}
      >
        <div className="flex items-start gap-2">
          {SourceIcon ? (
            <SourceIcon
              className={`size-3.5 mt-0.5 shrink-0 ${sourceTint}`}
              aria-hidden
            />
          ) : null}
          {dot ? (
            <span
              className={`inline-block size-2 rounded-full mt-1.5 shrink-0 ${dot}`}
              aria-hidden
            />
          ) : null}
          <p className="text-sm font-medium leading-snug flex-1 break-words">
            {task.title}
          </p>
        </div>
        {(task.due_date || task.source_account) && (
          <div className="flex items-center gap-2 flex-wrap pl-5 text-[10px] text-muted-foreground">
            {task.due_date ? (
              <span>{formatTaskTime(task.due_date, task.source)}</span>
            ) : null}
            {task.source_account ? (
              <span className="truncate max-w-[24ch]">{task.source_account}</span>
            ) : null}
          </div>
        )}
      </div>
    );
  },
);

function formatTaskTime(iso: string, source: TaskSource): string {
  const d = new Date(iso);
  // Calendar events get a date + time; other sources just get the date.
  if (source === "calendar") {
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
