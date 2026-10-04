import { useEffect, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Card } from "@/components/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ToggleField } from "@/components/ui/Toggle";
import {
  activateCustomCompanion,
  deleteCustomCompanionPack,
  discardCustomCompanionDraft,
  getCompanionCollection,
  getCustomCompanionDraft,
  getCustomCompanionStatus,
  inspectCustomCompanionZip,
  renameCompanion,
  revertToDefaultCompanion,
  switchActiveCompanion,
} from "@/lib/ipc/companion";
import { updateSettings } from "@/lib/ipc/settings";
import { CustomPackEditor } from "@/features/companion/CustomPackEditor";
import { FieldMessage } from "@/components/ui/Callout";
import { LoadingState } from "@/components/ui/Spinner";
import {
  SavedIndicator,
  SettingsCategoryLayout,
  SettingsSectionTitle,
} from "@/features/settings/SettingsCategoryLayout";
import type {
  AssetManifest,
  CollectionEntrySummary,
  CompanionState,
  CustomCompanionPackSummary,
  CustomPackDraft,
  UserSettings,
} from "@/types";

interface Props {
  settings: UserSettings;
  onSettingsChange: (s: UserSettings) => void;
  companion: { state: CompanionState | null; manifest: AssetManifest | null; error: string | null };
}

