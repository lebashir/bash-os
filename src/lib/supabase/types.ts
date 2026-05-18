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

export type Task = {
  id: string;
  user_id: string;
  title: string;
  status: TaskStatus;
  source_id: string | null;
  description: string | null;
  priority: TaskPriority | null;
  due_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type TaskInsert = Omit<Task, "id" | "created_at" | "updated_at">;

export type Memory = {
  id: string;
  user_id: string;
  content: string;
  embedding: number[] | null;
  tags: string[];
  created_at: string;
};
