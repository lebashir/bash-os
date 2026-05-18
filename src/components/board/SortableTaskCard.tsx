"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import type { Task } from "@/lib/supabase/types";
import { DecomposeDialog } from "./DecomposeDialog";
import { TaskCard } from "./TaskCard";
import { TaskDialog } from "./TaskDialog";

type Props = {
  task: Task;
  onUpdated: (task: Task) => void;
  onDeleted: (id: string) => void;
  onChildrenCreated: (children: Task[]) => void;
};

export function SortableTaskCard({
  task,
  onUpdated,
  onDeleted,
  onChildrenCreated,
}: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [decomposeOpen, setDecomposeOpen] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <>
      <TaskCard
        ref={setNodeRef}
        task={task}
        style={style}
        isDragging={isDragging}
        {...attributes}
        {...listeners}
        onClick={(e) => {
          // Drag listeners use mousedown; click still fires after a tap-with-no-drag.
          // We want a click to open the editor; @dnd-kit's PointerSensor distance
          // constraint ensures a small movement doesn't initiate a drag.
          e.stopPropagation();
          setEditOpen(true);
        }}
        onDecomposeClick={() => setDecomposeOpen(true)}
      />
      {editOpen ? (
        <TaskDialog
          mode="edit"
          task={task}
          open={editOpen}
          onOpenChange={setEditOpen}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
        />
      ) : null}
      {decomposeOpen ? (
        <DecomposeDialog
          task={task}
          open={decomposeOpen}
          onOpenChange={setDecomposeOpen}
          onCreated={onChildrenCreated}
        />
      ) : null}
    </>
  );
}
