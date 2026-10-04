import { invoke } from "@tauri-apps/api/core";
import type { NewTask, Task } from "@/types";

/**
 * All calls into Rust go through this file (and its siblings in lib/ipc/) —
 * React components never call `invoke` directly, and never talk to SQLite
 * or an AI provider themselves. Keeps the IPC surface typed and centralized.
 */

export function listTasks(): Promise<Task[]> {
  return invoke("list_tasks");
}

export function createTask(task: NewTask): Promise<Task> {
  return invoke("create_task", { task });
}

export function updateTask(id: number, task: NewTask): Promise<Task> {
  return invoke("update_task", { id, task });
}

export function setTaskStatus(id: number, status: Task["status"]): Promise<Task> {
  return invoke("set_task_status", { id, status });
}

export function deleteTask(id: number): Promise<void> {
  return invoke("delete_task", { id });
}

export function duplicateTask(id: number): Promise<Task> {
  return invoke("duplicate_task", { id });
}
