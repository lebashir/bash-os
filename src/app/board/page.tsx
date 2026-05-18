import { redirect } from "next/navigation";
import { AccountMenu } from "@/components/board/AccountMenu";
import { Board } from "@/components/board/Board";
import { FlashToaster } from "@/components/board/FlashToaster";
import { SyncGmailButton } from "@/components/board/SyncGmailButton";
import { createClient } from "@/lib/supabase/server";
import { listTasks, seedIfEmpty } from "./actions";
import { listConnectedAccounts } from "./connectors";

type BoardPageProps = {
  searchParams: Promise<{ connected?: string; error?: string }>;
};

export default async function BoardPage({ searchParams }: BoardPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  await seedIfEmpty();
  const [tasks, accounts, flash] = await Promise.all([
    listTasks(),
    listConnectedAccounts(),
    searchParams,
  ]);

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <header className="px-6 py-4 border-b flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Bash OS</h1>
        <div className="flex items-center gap-3">
          <SyncGmailButton />
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
