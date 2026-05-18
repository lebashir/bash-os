import { redirect } from "next/navigation";
import { AccountMenu } from "@/components/board/AccountMenu";
import { Board } from "@/components/board/Board";
import { BriefDrawer } from "@/components/board/BriefDrawer";
import { ChatLauncher } from "@/components/board/ChatLauncher";
import { FlashToaster } from "@/components/board/FlashToaster";
import { SyncButton } from "@/components/board/SyncButton";
import { syncGmailForUser } from "@/lib/board/gmail-sync";
import { createClient } from "@/lib/supabase/server";
import { listTasks } from "./actions";
import { listConnectedAccounts } from "./connectors";

type BoardPageProps = {
  searchParams: Promise<{
    connected?: string;
    error?: string;
    show_filtered?: string;
  }>;
};

export default async function BoardPage({ searchParams }: BoardPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const flash = await searchParams;

  // Debug toggle: re-run Gmail sync without the importance filter so the
  // dropped messages surface on the board with a [filtered:N] title prefix.
  // Deliberate side-effect-on-render — single-user dev affordance, no need
  // for a button or separate UI.
  if (flash.show_filtered === "1") {
    try {
      await syncGmailForUser(supabase, user.id, { showFiltered: true });
    } catch (err) {
      console.warn(
        "[board] show_filtered sync failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const [tasks, accounts] = await Promise.all([
    listTasks(),
    listConnectedAccounts(),
  ]);

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <header className="px-6 py-4 border-b flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Bash OS</h1>
        <div className="flex items-center gap-3">
          <SyncButton />
          <BriefDrawer />
          <ChatLauncher />
          <AccountMenu
            userEmail={user.email ?? "(no email)"}
            accounts={accounts}
          />
        </div>
      </header>
      <Board initialTasks={tasks} />
      <FlashToaster connected={flash.connected} error={flash.error} />
    </main>
  );
}
