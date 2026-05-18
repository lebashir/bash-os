"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { TASK_STATUSES, type Task, type TaskStatus } from "@/lib/supabase/types";
import { moveTask } from "@/app/board/actions";
import { Column } from "./Column";
import { TaskCard } from "./TaskCard";

type BoardProps = { initialTasks: Task[] };

type TasksByStatus = Record<TaskStatus, Task[]>;

function groupByStatus(tasks: Task[]): TasksByStatus {
  const empty: TasksByStatus = {
    "things to think about": [],
    "on the menu": [],
    "todays plate": [],
    "Bash work": [],
    "Claude work": [],
    "Boss Check": [],
    "DIgested.": [],
  };
  for (const t of tasks) {
    empty[t.status] = [...empty[t.status], t];
  }
  for (const s of TASK_STATUSES) {
    empty[s] = [...empty[s]].sort((a, b) => a.position - b.position);
  }
  return empty;
}

function findContainer(
  byStatus: TasksByStatus,
  id: string,
): TaskStatus | null {
  if ((TASK_STATUSES as readonly string[]).includes(id)) {
    return id as TaskStatus;
  }
  for (const status of TASK_STATUSES) {
    if (byStatus[status].some((t) => t.id === id)) return status;
  }
  return null;
}

export function Board({ initialTasks }: BoardProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  const byStatus = useMemo(() => groupByStatus(tasks), [tasks]);
  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    const activeContainer = findContainer(groupByStatus(tasks), activeIdStr);
    const overContainer = findContainer(groupByStatus(tasks), overIdStr);
    if (!activeContainer || !overContainer) return;
    if (activeContainer === overContainer) return;

    setTasks((prev) => {
      const fromList = prev.filter(
        (t) => t.status === activeContainer && t.id !== activeIdStr,
      );
      const movedTask = prev.find((t) => t.id === activeIdStr);
      if (!movedTask) return prev;

      const toList = prev.filter(
        (t) => t.status === overContainer && t.id !== activeIdStr,
      );

      const overIsContainer = overIdStr === overContainer;
      const overIndex = overIsContainer
        ? toList.length
        : toList.findIndex((t) => t.id === overIdStr);

      const insertAt = overIndex === -1 ? toList.length : overIndex;
      const newToList = [
        ...toList.slice(0, insertAt),
        { ...movedTask, status: overContainer },
        ...toList.slice(insertAt),
      ];

      const others = prev.filter(
        (t) => t.status !== activeContainer && t.status !== overContainer,
      );
      return [
        ...others,
        ...fromList.map((t, i) => ({ ...t, position: i })),
        ...newToList.map((t, i) => ({ ...t, position: i })),
      ];
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const grouped = groupByStatus(tasks);
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    const activeContainer = findContainer(grouped, activeIdStr);
    const overContainer = findContainer(grouped, overIdStr);
    if (!activeContainer || !overContainer) return;

    let nextTasks = tasks;
    if (activeContainer === overContainer && activeIdStr !== overIdStr) {
      const list = grouped[activeContainer];
      const oldIndex = list.findIndex((t) => t.id === activeIdStr);
      const newIndex = list.findIndex((t) => t.id === overIdStr);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = [...list];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      const others = tasks.filter((t) => t.status !== activeContainer);
      nextTasks = [
        ...others,
        ...reordered.map((t, i) => ({ ...t, position: i })),
      ];
      setTasks(nextTasks);
    }

    const grouped2 = groupByStatus(nextTasks);
    const orderedIdsByStatus = Object.fromEntries(
      TASK_STATUSES.map((s) => [s, grouped2[s].map((t) => t.id)]),
    ) as Record<TaskStatus, string[]>;

    const previousTasks = tasks;
    startTransition(async () => {
      try {
        await moveTask({
          id: activeIdStr,
          status:
            (nextTasks.find((t) => t.id === activeIdStr)?.status ??
              activeContainer) as TaskStatus,
          orderedIdsByStatus,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Move failed");
        setTasks(previousTasks);
      }
    });
  }

  function handleLocalReplace(updated: Task) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  function handleLocalAdd(created: Task) {
    setTasks((prev) => [...prev, created]);
  }

  function handleLocalDelete(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  function handleChildrenCreated(children: Task[]) {
    setTasks((prev) => [...prev, ...children]);
  }

  if (!mounted) {
    // Defer rendering until after hydration: @dnd-kit's generated aria-describedby
    // IDs are non-deterministic between SSR and client, which trips React's
    // hydration check. The board only makes sense client-side anyway.
    return <div className="flex-1" aria-busy />;
  }

  return (
    <>
      <DndContext
        id="bash-os-board"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
          <div className="flex gap-4 h-full min-w-max">
            {TASK_STATUSES.map((status) => (
              <Column
                key={status}
                status={status}
                tasks={byStatus[status]}
                onTaskCreated={handleLocalAdd}
                onTaskUpdated={handleLocalReplace}
                onTaskDeleted={handleLocalDelete}
                onChildrenCreated={handleChildrenCreated}
              />
            ))}
          </div>
        </div>
        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} isOverlay /> : null}
        </DragOverlay>
      </DndContext>
      <Toaster richColors position="bottom-right" />
    </>
  );
}
