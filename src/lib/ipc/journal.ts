import { invoke } from "@tauri-apps/api/core";
import type { JournalEntryDetail, JournalEntrySummary, JournalStatus } from "@/types";

export function getJournalStatus(): Promise<JournalStatus> {
  return invoke("journal_status");
}

export function setupJournalPassword(password: string): Promise<void> {
  return invoke("journal_setup_password", { password });
}

export function unlockJournal(password: string): Promise<void> {
  return invoke("journal_unlock", { password });
}

export function lockJournal(): Promise<void> {
  return invoke("journal_lock");
}

export function setJournalAutoLock(minutes: number): Promise<void> {
  return invoke("journal_set_auto_lock", { minutes });
}

export function changeJournalPassword(currentPassword: string, newPassword: string): Promise<void> {
  return invoke("journal_change_password", { currentPassword, newPassword });
}

export function listJournalEntries(): Promise<JournalEntrySummary[]> {
  return invoke("journal_list_entries");
}

export function getJournalEntry(id: number): Promise<JournalEntryDetail> {
  return invoke("journal_get_entry", { id });
}

export function saveJournalEntry(params: {
  entryDate: string;
  title: string | null;
  note: string | null;
  videoBase64: string;
  videoMimeType: string;
  durationSeconds: number;
}): Promise<JournalEntrySummary> {
  return invoke("journal_save_entry", params);
}

export function updateJournalEntryMeta(id: number, title: string | null, note: string | null): Promise<void> {
  return invoke("journal_update_entry_meta", { id, title, note });
}

export function deleteJournalEntry(id: number): Promise<void> {
  return invoke("journal_delete_entry", { id });
}

export function deleteAllJournalData(): Promise<void> {
  return invoke("journal_delete_all");
}

export function getJournalStorageUsage(): Promise<number> {
  return invoke("journal_storage_usage");
}
