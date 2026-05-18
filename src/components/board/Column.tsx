"use client";

import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Task, TaskStatus } from "@/lib/supabase/types";
import { SortableTaskCard } from "./SortableTaskCard";
import { TaskDialog } from "./TaskDialog";

type ColumnProps = {
  status: TaskStatus;
  tasks: Task[];
  onTaskCreated: (task: Task) => void;
  onTaskUpdated: (task: Task) => void;
  onTaskDeleted: (id: string) => void;
  onChildrenCreated: (children: Task[]) => void;
};

export function Column({
  status,
  tasks,
  onTaskCreated,
  onTaskUpdated,
  onTaskDeleted,
  onChildrenCreated,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const [openCreate, setOpenCreate] = useState(false);

  return (
    <section className="flex flex-col w-[300px] shrink-0 bg-muted/40 rounded-md border">
      <header className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-medium truncate">{status}</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {tasks.length}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setOpenCreate(true)}
          aria-label={`Add card to ${status}`}
        >
          <Plus className="size-4" />
        </Button>
      </header>

      <div
        ref={setNodeRef}
        className={`flex-1 flex flex-col gap-2 p-2 min-h-[120px] transition-colors ${
          isOver ? "bg-muted/70" : ""
        }`}
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onUpdated={onTaskUpdated}
              onDeleted={onTaskDeleted}
              onChildrenCreated={onChildrenCreated}
            />
          ))}
        </SortableContext>
      </div>

      {openCreate ? (
        <TaskDialog
          mode="create"
          defaultStatus={status}
          open={openCreate}
          onOpenChange={setOpenCreate}
          onCreated={onTaskCreated}
        />
      ) : null}
    </section>
  );
}
