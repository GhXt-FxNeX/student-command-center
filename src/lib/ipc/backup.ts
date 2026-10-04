import { invoke } from "@tauri-apps/api/core";
import type { BackupExportResult, BackupImportResult, BackupInfo, BackupSizeEstimate } from "@/types";

export function getBackupSizeEstimate(): Promise<BackupSizeEstimate> {
  return invoke("get_backup_size_estimate");
}

export function exportBackup(destPath: string, includeJournalVideos: boolean): Promise<BackupExportResult> {
  return invoke("export_backup", { destPath, includeJournalVideos });
}

/** Reads a backup's manifest without changing anything; rejects with a readable reason if it can't be restored. */
export function inspectBackup(path: string): Promise<BackupInfo> {
  return invoke("inspect_backup", { path });
}

/** REPLACES all current data with the backup's. Rolls back and rejects if anything goes wrong. */
export function importBackup(path: string): Promise<BackupImportResult> {
  return invoke("import_backup", { path });
}
