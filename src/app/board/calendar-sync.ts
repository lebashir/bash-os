"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  syncCalendarForUser,
  type SyncCalendarResult,
} from "@/lib/board/calendar-sync";

export type {
  SyncCalendarResult,
  SyncCalendarAccountResult,
} from "@/lib/board/calendar-sync";

export async function syncCalendar(): Promise<SyncCalendarResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }

  const result = await syncCalendarForUser(supabase, user.id);
  if (result.totalCreated > 0) {
    revalidatePath("/");
  }
  return result;
}
