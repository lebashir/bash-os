"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  syncGmailForUser,
  type SyncGmailOptions,
  type SyncGmailResult,
} from "@/lib/board/gmail-sync";

export type { SyncGmailResult, SyncGmailAccountResult } from "@/lib/board/gmail-sync";

export async function syncGmail(
  options: SyncGmailOptions = {},
): Promise<SyncGmailResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }

  const result = await syncGmailForUser(supabase, user.id, options);
  if (result.totalCreated > 0) {
    revalidatePath("/board");
  }
  return result;
}
