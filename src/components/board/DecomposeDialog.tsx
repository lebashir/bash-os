"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
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
  createDecomposedChildren,
  decomposeTask,
  type ProposedChild,
} from "@/app/board/decompose-actions";
import type { Task } from "@/lib/supabase/types";

type DecomposeDialogProps = {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (children: Task[]) => void;
};

const CHILD_STATUSES: ProposedChild["status"][] = [
  "Bash work",
  "Claude work",
  "Boss Check",
];

type EditableChild = ProposedChild & { selected: boolean };

export function DecomposeDialog({
  task,
  open,
  onOpenChange,
  onCreated,
}: DecomposeDialogProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [children, setChildren] = useState<EditableChild[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setChildren([]);

    decomposeTask(task.id)
      .then((result) => {
        if (cancelled) return;
        setChildren(
          result.proposedChildren.map((c) => ({ ...c, selected: true })),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Decomposition failed",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, task.id]);

  function patchChild(index: number, patch: Partial<EditableChild>) {
    setChildren((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  }

  function handleSubmit() {
    const selected = children.filter((c) => c.selected);
    if (selected.length === 0) {
      toast.error("Select at least one child to create");
      return;
    }
    startTransition(async () => {
      try {
        const created = await createDecomposedChildren({
          parentId: task.id,
          children: selected.map((c) => ({
            title: c.title,
            description: c.description,
            status: c.status,
            priority: null,
          })),
        });
        onCreated(created);
        toast.success(`Created ${created.length} sub-task${created.length === 1 ? "" : "s"}`);
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Create failed");
      }
    });
  }

  const selectedCount = children.filter((c) => c.selected).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Break it down</DialogTitle>
          <DialogDescription>
            Proposed sub-tasks for &ldquo;{task.title}&rdquo;. Edit, deselect, or
            cancel before creating.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
            <Loader2 className="size-4 animate-spin" />
            <span>Proposing sub-tasks…</span>
          </div>
        ) : loadError ? (
          <div className="text-sm text-destructive py-4">{loadError}</div>
        ) : (
          <div className="grid gap-3 max-h-[60vh] overflow-y-auto pr-1">
            {children.map((child, i) => (
              <div
                key={i}
                className={`rounded-md border p-3 space-y-2 ${
                  child.selected ? "bg-card" : "bg-muted/40 opacity-60"
                }`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={child.selected}
                    onChange={(e) =>
                      patchChild(i, { selected: e.target.checked })
                    }
                    className="mt-1.5"
                    aria-label={`Include sub-task ${i + 1}`}
                  />
                  <div className="flex-1 grid gap-2">
                    <div className="grid gap-1">
                      <Label htmlFor={`title-${i}`} className="text-xs">
                        Title
                      </Label>
                      <Input
                        id={`title-${i}`}
                        value={child.title}
                        onChange={(e) => patchChild(i, { title: e.target.value })}
                        disabled={!child.selected}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`desc-${i}`} className="text-xs">
                        Description
                      </Label>
                      <Textarea
                        id={`desc-${i}`}
                        value={child.description}
                        onChange={(e) =>
                          patchChild(i, { description: e.target.value })
                        }
                        rows={2}
                        disabled={!child.selected}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-1">
                        <Label className="text-xs">Column</Label>
                        <Select
                          value={child.status}
                          onValueChange={(v) =>
                            patchChild(i, {
                              status: v as ProposedChild["status"],
                            })
                          }
                          disabled={!child.selected}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CHILD_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="text-xs text-muted-foreground self-end pb-2">
                        {child.rationale}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={pending || loading || selectedCount === 0}
          >
            {pending
              ? "Creating…"
              : `Create ${selectedCount} sub-task${selectedCount === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
