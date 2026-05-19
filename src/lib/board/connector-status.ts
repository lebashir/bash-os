import type { ConnectedAccount } from "@/app/board/connectors";

export type ConnectorKey = "gmail" | "calendar" | "jira" | "slack";

export type ConnectorPillStatus = "connected" | "unconfigured" | "error";

export type ConnectorPill = {
  key: ConnectorKey;
  label: string;
  status: ConnectorPillStatus;
};

// Gmail + Calendar both ride on the same Google OAuth scopes. If the user has
// at least one connected Google account, both pills go green. Jira + Slack are
// env-var driven on this project; we read presence at request time.
export function computeConnectorPills(
  accounts: ConnectedAccount[],
): ConnectorPill[] {
  const hasGoogle = accounts.some((a) => a.provider === "google");
  const hasJira = Boolean(
    process.env.JIRA_BASE_URL &&
      process.env.JIRA_EMAIL &&
      process.env.JIRA_API_TOKEN,
  );
  const hasSlack = Boolean(process.env.SLACK_USER_TOKEN);

  return [
    {
      key: "gmail",
      label: "gmail",
      status: hasGoogle ? "connected" : "unconfigured",
    },
    {
      key: "calendar",
      label: "calendar",
      status: hasGoogle ? "connected" : "unconfigured",
    },
    {
      key: "jira",
      label: "jira",
      status: hasJira ? "connected" : "unconfigured",
    },
    {
      key: "slack",
      label: "slack",
      status: hasSlack ? "connected" : "unconfigured",
    },
  ];
}
