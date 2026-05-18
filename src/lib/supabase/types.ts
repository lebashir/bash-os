export const TASK_STATUSES = [
  "things to think about",
  "on the menu",
  "todays plate",
  "Bash work",
  "Claude work",
  "Boss Check",
  "DIgested.",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_SOURCES = [
  "manual",
  "gmail",
  "calendar",
  "slack",
  "jira",
  "clickup",
] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export type Task = {
  id: string;
  user_id: string;
  title: string;
  status: TaskStatus;
  source: TaskSource;
  source_account: string | null;
  source_id: string | null;
  description: string | null;
  priority: TaskPriority | null;
  due_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type TaskInsert = Omit<Task, "id" | "created_at" | "updated_at">;

export const CONNECTOR_PROVIDERS = ["google"] as const;
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

export type ConnectorToken = {
  id: string;
  user_id: string;
  provider: ConnectorProvider;
  account_email: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string[];
  created_at: string;
  updated_at: string;
};

export type Memory = {
  id: string;
  user_id: string;
  content: string;
  embedding: number[] | null;
  tags: string[];
  created_at: string;
};

export const CHAT_ROLES = ["user", "assistant"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export type ChatMessage = {
  id: string;
  user_id: string;
  role: ChatRole;
  content: string;
  created_at: string;
};

export type Brief = {
  id: string;
  user_id: string;
  brief_date: string;
  content: string;
  created_at: string;
  updated_at: string;
};
