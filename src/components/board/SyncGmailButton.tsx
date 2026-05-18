"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncGmail } from "@/app/board/gmail-sync";

export function SyncGmailButton() {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const { created, skipped } = await syncGmail();
        if (created === 0 && skipped === 0) {
          toast.info("Inbox is empty — nothing to sync.");
          return;
        }
        toast.success(
          `Synced Gmail — created ${created}, skipped ${skipped}.`,
        );
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
