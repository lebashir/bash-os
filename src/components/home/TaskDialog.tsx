"use client";

import { useEffect, useState, useTransition } from "react";
import { Bot, User, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createTask,
  deleteTask,
  updateTask,
  type TaskFormInput,
} from "@/app/board/actions";
import {
  TASK_OWNERS,
  TASK_PRIORITIES,
  type Column,
  type Task,
  type TaskOwner,
  type TaskPriority,
} from "@/lib/supabase/types";

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: Column[];
  task: Task | null;
  defaultColumnId: string | null;
}

interface FormState {
  title: string;
  description: string;
  column_id: string;
  owner: TaskOwner;
  priority: TaskPriority | "";
  due_date: string;
  tags: string[];
  tagInput: string;
}

function initialState(
  task: Task | null,
  defaultColumnId: string,
): FormState {
  if (task) {
    return {
      title: task.title,
      description: task.description ?? "",
      column_id: task.column_id,
      owner: task.owner,
      priority: task.priority ?? "",
      due_date: task.due_date ? task.due_date.slice(0, 16) : "",
      tags: task.tags,
      tagInput: "",
    };
  }
  return {
    title: "",
    description: "",
    column_id: defaultColumnId,
    owner: "bash",
    priority: "",
    due_date: "",
    tags: [],
    tagInput: "",
  };
}

