"use client";

import { useTransition } from "react";
import { ChevronDown, LogOut, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/app/login/actions";
import {
  disconnectAccount,
  type ConnectedAccount,
} from "@/app/board/connectors";

type AccountMenuProps = {
  userEmail: string;
  accounts: ConnectedAccount[];
};

export function AccountMenu({ userEmail, accounts }: AccountMenuProps) {
  const [pending, startTransition] = useTransition();

  function handleDisconnect(account: ConnectedAccount) {
    startTransition(async () => {
      try {
        await disconnectAccount(account.provider, account.accountEmail);
        toast.success(`Disconnected ${account.accountEmail}`);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Disconnect failed",
        );
      }
    });
  }

  function handleSignOut() {
    startTransition(async () => {
      try {
        await signOut();
      } catch (error) {
        // signOut() ends in redirect(), which Next surfaces as a thrown
        // NEXT_REDIRECT — that's the success path, not an error to toast.
        if (
          error instanceof Error &&
          error.message.includes("NEXT_REDIRECT")
        ) {
          return;
        }
        toast.error(error instanceof Error ? error.message : "Sign out failed");
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none"
        disabled={pending}
      >
        <span className="truncate max-w-[28ch]">{userEmail}</span>
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Signed in</DropdownMenuLabel>
          <DropdownMenuItem
            disabled
            className="opacity-100 data-disabled:opacity-100"
          >
            <span className="truncate">{userEmail}</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Connected Google accounts</DropdownMenuLabel>
          {accounts.length === 0 ? (
            <DropdownMenuItem disabled>
              <span className="text-muted-foreground">None yet</span>
            </DropdownMenuItem>
          ) : (
            accounts.map((account) => (
              <DropdownMenuItem
                key={`${account.provider}:${account.accountEmail}`}
                onClick={(event) => {
                  event.preventDefault();
                  handleDisconnect(account);
                }}
                className="justify-between"
              >
                <span className="truncate">{account.accountEmail}</span>
                <Trash2 className="ml-2 size-3.5 text-muted-foreground" />
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<a href="/connectors/google/connect" />}>
          <Plus />
          <span>Connect Gmail account</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
          <LogOut />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
