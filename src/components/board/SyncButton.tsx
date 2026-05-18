"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncAll, type SyncAllResult } from "@/app/board/sync-all";

type AnyConnectorResult = SyncAllResult[keyof SyncAllResult];

type PerAccountEntry = {
  accountEmail: string;
  error?: string;
};

type SuccessShape = {
  totalCreated: number;
  totalSkipped: number;
  perAccount: PerAccountEntry[];
};

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

function showResultToast(result: SyncAllResult) {
  const lines: string[] = [];
  const failures: string[] = [];
  let totalCreated = 0;

  for (const [label, outcome] of Object.entries(result)) {
    if (isError(outcome)) {
      failures.push(`${label}: ${outcome.error}`);
      continue;
    }
    if (isSkipped(outcome)) {
      // Don't surface unconfigured connectors as noise.
      continue;
    }
    const success = outcome as SuccessShape;
    lines.push(
      `${label}: +${success.totalCreated} / skip ${success.totalSkipped}`,
    );
    totalCreated += success.totalCreated;
    for (const r of success.perAccount) {
      if (r.error) failures.push(`${label} (${r.accountEmail}): ${r.error}`);
    }
  }

  const summary = lines.join("\n");

  if (failures.length === 0) {
    if (totalCreated === 0) {
      toast.info("Nothing new to pull in.", {
        description: summary || "All configured connectors are up to date.",
      });
      return;
    }
    toast.success(`Synced — +${totalCreated} new`, { description: summary });
    return;
  }

  toast.error(`Some sources failed (${failures.length})`, {
    description: `${summary}\n\nErrors:\n${failures.join("\n")}`,
  });
}

function isError(outcome: AnyConnectorResult): outcome is { error: string } {
  return typeof outcome === "object" && outcome !== null && "error" in outcome;
}

function isSkipped(
  outcome: AnyConnectorResult,
): outcome is { skipped: "not configured" } {
  return (
    typeof outcome === "object" && outcome !== null && "skipped" in outcome
  );
}
