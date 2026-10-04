import { useEffect, useState } from "react";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { Card } from "@/components/Card";
import { Button } from "@/components/ui/Button";
import { Callout, ErrorBanner } from "@/components/ui/Callout";
import { SettingsSectionTitle } from "@/features/settings/SettingsCategoryLayout";
import { formatBytes } from "@/features/journal/journalUtils";
import { toDateKey } from "@/lib/date";
import { exportBackup, getBackupSizeEstimate, importBackup, inspectBackup } from "@/lib/ipc/backup";
import type { BackupExportResult, BackupImportResult, BackupInfo, BackupSizeEstimate } from "@/types";

const FILE_FILTER = [{ name: "Student Command Center backup", extensions: ["sccbackup"] }];

type VideoChoice = "without" | "with" | null;

/** The backup's creation time is UTC "YYYY-MM-DD HH:MM:SS"; show it in the person's own time. */
function formatCreatedAt(utc: string): string {
  const d = new Date(`${utc.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? utc : d.toLocaleString();
}

/**
 * Settings → Data → "Back up your data" and "Restore from a backup".
 *
 * Export writes everything into one file the person keeps anywhere. API keys are
 * never in it. Private journal videos are an explicit choice because they can make
 * the file very large — and the journal is only mentioned at all when there ARE
 * journal videos, so someone glancing at this screen isn't told a private feature
 * exists.
 *
 * Import REPLACES everything. It inspects the file first (nothing changes), shows
 * what is in it and a plain warning, and needs a ticked box before the button works.
 */
export function BackupRestore() {
  const [estimate, setEstimate] = useState<BackupSizeEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  // ---- export ----
  const [choice, setChoice] = useState<VideoChoice>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exported, setExported] = useState<BackupExportResult | null>(null);

  // ---- import ----
  const [importPath, setImportPath] = useState<string | null>(null);
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [importing, setImporting] = useState(false);
  const [restored, setRestored] = useState<BackupImportResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBackupSizeEstimate()
      .then((e) => !cancelled && setEstimate(e))
      .catch((e) => !cancelled && setEstimateError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  // After a successful restore everything the app holds in memory is stale, so it
  // reloads — after a few seconds, so the result below can actually be read.
  useEffect(() => {
    if (!restored) return;
    const t = window.setTimeout(() => window.location.reload(), 8000);
    return () => window.clearTimeout(t);
  }, [restored]);

  const hasJournalVideos = (estimate?.journalVideoCount ?? 0) > 0;
  const needsChoice = hasJournalVideos;
  // If the size estimate failed we don't know whether there are journal videos, so
  // the export still works — without them — rather than being disabled.
  const canExport = !exporting && (!needsChoice || choice !== null);

  async function handleExport() {
    const withVideos = hasJournalVideos && choice === "with";
    setExportError(null);
    setExported(null);
    try {
      const dest = await saveFileDialog({
        defaultPath: `StudentCommandCenter-backup-${toDateKey(new Date())}${withVideos ? "-with-journal-videos" : ""}.sccbackup`,
        filters: FILE_FILTER,
      });
      if (!dest) return; // cancelled — nothing to report
      setExporting(true);
      setExported(await exportBackup(dest, withVideos));
    } catch (e) {
      setExportError(String(e));
    } finally {
      setExporting(false);
    }
  }

  async function handleChooseBackup() {
    setImportError(null);
    try {
      const picked = await openFileDialog({ multiple: false, directory: false, filters: FILE_FILTER });
      if (typeof picked !== "string") return; // cancelled
      setInfo(null);
      setUnderstood(false);
      setImportPath(picked);
      setInspecting(true);
      setInfo(await inspectBackup(picked));
    } catch (e) {
      setImportPath(null);
      setImportError(String(e));
    } finally {
      setInspecting(false);
    }
  }

  function cancelImport() {
    setImportPath(null);
    setInfo(null);
    setUnderstood(false);
    setImportError(null);
  }

  async function handleImport() {
    if (!importPath || !understood) return;
    setImporting(true);
    setImportError(null);
    try {
      setRestored(await importBackup(importPath));
    } catch (e) {
      setImportError(String(e));
      setImporting(false);
    }
  }

  const journalRelevant = hasJournalVideos || (info?.manifest.includesJournalVideos ?? false);

  return (
    <>
      {/* ------------------------------------------------------------ export */}
      <Card>
        <SettingsSectionTitle>Back up your data</SettingsSectionTitle>
        <p className="text-xs text-text-secondary mb-3">
          Saves everything in the app — tasks, courses, exams, finances, study history, settings and companion progress —
          into one file you can keep anywhere (another drive, a cloud folder, a USB stick). Use it to recover from a reset or
          an uninstall, or to move to another computer.
        </p>
        <p className="text-xs text-text-secondary mb-3">
          <strong className="font-medium text-text">API keys are never included.</strong> After restoring a backup, re-enter
          them in Settings → AI and reconnect Spotify.
        </p>

        {estimateError && (
          <ErrorBanner
            className="mb-3"
            title="Couldn't work out the backup size"
            message={estimateError}
            onDismiss={() => setEstimateError(null)}
          />
        )}

        {hasJournalVideos && estimate && (
          <fieldset className="mb-3">
            <legend className="text-sm text-text-secondary mb-2">Private journal videos</legend>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="backup-journal"
                  className="mt-1"
                  checked={choice === "without"}
                  onChange={() => setChoice("without")}
                />
                <span>
                  Without journal videos
                  <span className="text-text-secondary"> — about {formatBytes(estimate.withoutVideosBytes)}</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="backup-journal"
                  className="mt-1"
                  checked={choice === "with"}
                  onChange={() => setChoice("with")}
                />
                <span>
                  With journal videos
                  <span className="text-text-secondary"> — about {formatBytes(estimate.withVideosBytes)}</span>
                </span>
              </label>
            </div>
            <Callout tone="warning" className="mt-3">
              Including private journal videos will make the export file large.
              {choice === "without" && " Without them, your journal entries are not part of this backup."}
            </Callout>
          </fieldset>
        )}

        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={handleExport} disabled={!canExport}>
            {exporting ? "Creating backup…" : "Export backup…"}
          </Button>
          {needsChoice && choice === null && !exporting && (
            <p className="text-xs text-text-secondary">Choose whether to include the journal videos first.</p>
          )}
          {exporting && (
            <p className="text-xs text-text-secondary" role="status">
              This can take a while for a large backup. Keep the app open.
            </p>
          )}
        </div>

        {exportError && (
          <ErrorBanner
            className="mt-3"
            title="The backup wasn't saved"
            message={exportError}
            onDismiss={() => setExportError(null)}
          />
        )}
        {exported && (
          <Callout tone="success" title="Backup saved" className="mt-3">
            <span className="break-all">{exported.path}</span>
            <br />
            {formatBytes(exported.bytes)}
            {exported.includedJournalVideos ? ` · includes ${exported.journalVideoCount} journal video(s)` : ""}
          </Callout>
        )}
      </Card>

      {/* ------------------------------------------------------------ import */}
      <Card>
        <SettingsSectionTitle>Restore from a backup</SettingsSectionTitle>
        <p className="text-xs text-text-secondary mb-3">
          Choose a backup file made by this app. Nothing changes until you confirm on the next step.
        </p>

        {!restored && (
          <Button variant="secondary" onClick={handleChooseBackup} disabled={inspecting || importing}>
            {inspecting ? "Reading backup…" : importPath ? "Choose a different file…" : "Choose backup file…"}
          </Button>
        )}

        {importError && (
          <ErrorBanner
            className="mt-3"
            title={info ? "The backup wasn't restored" : "That backup can't be used"}
            message={importError}
            onDismiss={() => setImportError(null)}
          />
        )}

        {info && importPath && !restored && (
          <div className="mt-4 space-y-3">
            <div className="rounded-md border border-border px-3 py-2.5 text-sm space-y-1">
              <p className="break-all text-text-secondary text-xs">{importPath}</p>
              <p>
                Made <span className="font-medium">{formatCreatedAt(info.manifest.createdAt)}</span> · app version{" "}
                {info.manifest.appVersion} · {formatBytes(info.fileBytes)}
              </p>
              {journalRelevant && (
                <p>
                  Journal videos in this backup:{" "}
                  <span className="font-medium">
                    {info.manifest.includesJournalVideos ? `Yes (${info.videosInFile})` : "No"}
                  </span>
                </p>
              )}
            </div>

            <Callout tone="warning" title="Importing will replace all of your present data">
              Everything currently in the app — tasks, courses, exams, finances, study history, settings and companion
              progress — will be replaced by what is in this backup. A safety copy of your current data is saved first, but it
              can't be restored from inside the app, so only continue if you are sure.
              {journalRelevant && !info.manifest.includesJournalVideos && (
                <>
                  {" "}
                  <strong className="font-medium">
                    This backup has no journal videos: your current journal entries and videos will no longer appear in the
                    app.
                  </strong>{" "}
                  (The encrypted files are kept in a folder on this computer until you delete it.)
                </>
              )}
              {info.manifest.includesJournalVideos && (
                <> Your private journal will be replaced by the backup's and opens with the password it had when the backup was made.</>
              )}
              <br />
              API keys aren't part of a backup — re-enter them in Settings → AI and reconnect Spotify afterwards.
            </Callout>

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
                disabled={importing}
              />
              <span>I understand that my present data will be replaced.</span>
            </label>

            <div className="flex gap-2">
              <Button variant="destructive-outline" onClick={handleImport} disabled={!understood || importing}>
                {importing ? "Restoring…" : "Replace my data with this backup"}
              </Button>
              <Button variant="secondary" onClick={cancelImport} disabled={importing}>
                Cancel
              </Button>
            </div>
            {importing && (
              <p className="text-xs text-text-secondary" role="status">
                Restoring — keep the app open. This can take a while if the backup is large.
              </p>
            )}
          </div>
        )}

        {restored && (
          <Callout
            tone="success"
            title="Backup restored"
            className="mt-3"
            action={
              <Button variant="primary" onClick={() => window.location.reload()}>
                Reload now
              </Button>
            }
          >
            The app will reload in a few seconds. A safety copy of your previous data was saved at{" "}
            <span className="break-all">{restored.safetyBackupPath}</span>.
            {restored.oldJournalVideosKeptAt && (
              <>
                {" "}
                Your previous journal videos were moved to <span className="break-all">{restored.oldJournalVideosKeptAt}</span>.
              </>
            )}{" "}
            Remember to re-enter your API keys in Settings → AI.
          </Callout>
        )}
      </Card>
    </>
  );
}
