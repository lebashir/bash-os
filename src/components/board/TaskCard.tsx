"use client";

import { forwardRef, type CSSProperties, type HTMLAttributes } from "react";
import { Badge } from "@/components/ui/badge";
import type { Task } from "@/lib/supabase/types";

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

export const TaskCard = forwardRef<HTMLDivElement, TaskCardProps>(
  function TaskCard({ task, isOverlay, isDragging, className, ...rest }, ref) {
    const dot = task.priority ? PRIORITY_DOT[task.priority] : undefined;

    return (
      <div
        ref={ref}
        {...rest}
        className={`group rounded-md border bg-card text-card-foreground shadow-sm hover:shadow transition cursor-pointer p-3 space-y-1 ${
          isDragging ? "opacity-40" : ""
        } ${isOverlay ? "shadow-lg rotate-1" : ""} ${className ?? ""}`}
      >
        <div className="flex items-start gap-2">
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
        {(task.source_id || task.due_date) && (
          <div className="flex items-center gap-2 flex-wrap">
            {task.source_id ? (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {task.source_id}
              </Badge>
            ) : null}
            {task.due_date ? (
              <span className="text-[10px] text-muted-foreground">
                {new Date(task.due_date).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            ) : null}
          </div>
        )}
      </div>
    );
  },
);
