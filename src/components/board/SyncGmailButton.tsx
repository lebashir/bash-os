"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  syncGmail,
  type SyncGmailResult,
} from "@/app/board/gmail-sync";

export function SyncGmailButton() {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const result = await syncGmail();
        showResultToast(result);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Gmail sync failed",
        );
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
      {pending ? "Syncing…" : "Sync Gmail"}
    </Button>
  );
}

function showResultToast(result: SyncGmailResult) {
  const failures = result.perAccount.filter((r) => r.error);
  const summary = result.perAccount
    .filter((r) => !r.error)
    .map((r) => `${r.accountEmail}: +${r.created} / skip ${r.skipped}`)
    .join("\n");

  if (failures.length === 0) {
    if (result.totalCreated === 0 && result.totalSkipped === 0) {
      toast.info("Inbox is empty — nothing to sync.");
      return;
    }
    toast.success(
      `Synced Gmail — +${result.totalCreated}, skipped ${result.totalSkipped}`,
      { description: summary || undefined },
    );
    return;
  }

  const errorSummary = failures
    .map((r) => `${r.accountEmail}: ${r.error}`)
    .join("\n");
  toast.error(
    `Some accounts failed (${failures.length}/${result.perAccount.length})`,
    {
      description: summary
        ? `${summary}\n\nErrors:\n${errorSummary}`
        : `Errors:\n${errorSummary}`,
    },
  );
}
