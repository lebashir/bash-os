"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ConnectorProvider } from "@/lib/supabase/types";

export type ConnectedAccount = {
  provider: ConnectorProvider;
  accountEmail: string;
  scopes: string[];
};

export async function listConnectedAccounts(): Promise<ConnectedAccount[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("connector_tokens")
    .select("provider, account_email, scopes")
    .eq("user_id", user.id)
    .not("account_email", "is", null)
    .order("provider", { ascending: true })
    .order("account_email", { ascending: true });

  if (error) {
    throw new Error(`Failed to list connected accounts: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    provider: row.provider as ConnectorProvider,
    accountEmail: row.account_email as string,
    scopes: (row.scopes ?? []) as string[],
  }));
}

export async function disconnectAccount(
  provider: ConnectorProvider,
  accountEmail: string,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }

  const { error } = await supabase
    .from("connector_tokens")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", provider)
    .eq("account_email", accountEmail);

  if (error) {
    throw new Error(`Failed to disconnect ${accountEmail}: ${error.message}`);
  }

  revalidatePath("/");
}
