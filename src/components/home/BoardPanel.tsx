"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { Plus, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { moveTask } from "@/app/board/actions";
import {
  createColumn,
  deleteColumn,
  reorderColumns,
  updateColumn,
} from "@/app/board/column-actions";
import { BoardCard } from "@/components/home/BoardCard";
import { BoardColumn } from "@/components/home/BoardColumn";
import { TaskDialog } from "@/components/home/TaskDialog";
import type { Column, Task } from "@/lib/supabase/types";

interface BoardPanelProps {
  initialColumns: Column[];
  initialTasks: Task[];
}

const COLOR_SWATCHES = [
  "#7a7a80",
  "#5e8aff",
  "#f5a23a",
  "#e24b4a",
  "#5fc96b",
  "#a584ff",
  "#5a5a60",
  "#e5e5ea",
];

// Prefer column droppables when the pointer is inside a column body; fall
// back to closestCenter so reordering within a column still works. Plain
// closestCenter snaps to the nearest *card* in an adjacent dense column
// even when the pointer is visually inside the empty target, so dragging
// into empty columns (Review / Done) silently bounces back.
const collisionDetectionStrategy: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  const columnHits = pointerHits.filter(
    (c) => c.data?.droppableContainer?.data?.current?.kind === "column",
  );
  if (columnHits.length > 0) return columnHits;
  const rectHits = rectIntersection(args);
  const rectColumnHits = rectHits.filter(
    (c) => c.data?.droppableContainer?.data?.current?.kind === "column",
  );
  if (rectColumnHits.length > 0 && pointerHits.length === 0)
    return rectColumnHits;
  return closestCenter(args);
};

