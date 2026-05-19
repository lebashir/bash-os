import type { ReactNode } from "react";

interface HomeShellProps {
  header: ReactNode;
  brief: ReactNode;
  timeline: ReactNode;
  board: ReactNode;
  agentActivity: ReactNode;
  context: ReactNode;
  commandBar: ReactNode;
}

// Three-panel + bottom-command-bar layout shell. The header lives above the
// three panels; the command bar sits in its own row at the bottom. Panel
// widths come from the R3.5 spec: 22% / 56% / 22%. The middle panel scrolls
// horizontally when extra user-added columns overflow.
export function HomeShell({
  header,
  brief,
  timeline,
  board,
  agentActivity,
  context,
  commandBar,
}: HomeShellProps) {
  return (
    <div className="h-screen flex flex-col bg-[var(--background)] text-[var(--bash-text)] overflow-hidden">
      {header}
      <div className="flex-1 flex min-h-0">
        <aside
          className="w-[22%] min-w-[260px] border-r border-[var(--bash-border-subtle)] bg-[var(--bash-panel)] flex flex-col min-h-0"
          aria-label="brief and timeline"
        >
          <section className="flex-shrink-0 border-b border-[var(--bash-border-subtle)]">
            {brief}
          </section>
          <section className="flex-1 min-h-0 overflow-y-auto">{timeline}</section>
        </aside>
        <main
          className="w-[56%] flex-1 bg-[var(--background)] flex flex-col min-h-0"
          aria-label="board"
        >
          {board}
        </main>
        <aside
          className="w-[22%] min-w-[260px] border-l border-[var(--bash-border-subtle)] bg-[var(--bash-panel)] flex flex-col min-h-0"
          aria-label="agent activity and context"
        >
          <section className="flex-shrink-0 border-b border-[var(--bash-border-subtle)] max-h-[55%] overflow-y-auto">
            {agentActivity}
          </section>
          <section className="flex-1 min-h-0 overflow-y-auto">{context}</section>
        </aside>
      </div>
      {commandBar}
    </div>
  );
}
