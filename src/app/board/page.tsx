import { redirect } from "next/navigation";
import { Board } from "@/components/board/Board";
import { SyncGmailButton } from "@/components/board/SyncGmailButton";
import { createClient } from "@/lib/supabase/server";
import { listTasks, seedIfEmpty } from "./actions";

export default async function BoardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  await seedIfEmpty();
  const tasks = await listTasks();

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <header className="px-6 py-4 border-b flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Bash OS</h1>
        <div className="flex items-center gap-3">
          <SyncGmailButton />
          <span className="text-sm text-muted-foreground truncate max-w-[40ch]">
            {user.email}
          </span>
        </div>
      </header>
      <Board initialTasks={tasks} />
    </main>
  );
}
