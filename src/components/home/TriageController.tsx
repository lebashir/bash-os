"use client";

import { useEffect, useState } from "react";
import { TriageModal } from "@/components/home/TriageModal";

// Listens for the `bash-os:open-triage` CustomEvent (dispatched from the
// BriefPanel attention bars) and shows TriageModal. Keeping the controller
// at the top level of the homepage means any panel can request triage
// without prop drilling.
export function TriageController() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handler() {
      setOpen(true);
    }
    window.addEventListener("bash-os:open-triage", handler);
    return () => window.removeEventListener("bash-os:open-triage", handler);
  }, []);

  return <TriageModal open={open} onOpenChange={setOpen} />;
}
