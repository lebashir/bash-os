"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/supabase/types";
import {
  createTask,
  deleteTask,
  updateTask,
  type TaskFormInput,
} from "@/app/board/actions";

type CreateProps = {
  mode: "create";
  defaultStatus: TaskStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (task: Task) => void;
};

type EditProps = {
  mode: "edit";
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (task: Task) => void;
  onDeleted: (id: string) => void;
};

type TaskDialogProps = CreateProps | EditProps;

const NONE = "__none__";

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function TaskDialog(props: TaskDialogProps) {
  const isEdit = props.mode === "edit";
  const initial = isEdit ? props.task : null;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(
    isEdit ? props.task.status : props.defaultStatus,
  );
  const [priority, setPriority] = useState<TaskPriority | "">(
    initial?.priority ?? "",
  );
  const [dueDate, setDueDate] = useState(toDatetimeLocal(initial?.due_date ?? null));
  const [sourceId, setSourceId] = useState(initial?.source_id ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  function buildInput(): TaskFormInput {
    return {
      title,
      description: description || null,
      status,
      priority: priority === "" ? null : priority,
      due_date: dueDate || null,
      source_id: sourceId || null,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }

    startTransition(async () => {
      try {
        if (isEdit) {
          const updated = await updateTask(props.task.id, buildInput());
          props.onUpdated(updated);
          toast.success("Saved");
        } else {
          const created = await createTask(buildInput());
          props.onCreated(created);
          toast.success("Added");
        }
        props.onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  function handleDelete() {
    if (!isEdit) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      try {
        await deleteTask(props.task.id);
        props.onDeleted(props.task.id);
        toast.success("Deleted");
        props.onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit task" : "New task"}</DialogTitle>
            <DialogDescription>
              {isEdit ? "Update or delete this card." : "Add a new card to the board."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as TaskStatus)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label>Priority</Label>
                <Select
                  value={priority === "" ? NONE : priority}
                  onValueChange={(v) =>
                    setPriority(v === NONE ? "" : (v as TaskPriority))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>none</SelectItem>
                    {TASK_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="due_date">Due</Label>
                <Input
                  id="due_date"
                  type="datetime-local"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="source_id">Source ID</Label>
                <Input
                  id="source_id"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  placeholder="optional"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="flex sm:justify-between gap-2">
            {isEdit ? (
              <Button
                type="button"
                variant={confirmDelete ? "destructive" : "ghost"}
                onClick={handleDelete}
                disabled={pending}
              >
                {confirmDelete ? "Click again to confirm" : "Delete"}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => props.onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {isEdit ? "Save" : "Add"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
