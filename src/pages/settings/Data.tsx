import { useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/ui/Button";
import { ToggleField } from "@/components/ui/Toggle";
import { FieldMessage } from "@/components/ui/Callout";
import { generateDemoData, resetDemoData, resetSavedData } from "@/lib/ipc/dataManagement";
import { SettingsCategoryLayout, SettingsSectionTitle } from "@/features/settings/SettingsCategoryLayout";
import { BackupRestore } from "@/features/settings/BackupRestore";
import type { ResetSummary } from "@/types";

export function SettingsDataPage() {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [alsoResetSettings, setAlsoResetSettings] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSummary, setResetSummary] = useState<ResetSummary | null>(null);
  const [confirmDemoReset, setConfirmDemoReset] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  async function handleConfirmReset() {
    setResetBusy(true);
    setResetError(null);
    try {
      const summary = await resetSavedData(alsoResetSettings);
      setResetSummary(summary);
      setShowResetConfirm(false);
      setResetConfirmText("");
      // A reset always clears the profile (name + icon) too, and may reset
      // settings, so everything the app holds in memory is stale. A full reload
      // is the simplest way to guarantee every page — and the onboarding screen
      // that follows — starts from the post-reset state rather than tracking it
      // through prop drilling.
      window.location.reload();
    } catch (e) {
      setResetError(String(e));
    } finally {
      setResetBusy(false);
    }
  }

  async function handleResetDemoData() {
    setDemoBusy(true);
    setResetError(null);
    try {
      const summary = await resetDemoData();
      setResetSummary(summary);
      setConfirmDemoReset(false);
    } catch (e) {
      setResetError(String(e));
    } finally {
      setDemoBusy(false);
    }
  }

  async function handleGenerateDemoData() {
    setDemoBusy(true);
    setResetError(null);
    try {
      const summary = await generateDemoData();
      setResetSummary(summary);
    } catch (e) {
      setResetError(String(e));
    } finally {
      setDemoBusy(false);
    }
  }

  return (
    <SettingsCategoryLayout title="Data" description="Back up and restore your data, demo data, and resetting what you've saved.">
      <BackupRestore />
      <Card>
        <SettingsSectionTitle>Demo data</SettingsSectionTitle>
        <p className="text-xs text-text-secondary mb-3">
          Adds a small set of clearly-labeled sample courses, tasks, exams, and transactions (every
          name starts with "[Demo]") so you can try the app without mixing in real data.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleGenerateDemoData} disabled={demoBusy}>
            {demoBusy ? "Working…" : "Load demo data"}
          </Button>
          {confirmDemoReset ? (
            <>
              <Button variant="destructive" onClick={handleResetDemoData} disabled={demoBusy}>
                {demoBusy ? "Removing…" : "Confirm: remove demo data"}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmDemoReset(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmDemoReset(true)} disabled={demoBusy}>
              Reset demo data
            </Button>
          )}
        </div>
        <p className="text-xs text-text-secondary mt-2">
          "Reset demo data" only ever removes rows explicitly tagged as demo — it never guesses, and
          it never touches your real data.
        </p>
      </Card>

      <Card className="border-red-500/40">
        <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">Reset saved data</p>
        <p className="text-xs text-text-secondary mb-3">
          Permanently deletes your tasks, courses, subjects, exams, transactions, study/Pomodoro
          history, companion progress, and your profile (name and icon — you'll be asked to set it
          up again). Your companion resets to its starting state rather than disappearing. A backup of the database is made automatically right before this runs.
          Settings are kept unless you check the box below.
        </p>

        {!showResetConfirm ? (
          <Button variant="destructive-outline" onClick={() => setShowResetConfirm(true)}>
            Reset saved data…
          </Button>
        ) : (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 space-y-2">
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              This cannot be undone from within the app (though a backup file is saved to disk
              first). Type <span className="font-mono font-semibold">RESET</span> to confirm.
            </p>
            <ToggleField
              size="sm"
              checked={alsoResetSettings}
              onChange={setAlsoResetSettings}
              label="Also reset my Settings to defaults"
            />
            {/* Raw <input> on purpose (see engineering-notes: red-tinted field,
                same-property conflict with Input's own border/background). It
                uses theme tokens so it is correct in dark mode — the previous
                hardcoded bg-white was a glaring white box on the dark theme. */}
            <input
              className="w-full rounded-md border border-red-500/40 bg-surface text-text placeholder:text-text-secondary px-3 py-1.5 text-sm"
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              placeholder="Type RESET to confirm"
              aria-label="Type RESET to confirm"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={handleConfirmReset}
                disabled={resetConfirmText !== "RESET" || resetBusy}
              >
                {resetBusy ? "Resetting…" : "Permanently reset"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowResetConfirm(false);
                  setResetConfirmText("");
                  setAlsoResetSettings(false);
                }}
                disabled={resetBusy}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {resetError && <FieldMessage className="mt-3">{resetError}</FieldMessage>}
        {resetSummary && (
          <div className="mt-3 rounded-md border border-border bg-bg p-3 text-xs text-text-secondary">
            <p className="mb-1">
              {resetSummary.deleted.reduce((sum, t) => sum + t.rowsDeleted, 0)} row(s) affected across{" "}
              {resetSummary.deleted.filter((t) => t.rowsDeleted > 0).length} table(s)
              {resetSummary.settingsReset ? " · settings reset to defaults" : ""}.
            </p>
            {resetSummary.backupPath && <p>Backup saved to: {resetSummary.backupPath}</p>}
          </div>
        )}
      </Card>
    </SettingsCategoryLayout>
  );
}
