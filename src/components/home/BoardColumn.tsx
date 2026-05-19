"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { BoardCard } from "@/components/home/BoardCard";
import type { Column, Task } from "@/lib/supabase/types";

interface BoardColumnProps {
  column: Column;
  tasks: Task[];
  onAddTask: (columnId: string) => void;
  onSelectTask: (task: Task) => void;
  onOpenMenu: (column: Column) => void;
}

export function BoardColumn({
  column,
  tasks,
  onAddTask,
  onSelectTask,
  onOpenMenu,
}: BoardColumnProps) {
  const [hovered, setHovered] = useState(false);
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `column:${column.id}`,
    data: { kind: "column", columnId: column.id },
  });
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `column-handle:${column.id}`,
    data: { kind: "column-handle", columnId: column.id },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const accent = column.accent_color ?? "#8a8a90";
  const taskIds = tasks.map((t) => t.id);

  return (
    <div
      ref={setSortableRef}
      style={style}
      className="w-[240px] shrink-0 flex flex-col border-r border-[var(--bash-border-subtle)] last:border-r-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="h-8 px-2 flex items-center gap-1.5 border-b border-[var(--bash-border-subtle)] shrink-0"
        style={{ borderBottomColor: `${accent}33` }}
      >
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab text-[var(--bash-text-dim)] hover:text-[var(--bash-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="drag column"
        >
          <GripVertical className={`w-3 h-3 ${hovered ? "opacity-100" : "opacity-0"}`} />
        </span>
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: accent }}
        />
        <span className="text-[12px] text-[var(--bash-text)] font-medium flex-1 truncate">
          {column.name}
        </span>
        <span className="text-[10px] text-[var(--bash-text-dim)] tabular-nums">
          {tasks.length}
        </span>
        <button
          type="button"
          onClick={() => onAddTask(column.id)}
          className="p-0.5 text-[var(--bash-text-dim)] hover:text-[var(--bash-text)] hover:bg-[var(--bash-border-subtle)] rounded-[2px]"
          aria-label={`add task to ${column.name}`}
        >
          <Plus className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={() => onOpenMenu(column)}
          className="p-0.5 text-[var(--bash-text-dim)] hover:text-[var(--bash-text)] hover:bg-[var(--bash-border-subtle)] rounded-[2px]"
          aria-label={`column actions for ${column.name}`}
        >
          <MoreHorizontal className="w-3 h-3" />
        </button>
      </div>
      <div
        ref={setDropRef}
        className={`flex-1 min-h-0 overflow-y-auto px-1.5 py-1.5 flex flex-col gap-1 ${
          isOver ? "bg-[var(--bash-border-subtle)]/50" : ""
        }`}
      >
        <SortableContext
          items={taskIds}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((t) => (
            <BoardCard key={t.id} task={t} onSelect={onSelectTask} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="text-[10px] text-[var(--bash-text-dim)] px-1 py-1">
            no tasks.
          </div>
        )}
      </div>
    </div>
  );
}