export function SettingsCompanionPage({ settings, onSettingsChange, companion }: Props) {
  const [nameDraft, setNameDraft] = useState(companion.state?.name ?? "");
  const [nameTouched, setNameTouched] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [customStatus, setCustomStatus] = useState<CustomCompanionPackSummary | null>(null);
  const [customStatusLoaded, setCustomStatusLoaded] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [switchBusy, setSwitchBusy] = useState(false);
  // The details editor: open on a fresh upload ("new") or on the installed
  // pack ("installed"); null when closed.
  const [draft, setDraft] = useState<CustomPackDraft | null>(null);

  // Persisting display settings (show/hide toggle, bubble size).
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [collection, setCollection] = useState<CollectionEntrySummary[] | null>(null);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [collectionSwitchBusyId, setCollectionSwitchBusyId] = useState<number | null>(null);

  useEffect(() => {
    if (!nameTouched && companion.state) setNameDraft(companion.state.name);
  }, [companion.state, nameTouched]);

  useEffect(() => {
    getCustomCompanionStatus()
      .then((status) => setCustomStatus(status))
      .catch((e) => setInstallError(String(e)))
      .finally(() => setCustomStatusLoaded(true));
  }, []);

  function refreshCollection() {
    getCompanionCollection()
      .then((entries) => setCollection(entries))
      .catch((e) => setCollectionError(String(e)));
  }

  useEffect(() => {
    refreshCollection();
  }, []);

  async function handleSwitchActive(id: number) {
    setCollectionSwitchBusyId(id);
    setCollectionError(null);
    try {
      await switchActiveCompanion(id);
      refreshCollection();
    } catch (e) {
      setCollectionError(String(e));
    } finally {
      setCollectionSwitchBusyId(null);
    }
  }

  async function handleRenameSave() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === companion.state?.name) {
      setNameTouched(false);
      return;
    }
    setNameSaving(true);
    setNameError(null);
    try {
      await renameCompanion(trimmed);
      setNameTouched(false);
    } catch (e) {
      setNameError(String(e));
    } finally {
      setNameSaving(false);
    }
  }

  /** Saves display settings through the same `updateSettings` path every
   * other Settings page uses, then hands the persisted row back up. */
  async function persistSettings(next: UserSettings) {
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const persisted = await updateSettings(next);
      onSettingsChange(persisted);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 1500);
    } catch (e) {
      setSettingsError(String(e));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleChooseCustomPack() {
    setInstallError(null);
    let picked: string | string[] | null;
    try {
      picked = await openFileDialog({
        multiple: false,
        directory: false,
        title: "Choose your companion's animations (.zip)",
        filters: [{ name: "Companion animations", extensions: ["zip"] }],
      });
    } catch (e) {
      setInstallError(String(e));
      return;
    }
    if (!picked || Array.isArray(picked)) return;

    setInstallBusy(true);
    try {
      // Reads the zip and opens the details screen — nothing is installed
      // until the person confirms it there.
      setDraft(await inspectCustomCompanionZip(picked));
    } catch (e) {
      setInstallError(String(e));
    } finally {
      setInstallBusy(false);
    }
  }

  async function handleEditDetails() {
    setInstallError(null);
    setInstallBusy(true);
    try {
      const existing = await getCustomCompanionDraft();
      if (existing) setDraft(existing);
      else setInstallError("No custom companion is installed yet.");
    } catch (e) {
      setInstallError(String(e));
    } finally {
      setInstallBusy(false);
    }
  }

  function handleEditorCancel() {
    if (draft?.mode === "new") discardCustomCompanionDraft().catch(() => {});
    setDraft(null);
  }

  function handleEditorSaved(summary: CustomCompanionPackSummary) {
    setCustomStatus(summary);
    setDraft(null);
  }

  async function handleActivateCustom() {
    setSwitchBusy(true);
    setInstallError(null);
    try {
      await activateCustomCompanion();
      setCustomStatus((s) => (s ? { ...s, active: true } : s));
    } catch (e) {
      setInstallError(String(e));
    } finally {
      setSwitchBusy(false);
    }
  }

  async function handleRevertToDefault() {
    setSwitchBusy(true);
    setInstallError(null);
    try {
      await revertToDefaultCompanion();
      setCustomStatus((s) => (s ? { ...s, active: false } : s));
    } catch (e) {
      setInstallError(String(e));
    } finally {
      setSwitchBusy(false);
    }
  }

  async function handleDeleteCustomPack() {
    setDeleteBusy(true);
    setInstallError(null);
    try {
      // Reverting the active companion off this species (if needed) and
      // deleting the species/files both happen on the backend, so there's
      // no window where the app is showing a species that's mid-delete.
      await deleteCustomCompanionPack();
      setCustomStatus(null);
      setDeleteConfirming(false);
    } catch (e) {
      setInstallError(String(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <SettingsCategoryLayout
      title="Companion"
      description="Name, custom art, and your companion collection."
    >
      <Card>
        <SettingsSectionTitle>Identity</SettingsSectionTitle>
        <label htmlFor="f-name" className="block text-sm text-text-secondary mb-1">Name</label>
        <Input id="f-name"
          className="w-full"
          value={nameDraft}
          onChange={(e) => {
            setNameTouched(true);
            setNameDraft(e.target.value);
          }}
          onBlur={handleRenameSave}
          maxLength={40}
          disabled={!companion.state}
          placeholder={companion.state ? undefined : "Loading…"}
        />
        {nameSaving && <p className="text-xs text-text-secondary mt-1">Saving…</p>}
        {nameError && <FieldMessage className="mt-1">{nameError}</FieldMessage>}
      </Card>

      <Card>
        <SettingsSectionTitle>Appearance</SettingsSectionTitle>
        <ToggleField
          checked={settings.companionEnabled}
          onChange={(enabled) => persistSettings({ ...settings, companionEnabled: enabled })}
          label="Show companion"
          description="Shows your companion on the Dashboard and as a floating bubble on every page. Turning it off only hides it — it keeps earning XP and mood in the background, so nothing is lost."
          disabled={settingsSaving}
        />

        <div className={`mt-5 ${settings.companionEnabled ? "" : "opacity-50"}`}>
          <label className="block text-sm text-text-secondary mb-1" htmlFor="companion-bubble-size">
            Bubble size — {settings.companionBubbleSizePx}px
          </label>
          <input
            id="companion-bubble-size"
            type="range"
            min={48}
            max={160}
            step={4}
            value={settings.companionBubbleSizePx}
            disabled={!settings.companionEnabled}
            // Live preview while dragging (in-memory only)…
            onChange={(e) => onSettingsChange({ ...settings, companionBubbleSizePx: Number(e.target.value) })}
            // …and persisted once, on release. This used to stop at the live
            // preview and never reach the database, so the size reset on
            // every relaunch.
            onPointerUp={(e) =>
              persistSettings({ ...settings, companionBubbleSizePx: Number((e.target as HTMLInputElement).value) })
            }
            onKeyUp={(e) =>
              persistSettings({ ...settings, companionBubbleSizePx: Number((e.target as HTMLInputElement).value) })
            }
            className="w-full accent-accent"
          />
          <p className="text-xs text-text-secondary mt-2">
            How big the floating companion bubble appears in the corner of every page — doesn't change
            the companion itself, just how large it renders. Pixel-art packs stay crisp at any size;
            painted/illustrated art will look a little softer the larger you go, the same as any image
            does when scaled up past its native resolution.
          </p>
        </div>
        <div className="mt-2">
          <SavedIndicator saving={settingsSaving} saved={settingsSaved} />
          {settingsError && <FieldMessage>{settingsError}</FieldMessage>}
        </div>
      </Card>

      <Card>
        <SettingsSectionTitle>Custom companion pack</SettingsSectionTitle>

        {draft ? (
          <CustomPackEditor draft={draft} onSaved={handleEditorSaved} onCancel={handleEditorCancel} />
        ) : (
          <>
            <p className="text-xs text-text-secondary mb-2">
              Upload your own art as a .zip of just the animation PNGs — one folder per evolution stage,
              each with at least an <code className="font-mono">idle.png</code>. No manifest file is
              needed: after you choose the zip, you'll name your companion and set pixel-art, frame size
              and speed on the next screen.
            </p>
            <pre className="text-[11px] leading-snug font-mono text-text-secondary rounded-md border border-border bg-bg p-3 mb-3 overflow-x-auto">
{`my-companion.zip
├── egg/idle.png
├── baby/idle.png
├── baby/happy.png      (optional extra animations)
├── in_training/idle.png
├── rookie/idle.png
├── champion/idle.png
├── ultimate/idle.png
└── mega/idle.png`}
            </pre>

            {!customStatusLoaded ? (
              <p className="text-xs text-text-secondary">Checking for an installed pack…</p>
            ) : (
              <>
                {customStatus ? (
                  <div className="rounded-md border border-border bg-bg p-3 text-xs space-y-2 mb-3">
                    <p>
                      <span className="font-medium">{customStatus.name}</span> —{" "}
                      {customStatus.active ? (
                        <span className="text-accent-text">currently active</span>
                      ) : (
                        <span className="text-text-secondary">installed, not active</span>
                      )}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {!customStatus.active ? (
                        <Button variant="primary" onClick={handleActivateCustom} disabled={switchBusy}>
                          {switchBusy ? "Switching…" : "Use this companion"}
                        </Button>
                      ) : (
                        <Button variant="secondary" onClick={handleRevertToDefault} disabled={switchBusy}>
                          {switchBusy ? "Switching…" : "Revert to default companion"}
                        </Button>
                      )}
                      <Button variant="secondary" onClick={handleEditDetails} disabled={installBusy}>
                        Edit details…
                      </Button>
                      {deleteConfirming ? (
                        <>
                          <Button variant="destructive" onClick={handleDeleteCustomPack} disabled={deleteBusy}>
                            {deleteBusy ? "Deleting…" : "Confirm delete"}
                          </Button>
                          <Button variant="secondary" onClick={() => setDeleteConfirming(false)} disabled={deleteBusy}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button variant="destructive-outline" onClick={() => setDeleteConfirming(true)}>
                          Delete pack
                        </Button>
                      )}
                    </div>
                    {deleteConfirming && (
                      <p className="text-text-secondary">
                        This removes "{customStatus.name}" and its files for good — not just replaces it.
                        {customStatus.active && " Your active companion will switch back to the default Sparkling."}
                      </p>
                    )}
                    {customStatus.warnings.length > 0 && (
                      <div className="text-text-secondary">
                        <p className="font-medium mb-0.5">Warnings:</p>
                        <ul className="list-disc list-inside space-y-0.5">
                          {customStatus.warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-text-secondary mb-3">No custom pack installed yet.</p>
                )}

                <Button variant="secondary" onClick={handleChooseCustomPack} disabled={installBusy}>
                  {installBusy ? "Reading zip…" : customStatus ? "Upload a different pack…" : "Upload a pack…"}
                </Button>
                {installError && <FieldMessage className="whitespace-pre-line mt-2">{installError}</FieldMessage>}
              </>
            )}
          </>
        )}
      </Card>

      <Card>
        <SettingsSectionTitle>Your companions</SettingsSectionTitle>
        <p className="text-xs text-text-secondary mb-3">
          Reach your active companion's final evolution to unlock the next one. Switching keeps every
          companion's own progress — nothing is lost or reset.
        </p>

        {collectionError && <FieldMessage className="mb-2">{collectionError}</FieldMessage>}

        {!collection ? (
          <LoadingState message="Loading your companions…" className="py-3" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {collection.map((entry) => (
              <div
                key={entry.id}
                className={`rounded-md border p-3 text-xs space-y-1 ${
                  entry.isActive ? "border-accent bg-accent-soft" : "border-border bg-bg"
                }`}
              >
                <p className="font-medium truncate">{entry.isUnlocked ? entry.name : "???"}</p>
                {entry.isUnlocked ? (
                  <>
                    <p className="text-text-secondary capitalize">
                      {entry.currentStage?.replace("_", "-")} · Lv {entry.level}
                    </p>
                    {entry.isActive ? (
                      <p className="text-accent-text font-medium">Active</p>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => handleSwitchActive(entry.id)}
                        disabled={collectionSwitchBusyId !== null}
                        className="w-full"
                      >
                        {collectionSwitchBusyId === entry.id ? "Switching…" : "Switch to this one"}
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="text-text-secondary">
                    Locked — evolve your active companion to Mega to unlock it.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </SettingsCategoryLayout>
  );
}
