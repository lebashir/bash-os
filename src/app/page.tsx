import { redirect } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { FlashToaster } from "@/components/board/FlashToaster";
import { BoardPanel } from "@/components/home/BoardPanel";
import { BriefPanel } from "@/components/home/BriefPanel";
import { HomeHeader } from "@/components/home/HomeHeader";
import { HomeShell } from "@/components/home/HomeShell";
import { TimelinePanel } from "@/components/home/TimelinePanel";
import { listTasks } from "@/app/board/actions";
import { getBriefState } from "@/app/board/brief-state";
import { listColumns } from "@/app/board/column-actions";
import { getTimelineEvents } from "@/app/board/timeline";
import { listConnectedAccounts } from "@/app/board/connectors";
import { computeConnectorPills } from "@/lib/board/connector-status";
import { createClient } from "@/lib/supabase/server";

type HomeProps = {
  searchParams: Promise<{
    connected?: string;
    error?: string;
  }>;
};

// Phase-2 placeholder section header. Sentence case, no all-caps.
function PanelTitle({ children }: { children: string }) {
  return (
    <div className="px-3 py-2 text-[11px] text-[var(--bash-text-muted)]">
      {children}
    </div>
  );
}

function PanelPlaceholder({ note }: { note: string }) {
  return (
    <div className="px-3 py-4 text-[11px] text-[var(--bash-text-dim)] leading-[1.4]">
      {note}
    </div>
  );
}

export default async function Home({ searchParams }: HomeProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    accounts,
    briefState,
    timelineEvents,
    columns,
    tasks,
    flash,
  ] = await Promise.all([
    listConnectedAccounts(),
    getBriefState(),
    getTimelineEvents(),
    listColumns(),
    listTasks(),
    searchParams,
  ]);
  const pills = computeConnectorPills(accounts);

  return (
    <>
    <HomeShell
      header={
        <HomeHeader
          userEmail={user.email ?? "(no email)"}
          accounts={accounts}
          pills={pills}
        />
      }
      brief={<BriefPanel state={briefState} />}
      timeline={<TimelinePanel events={timelineEvents} />}
      board={<BoardPanel initialColumns={columns} initialTasks={tasks} />}
      agentActivity={
        <>
          <PanelTitle>agent activity</PanelTitle>
          <PanelPlaceholder note="agent activity feed lands in phase 8 — external + internal events will stream here." />
        </>
      }
      context={
        <>
          <PanelTitle>context</PanelTitle>
          <PanelPlaceholder note="context panel lands in later phases — selected task details, chat history, snoozed items." />
        </>
      }
      commandBar={
        <div className="h-10 border-t border-[var(--bash-border-subtle)] bg-[var(--bash-panel)] flex items-center px-3 gap-2 shrink-0">
          <span className="px-1.5 py-0.5 text-[10px] text-[var(--bash-text-muted)] border border-[var(--bash-border-subtle)] rounded-[3px] font-mono">
            ⌘K
          </span>
          <span className="text-[11px] text-[var(--bash-text-dim)] flex-1">
            command bar lands in phase 7 — type a command, ask the agent, or
            paste to capture.
          </span>
        </div>
      }
    />
    <Toaster richColors position="bottom-right" />
    <FlashToaster connected={flash.connected} error={flash.error} />
    </>
  );
}
