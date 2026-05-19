"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bot, User } from "lucide-react";
import type { Task } from "@/lib/supabase/types";

interface BoardCardProps {
  task: Task;
  onSelect?: (task: Task) => void;
}

const PRIORITY_DOT: Partial<Record<NonNullable<Task["priority"]>, string>> = {
  urgent: "bg-[var(--bash-urgent)]",
  high: "bg-[var(--bash-amber)]",
};

export function BoardCard({ task, onSelect }: BoardCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { kind: "task", columnId: task.column_id } });

  const isClaude = task.owner === "claude";
  const dotClass =
    task.priority === "urgent" || task.priority === "high"
      ? PRIORITY_DOT[task.priority]
      : null;
  const tagsToShow = task.tags.slice(0, 2);
  const extraTagCount = task.tags.length - tagsToShow.length;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Only treat as click when not initiating a drag.
        if (!isDragging) onSelect?.(task);
        e.stopPropagation();
      }}
      className={`group relative rounded-[3px] border border-[var(--bash-border-subtle)] bg-[var(--bash-card)] px-1.5 py-1 cursor-pointer hover:border-[var(--bash-border)] transition-colors ${
        isClaude ? "bg-[color-mix(in_srgb,var(--bash-owner-claude)_5%,var(--bash-card))]" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {isClaude ? (
          <Bot
            className="w-3 h-3 shrink-0 text-[var(--bash-owner-claude)]"
            aria-label="owner: claude"
          />
        ) : (
          <User
            className="w-3 h-3 shrink-0 text-[var(--bash-owner-bash)]"
            aria-label="owner: bash"
          />
        )}
        {dotClass && (
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`}
            aria-label={`priority: ${task.priority}`}
          />
        )}
        <span className="text-[12px] text-[var(--bash-text)] truncate flex-1">
          {task.title}
        </span>
        {tagsToShow.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            {tagsToShow.map((t) => (
              <span
                key={t}
                className="text-[9px] px-1 py-px rounded-[2px] bg-[var(--bash-border-subtle)] text-[var(--bash-text-muted)]"
              >
                {t}
              </span>
            ))}
            {extraTagCount > 0 && (
              <span className="text-[9px] text-[var(--bash-text-dim)]">
                +{extraTagCount}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