export function TaskDialog({
  open,
  onOpenChange,
  columns,
  task,
  defaultColumnId,
}: TaskDialogProps) {
  const fallbackColumnId = defaultColumnId ?? columns[0]?.id ?? "";
  const [state, setState] = useState<FormState>(() =>
    initialState(task, fallbackColumnId),
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setState(initialState(task, fallbackColumnId));
    }
  }, [open, task, fallbackColumnId]);

  const isEdit = task !== null;

  function addTag() {
    const value = state.tagInput.trim().toLowerCase();
    if (!value) return;
    if (state.tags.includes(value)) {
      setState((s) => ({ ...s, tagInput: "" }));
      return;
    }
    setState((s) => ({
      ...s,
      tags: [...s.tags, value].slice(0, 20),
      tagInput: "",
    }));
  }

  function removeTag(tag: string) {
    setState((s) => ({ ...s, tags: s.tags.filter((t) => t !== tag) }));
  }

  function handleSubmit() {
    const trimmedTitle = state.title.trim();
    if (!trimmedTitle) {
      toast.error("title is required");
      return;
    }
    if (!state.column_id) {
      toast.error("pick a column");
      return;
    }
    const input: TaskFormInput = {
      title: trimmedTitle,
      description: state.description.trim() || undefined,
      column_id: state.column_id,
      owner: state.owner,
      priority: state.priority === "" ? undefined : state.priority,
      due_date: state.due_date || undefined,
      tags: state.tags,
    };

    startTransition(async () => {
      try {
        if (isEdit && task) {
          await updateTask(task.id, input);
          toast.success("task updated");
        } else {
          await createTask(input);
          toast.success("task created");
        }
        onOpenChange(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "save failed");
      }
    });
  }

  function handleDelete() {
    if (!task) return;
    if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    startTransition(async () => {
      try {
        await deleteTask(task.id);
        toast.success("task deleted");
        onOpenChange(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "delete failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bash-panel)] border-[var(--bash-border)] text-[var(--bash-text)] max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[13px] font-medium">
            {isEdit ? "edit task" : "new task"}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--bash-text-muted)]">
            {isEdit
              ? "update title, column, owner, priority, due date, or tags."
              : "capture a task. defaults to bash owner, no priority, no due date."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 mt-1">
          <div>
            <Label htmlFor="title" className="text-[11px] text-[var(--bash-text-muted)]">
              title
            </Label>
            <Input
              id="title"
              autoFocus
              value={state.title}
              onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
              className="mt-1 bg-[var(--bash-card)] border-[var(--bash-border)] text-[12px] h-8"
            />
          </div>

          <div>
            <Label
              htmlFor="description"
              className="text-[11px] text-[var(--bash-text-muted)]"
            >
              description
            </Label>
            <Textarea
              id="description"
              value={state.description}
              onChange={(e) =>
                setState((s) => ({ ...s, description: e.target.value }))
              }
              rows={3}
              className="mt-1 bg-[var(--bash-card)] border-[var(--bash-border)] text-[12px] resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] text-[var(--bash-text-muted)]">column</Label>
              <Select
                value={state.column_id}
                onValueChange={(v) => {
                  if (typeof v === "string" && v) {
                    setState((s) => ({ ...s, column_id: v }));
                  }
                }}
              >
                <SelectTrigger className="mt-1 bg-[var(--bash-card)] border-[var(--bash-border)] text-[12px] h-8">
                  <SelectValue placeholder="column" />
                </SelectTrigger>
                <SelectContent className="bg-[var(--bash-panel)] border-[var(--bash-border)]">
                  {columns.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-[12px]">
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] text-[var(--bash-text-muted)]">owner</Label>
              <div className="mt-1 grid grid-cols-2 gap-1 p-0.5 rounded-[3px] bg-[var(--bash-card)] border border-[var(--bash-border)]">
                {TASK_OWNERS.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setState((s) => ({ ...s, owner: o }))}
                    className={`flex items-center justify-center gap-1 h-7 text-[11px] rounded-[2px] transition-colors ${
                      state.owner === o
                        ? o === "claude"
                          ? "bg-[var(--bash-owner-claude)]/15 text-[var(--bash-owner-claude)]"
                          : "bg-[var(--bash-border-subtle)] text-[var(--bash-text)]"
                        : "text-[var(--bash-text-muted)] hover:text-[var(--bash-text)]"
                    }`}
                  >
                    {o === "claude" ? (
                      <Bot className="w-3 h-3" />
                    ) : (
                      <User className="w-3 h-3" />
                    )}
                    {o}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] text-[var(--bash-text-muted)]">
                priority
              </Label>
              <Select
                value={state.priority}
                onValueChange={(v) => {
                  const next: TaskPriority | "" =
                    v === null || v === undefined || (v as string) === "none"
                      ? ""
                      : (v as TaskPriority);
                  setState((s) => ({ ...s, priority: next }));
                }}
              >
                <SelectTrigger className="mt-1 bg-[var(--bash-card)] border-[var(--bash-border)] text-[12px] h-8">
                  <SelectValue placeholder="none" />
                </SelectTrigger>
                <SelectContent className="bg-[var(--bash-panel)] border-[var(--bash-border)]">
                  <SelectItem value="none" className="text-[12px]">
                    none
                  </SelectItem>
                  {TASK_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p} className="text-[12px]">
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label
                htmlFor="due-date"
                className="text-[11px] text-[var(--bash-text-muted)]"
              >
                due
              </Label>
              <Input
                id="due-date"
                type="datetime-local"
                value={state.due_date}
                onChange={(e) =>
                  setState((s) => ({ ...s, due_date: e.target.value }))
                }
                className="mt-1 bg-[var(--bash-card)] border-[var(--bash-border)] text-[12px] h-8"
              />
            </div>
          </div>

          <div>
            <Label className="text-[11px] text-[var(--bash-text-muted)]">tags</Label>
            <div className="mt-1 flex flex-wrap gap-1 p-1.5 rounded-[3px] bg-[var(--bash-card)] border border-[var(--bash-border)]">
              {state.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-[2px] bg-[var(--bash-border-subtle)] text-[var(--bash-text-muted)]"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="hover:text-[var(--bash-text)]"
                    aria-label={`remove tag ${tag}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
              <input
                value={state.tagInput}
                onChange={(e) =>
                  setState((s) => ({ ...s, tagInput: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  } else if (
                    e.key === "Backspace" &&
                    state.tagInput === "" &&
                    state.tags.length > 0
                  ) {
                    setState((s) => ({
                      ...s,
                      tags: s.tags.slice(0, -1),
                    }));
                  }
                }}
                placeholder={state.tags.length === 0 ? "type and press enter" : ""}
                className="flex-1 min-w-[120px] bg-transparent text-[11px] outline-none text-[var(--bash-text)] placeholder:text-[var(--bash-text-dim)]"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--bash-border-subtle)]">
          <div>
            {isEdit && (
              <button
                type="button"
                disabled={pending}
                onClick={handleDelete}
                className="text-[11px] text-[var(--bash-urgent)] hover:underline disabled:opacity-50"
              >
                delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => onOpenChange(false)}
              className="px-2 py-1 text-[11px] text-[var(--bash-text-muted)] hover:text-[var(--bash-text)] disabled:opacity-50"
            >
              cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={handleSubmit}
              className="px-3 py-1 text-[11px] rounded-[3px] bg-[var(--bash-accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "saving…" : isEdit ? "save" : "create"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
