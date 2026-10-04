import { invoke } from "@tauri-apps/api/core";
import type { ResetSummary } from "@/types";

/** Deletes user-created data across every feature table (tasks, courses,
 * exams, transactions, study/pomodoro sessions, companion history, AI
 * usage log, ...), backs up the database file first, and resets the
 * companion to its original state rather than deleting it. Settings are
 * left untouched unless `alsoResetSettings` is true. */
export function resetSavedData(alsoResetSettings: boolean): Promise<ResetSummary> {
  return invoke("reset_saved_data", { alsoResetSettings });
}

/** Deletes only rows explicitly tagged as demo data (never a guess at
 * what "looks like" demo data). Real data is never touched. */
export function resetDemoData(): Promise<ResetSummary> {
  return invoke("reset_demo_data");
}

/** Inserts a small, clearly-labeled ("[Demo] ...") sample dataset for
 * trying the app out. Fails if demo data already exists — reset it first. */
export function generateDemoData(): Promise<ResetSummary> {
  return invoke("generate_demo_data");
}
