"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

type FlashToasterProps = {
  connected?: string | null;
  error?: string | null;
};

export function FlashToaster({ connected, error }: FlashToasterProps) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (!connected && !error) return;
    fired.current = true;

    if (connected) {
      toast.success(`Connected ${connected}`);
    } else if (error) {
      toast.error(`Connection failed: ${error}`);
    }

    // Clean the query params so a reload doesn't re-fire the toast.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("connected");
      url.searchParams.delete("error");
      window.history.replaceState(null, "", url.toString());
    }
  }, [connected, error]);

  return null;
}
