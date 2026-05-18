"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncAll, type SyncAllResult } from "@/app/board/sync-all";

export function SyncButton() {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const result = await syncAll();
        showResultToast(result);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Sync failed");
      }
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={pending}
      aria-busy={pending}
    >
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      {pending ? "Syncing…" : "Sync now"}
    </Button>
  );
}

function showResultToast({ gmail, calendar }: SyncAllResult) {
  const lines: string[] = [];
  const failures: string[] = [];

  if ("error" in gmail) {
    failures.push(`Gmail: ${gmail.error}`);
  } else {
    lines.push(
      `Gmail: +${gmail.totalCreated} / skip ${gmail.totalSkipped}`,
    );
    for (const r of gmail.perAccount) {
      if (r.error) failures.push(`Gmail (${r.accountEmail}): ${r.error}`);
    }
  }

  if ("error" in calendar) {
    failures.push(`Calendar: ${calendar.error}`);
  } else {
    lines.push(
      `Calendar: +${calendar.totalCreated} / skip ${calendar.totalSkipped}`,
    );
    for (const r of calendar.perAccount) {
      if (r.error) failures.push(`Calendar (${r.accountEmail}): ${r.error}`);
    }
  }

  const summary = lines.join("\n");

  if (failures.length === 0) {
    const gmailCreated = "totalCreated" in gmail ? gmail.totalCreated : 0;
    const calCreated = "totalCreated" in calendar ? calendar.totalCreated : 0;
    if (gmailCreated === 0 && calCreated === 0) {
      toast.info("Nothing new to pull in.", { description: summary });
      return;
    }
    toast.success(`Synced — +${gmailCreated + calCreated} new`, {
      description: summary,
    });
    return;
  }

  toast.error(`Some sources failed (${failures.length})`, {
    description: `${summary}\n\nErrors:\n${failures.join("\n")}`,
  });
}
