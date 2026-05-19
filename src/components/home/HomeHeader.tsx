import { AccountMenu } from "@/components/board/AccountMenu";
import type { ConnectedAccount } from "@/app/board/connectors";
import type { ConnectorPill } from "@/lib/board/connector-status";

interface HomeHeaderProps {
  userEmail: string;
  accounts: ConnectedAccount[];
  pills: ConnectorPill[];
}

const PILL_DOT_CLASS: Record<ConnectorPill["status"], string> = {
  connected: "bg-[var(--bash-success)]",
  unconfigured: "bg-[var(--bash-text-dim)]",
  error: "bg-[var(--bash-urgent)]",
};

export function HomeHeader({ userEmail, accounts, pills }: HomeHeaderProps) {
  return (
    <header className="h-10 px-3 border-b border-[var(--bash-border-subtle)] flex items-center justify-between gap-3 bg-[var(--bash-panel)] shrink-0">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-[3px] bg-[var(--bash-accent)] flex items-center justify-center text-[10px] font-medium text-white">
          b
        </div>
        <span className="text-[13px] text-[var(--bash-text)] font-medium tracking-tight">
          bash os
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {pills.map((pill) => (
            <span
              key={pill.key}
              className="flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-[var(--bash-text-muted)] border border-[var(--bash-border-subtle)] rounded-[3px]"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${PILL_DOT_CLASS[pill.status]}`}
                aria-label={`${pill.label} ${pill.status}`}
              />
              {pill.label}
            </span>
          ))}
        </div>
        <AccountMenu userEmail={userEmail} accounts={accounts} />
      </div>
    </header>
  );
}