export function BoardPanel({ initialColumns, initialTasks }: BoardPanelProps) {
  const [columns, setColumns] = useState<Column[]>(initialColumns);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingTransition, startTransition] = useTransition();

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTask, setDialogTask] = useState<Task | null>(null);
  const [dialogColumnId, setDialogColumnId] = useState<string | null>(null);

  // Column menu state
  const [menuColumn, setMenuColumn] = useState<Column | null>(null);
  const [renamingColumnId, setRenamingColumnId] = useState<string | null>(null);

  // Add-column inline form
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnColor, setNewColumnColor] = useState(COLOR_SWATCHES[0]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const col of columns) map.set(col.id, []);
    for (const t of tasks) {
      const arr = map.get(t.column_id);
      if (arr) arr.push(t);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.position - b.position);
    return map;
  }, [columns, tasks]);

  function findContainerForTask(taskId: string): string | null {
    return tasks.find((t) => t.id === taskId)?.column_id ?? null;
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeKind = active.data.current?.kind;
    if (activeKind !== "task") return;

    const activeIdStr = String(active.id);
    const activeContainer = findContainerForTask(activeIdStr);
    const overContainer =
      over.data.current?.kind === "task"
        ? findContainerForTask(String(over.id))
        : over.data.current?.kind === "column"
          ? (over.data.current.columnId as string)
          : null;
    if (!activeContainer || !overContainer) return;
    if (activeContainer === overContainer) return;

    setTasks((prev) => {
      const activeTask = prev.find((t) => t.id === activeIdStr);
      if (!activeTask) return prev;
      const moved: Task = { ...activeTask, column_id: overContainer };
      const others = prev.filter((t) => t.id !== activeIdStr);
      return [...others, moved];
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeKind = active.data.current?.kind;

    if (activeKind === "column-handle") {
      const overKind = over.data.current?.kind;
      if (overKind !== "column-handle") return;
      const fromId = String(active.id).replace("column-handle:", "");
      const toId = String(over.id).replace("column-handle:", "");
      if (fromId === toId) return;
      const fromIdx = columns.findIndex((c) => c.id === fromId);
      const toIdx = columns.findIndex((c) => c.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = arrayMove(columns, fromIdx, toIdx);
      setColumns(next);
      startTransition(async () => {
        try {
          await reorderColumns({ orderedIds: next.map((c) => c.id) });
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "column reorder failed",
          );
          setColumns(initialColumns);
        }
      });
      return;
    }

    if (activeKind === "task") {
      const activeIdStr = String(active.id);
      const activeContainer = findContainerForTask(activeIdStr);
      if (!activeContainer) return;

      let overContainer: string | null = null;
      if (over.data.current?.kind === "task") {
        overContainer = findContainerForTask(String(over.id));
      } else if (over.data.current?.kind === "column") {
        overContainer = over.data.current.columnId as string;
      }
      if (!overContainer) return;

      let next = tasks.slice();
      if (activeContainer === overContainer) {
        const inCol = next.filter((t) => t.column_id === overContainer);
        const fromIdx = inCol.findIndex((t) => t.id === activeIdStr);
        const toIdx = inCol.findIndex((t) => t.id === String(over.id));
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
        const reordered = arrayMove(inCol, fromIdx, toIdx).map((t, i) => ({
          ...t,
          position: i,
        }));
        next = [
          ...next.filter((t) => t.column_id !== overContainer),
          ...reordered,
        ];
      } else {
        next = next.map((t) =>
          t.id === activeIdStr ? { ...t, column_id: overContainer } : t,
        );
      }
      setTasks(next);

      const orderedIdsByColumn: Record<string, string[]> = {};
      for (const col of columns) {
        orderedIdsByColumn[col.id] = next
          .filter((t) => t.column_id === col.id)
          .sort((a, b) => a.position - b.position)
          .map((t) => t.id);
      }

      startTransition(async () => {
        try {
          await moveTask({
            id: activeIdStr,
            column_id: overContainer!,
            orderedIdsByColumn,
          });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "move failed");
          setTasks(initialTasks);
        }
      });
    }
  }

  function openCreateTask(columnId: string) {
    setDialogTask(null);
    setDialogColumnId(columnId);
    setDialogOpen(true);
  }

  function openEditTask(task: Task) {
    setDialogTask(task);
    setDialogColumnId(task.column_id);
    setDialogOpen(true);
  }

  async function handleSubmitAddColumn() {
    const name = newColumnName.trim();
    if (!name) {
      toast.error("name required");
      return;
    }
    try {
      const created = await createColumn({
        name,
        accent_color: newColumnColor,
      });
      setColumns((prev) => [...prev, created]);
      setNewColumnName("");
      setNewColumnColor(COLOR_SWATCHES[0]);
      setAddingColumn(false);
      toast.success(`added column "${created.name}"`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "add column failed");
    }
  }

  async function handleRenameColumn(id: string, newName: string) {
    const name = newName.trim();
    if (!name) {
      toast.error("name required");
      return;
    }
    const prev = columns;
    setColumns((cs) => cs.map((c) => (c.id === id ? { ...c, name } : c)));
    setRenamingColumnId(null);
    try {
      await updateColumn({ id, name });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "rename failed");
      setColumns(prev);
    }
  }

  async function handleChangeColumnColor(id: string, color: string) {
    const prev = columns;
    setColumns((cs) =>
      cs.map((c) => (c.id === id ? { ...c, accent_color: color } : c)),
    );
    try {
      await updateColumn({ id, accent_color: color });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "color change failed");
      setColumns(prev);
    }
  }

  async function handleDeleteColumn(id: string) {
    const remaining = columns.filter((c) => c.id !== id);
    if (remaining.length === 0) {
      toast.error("cannot delete the last column");
      return;
    }
    const tasksInColumn = tasks.filter((t) => t.column_id === id).length;
    let destinationId = remaining[0].id;
    if (tasksInColumn > 0) {
      const destName = window.prompt(
        `move ${tasksInColumn} tasks to which column? available: ${remaining.map((c) => c.name).join(", ")}`,
        remaining[0].name,
      );
      if (!destName) return;
      const dest = remaining.find((c) => c.name === destName.trim());
      if (!dest) {
        toast.error("column not found");
        return;
      }
      destinationId = dest.id;
    } else if (!confirm("delete this column?")) {
      return;
    }

    const prevTasks = tasks;
    const prevColumns = columns;
    setTasks((ts) =>
      ts.map((t) => (t.column_id === id ? { ...t, column_id: destinationId } : t)),
    );
    setColumns(remaining);
    setMenuColumn(null);
    try {
      await deleteColumn({ id, destinationColumnId: destinationId });
      toast.success("column deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "delete failed");
      setTasks(prevTasks);
      setColumns(prevColumns);
    }
  }

  const activeTask = activeId
    ? tasks.find((t) => t.id === activeId) ?? null
    : null;

  return (
    <>
      <div className="h-9 px-3 border-b border-[var(--bash-border-subtle)] flex items-center text-[11px] text-[var(--bash-text-muted)] bg-[var(--bash-panel)] shrink-0 gap-2">
        <span>board</span>
        <span className="text-[var(--bash-text-dim)]">
          · {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </span>
        {pendingTransition && (
          <span className="text-[var(--bash-text-dim)]">syncing…</span>
        )}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetectionStrategy}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden flex">
          <SortableContext
            items={columns.map((c) => `column-handle:${c.id}`)}
            strategy={horizontalListSortingStrategy}
          >
            {columns.map((c) => {
              const isRenaming = renamingColumnId === c.id;
              if (isRenaming) {
                return (
                  <div
                    key={c.id}
                    className="w-[240px] shrink-0 flex flex-col border-r border-[var(--bash-border-subtle)]"
                  >
                    <div className="h-8 px-2 flex items-center gap-1.5 border-b border-[var(--bash-border-subtle)]">
                      <input
                        autoFocus
                        defaultValue={c.name}
                        onBlur={(e) => handleRenameColumn(c.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleRenameColumn(c.id, e.currentTarget.value);
                          } else if (e.key === "Escape") {
                            setRenamingColumnId(null);
                          }
                        }}
                        className="flex-1 bg-[var(--bash-card)] border border-[var(--bash-border)] rounded-[2px] px-1.5 py-0.5 text-[12px] text-[var(--bash-text)] outline-none"
                      />
                    </div>
                    <div className="flex-1" />
                  </div>
                );
              }
              return (
                <BoardColumn
                  key={c.id}
                  column={c}
                  tasks={tasksByColumn.get(c.id) ?? []}
                  onAddTask={openCreateTask}
                  onSelectTask={openEditTask}
                  onOpenMenu={(col) => setMenuColumn(col)}
                />
              );
            })}
          </SortableContext>

          <div className="w-[180px] shrink-0 p-2">
            {addingColumn ? (
              <div className="rounded-[3px] border border-[var(--bash-border)] bg-[var(--bash-card)] p-2 flex flex-col gap-2">
                <input
                  autoFocus
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmitAddColumn();
                    if (e.key === "Escape") {
                      setAddingColumn(false);
                      setNewColumnName("");
                    }
                  }}
                  placeholder="column name"
                  className="bg-[var(--bash-panel)] border border-[var(--bash-border)] rounded-[2px] px-1.5 py-0.5 text-[12px] text-[var(--bash-text)] outline-none placeholder:text-[var(--bash-text-dim)]"
                />
                <div className="flex flex-wrap gap-1">
                  {COLOR_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewColumnColor(c)}
                      className={`w-4 h-4 rounded-full border ${
                        newColumnColor === c
                          ? "border-[var(--bash-text)]"
                          : "border-transparent"
                      }`}
                      style={{ background: c }}
                      aria-label={`color ${c}`}
                    />
                  ))}
                </div>
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAddingColumn(false);
                      setNewColumnName("");
                    }}
                    className="text-[10px] text-[var(--bash-text-muted)] hover:text-[var(--bash-text)] px-2 py-1"
                  >
                    cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitAddColumn}
                    className="text-[10px] text-white bg-[var(--bash-accent)] hover:opacity-90 px-2 py-1 rounded-[2px]"
                  >
                    add
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingColumn(true)}
                className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] text-[var(--bash-text-muted)] hover:text-[var(--bash-text)] border border-dashed border-[var(--bash-border-subtle)] hover:border-[var(--bash-border)] rounded-[3px]"
              >
                <Plus className="w-3 h-3" />
                add column
              </button>
            )}
          </div>
        </div>

        <DragOverlay>
          {activeTask ? <BoardCard task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>

      {menuColumn && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setMenuColumn(null)}
        >
          <div
            className="w-[280px] rounded-[3px] bg-[var(--bash-panel)] border border-[var(--bash-border)] p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-[var(--bash-text)] font-medium">
                {menuColumn.name}
              </span>
              <button
                type="button"
                onClick={() => setMenuColumn(null)}
                className="text-[var(--bash-text-muted)] hover:text-[var(--bash-text)]"
                aria-label="close"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setRenamingColumnId(menuColumn.id);
                  setMenuColumn(null);
                }}
                className="text-left text-[11px] text-[var(--bash-text)] hover:bg-[var(--bash-border-subtle)] rounded-[2px] px-2 py-1.5"
              >
                rename
              </button>
              <div>
                <div className="text-[10px] text-[var(--bash-text-muted)] mb-1 px-2">
                  accent color
                </div>
                <div className="flex flex-wrap gap-1 px-2">
                  {COLOR_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        handleChangeColumnColor(menuColumn.id, c);
                        setMenuColumn(null);
                      }}
                      className={`w-4 h-4 rounded-full border ${
                        menuColumn.accent_color === c
                          ? "border-[var(--bash-text)]"
                          : "border-transparent"
                      }`}
                      style={{ background: c }}
                      aria-label={`color ${c}`}
                    />
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDeleteColumn(menuColumn.id)}
                className="text-left text-[11px] text-[var(--bash-urgent)] hover:bg-[var(--bash-urgent)]/10 rounded-[2px] px-2 py-1.5"
              >
                delete column
              </button>
            </div>
          </div>
        </div>
      )}

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        columns={columns}
        task={dialogTask}
        defaultColumnId={dialogColumnId}
      />
    </>
  );
}
