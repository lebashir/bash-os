import { redirect } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { FlashToaster } from "@/components/board/FlashToaster";
import { AgentActivityPanel } from "@/components/home/AgentActivityPanel";
import { BoardPanel } from "@/components/home/BoardPanel";
import { BriefPanel } from "@/components/home/BriefPanel";
import { CommandBar } from "@/components/home/CommandBar";
import { HomeHeader } from "@/components/home/HomeHeader";
import { HomeShell } from "@/components/home/HomeShell";
import { TimelinePanel } from "@/components/home/TimelinePanel";
import { listTasks } from "@/app/board/actions";
import { listAgentEvents } from "@/app/board/agent-events";
import { getBriefState } from "@/app/board/brief-state";
import { listChatUIMessages } from "@/app/board/command-actions";
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
    chatHistory,
    agentEvents,
    flash,
  ] = await Promise.all([
    listConnectedAccounts(),
    getBriefState(),
    getTimelineEvents(),
    listColumns(),
    listTasks(),
    listChatUIMessages(),
    listAgentEvents(),
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
      agentActivity={<AgentActivityPanel initialEvents={agentEvents} />}
      context={
        <>
          <PanelTitle>context</PanelTitle>
          <PanelPlaceholder note="context panel lands in later phases — selected task details, chat history, snoozed items." />
        </>
      }
      commandBar={<CommandBar initialMessages={chatHistory} />}
    />
    <Toaster richColors position="bottom-right" />
    <FlashToaster connected={flash.connected} error={flash.error} />
    </>
  );
}
