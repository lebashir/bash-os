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

export const TASK_OWNERS = ["bash", "claude"] as const;
export type TaskOwner = (typeof TASK_OWNERS)[number];

export type Task = {
  id: string;
  user_id: string;
  title: string;
  column_id: string;
  owner: TaskOwner;
  source: TaskSource;
  source_account: string | null;
  source_id: string | null;
  description: string | null;
  priority: TaskPriority | null;
  due_date: string | null;
  position: number;
  importance: number | null;
  parent_id: string | null;
  needs_review: boolean;
  tags: string[];
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskInsert = Omit<Task, "id" | "created_at" | "updated_at">;

export type Column = {
  id: string;
  user_id: string;
  name: string;
  position: number;
  icon: string | null;
  accent_color: string | null;
  is_default: boolean;
  created_at: string;
};

export const RECURRENCE_CADENCES = [
  "daily",
  "weekly",
  "monthly",
  "annually",
  "custom",
] as const;
export type RecurrenceCadence = (typeof RECURRENCE_CADENCES)[number];

export type Recurrence = {
  id: string;
  user_id: string;
  template_task_id: string;
  cadence: RecurrenceCadence;
  cron_expression: string | null;
  next_fire_at: string;
  last_fired_at: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type TaskEvent = {
  id: string;
  user_id: string;
  task_id: string | null;
  event_type:
    | "created"
    | "completed"
    | "moved"
    | "updated"
    | "deleted"
    | "importance_set";
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AgentEvent = {
  id: string;
  user_id: string;
  source: string;
  project: string | null;
  action: string;
  target: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

// The live triage surface. staged_emails carries the scorer's full guess
// (band/reason/title/tags) plus the verdict (`decision`) so board calls sync
// back into lifeofbash decisions.jsonl. (The old pending_emails table + its
// PendingEmail type were dropped once local ingestion replaced the in-app sync.)
export type StagedEmail = {
  id: string;
  user_id: string;
  source: string;
  source_account: string;
  source_id: string;
  subject: string;
  sender: string;
  snippet: string | null;
  score: number;
  band: string;
  reason: string | null;
  scorer_title: string | null;
  scorer_tags: string[];
  decision: "pending" | "promoted" | "dropped" | "kept";
  created_at: string;
  decided_at: string | null;
  snoozed_until: string | null;
};

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

// Starter column names seeded for every user. App code that needs to write
// to a "well-known" column (gmail sync → Inbox, jira sync → Active, etc.)
// resolves by name at request time. Renames by the user shouldn't break the
// sync code because the lookup degrades gracefully (see lookupColumnIdByName).
export const STARTER_COLUMNS = [
  "Inbox",
  "Today",
  "Active",
  "Review",
  "Done",
] as const;
export type StarterColumnName = (typeof STARTER_COLUMNS)[number];
