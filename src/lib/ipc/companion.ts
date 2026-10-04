import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AssetManifest,
  CollectionEntrySummary,
  CompanionState,
  CustomCompanionPackSummary,
  CustomPackDraft,
  CustomPackEdit,
} from "@/types";

export function getCompanionState(): Promise<CompanionState> {
  return invoke("get_companion_state");
}

export function getCompanionManifest(): Promise<AssetManifest> {
  return invoke("get_companion_manifest");
}

/** Subscribes to live companion updates pushed by the Rust engine after any event it processes. */
export function onCompanionUpdated(cb: (state: CompanionState) => void): Promise<UnlistenFn> {
  return listen<CompanionState>("companion:updated", (event) => cb(event.payload));
}

export function renameCompanion(name: string): Promise<CompanionState> {
  return invoke("rename_companion", { name });
}

/** Step 1 of adding a custom companion pack: scans a .zip that contains
 * only animation PNGs (<stage>/<animation>.png — no manifest.json) and
 * returns a draft for the editor screen. Installs nothing yet. */
export function inspectCustomCompanionZip(zipPath: string): Promise<CustomPackDraft> {
  return invoke("inspect_custom_companion_zip", { zipPath });
}

/** The installed custom pack, opened as an editable draft ("Edit details"). */
export function getCustomCompanionDraft(): Promise<CustomPackDraft | null> {
  return invoke("get_custom_companion_draft");
}

/** Step 2: validates + saves the details confirmed on the editor screen.
 * Doesn't switch the active companion — call activateCustomCompanion()
 * for that once the person has seen the result. */
export function saveCustomCompanionPack(mode: "new" | "installed", edit: CustomPackEdit): Promise<CustomCompanionPackSummary> {
  return invoke("save_custom_companion_pack", { mode, edit });
}

/** The person cancelled the editor screen — drops the staged upload. */
export function discardCustomCompanionDraft(): Promise<void> {
  return invoke("discard_custom_companion_draft");
}

/** Removes the installed custom pack entirely — not a replace, an actual
 * delete. Previously the only way to get rid of one was uploading a
 * different pack (which replaces it as a side effect of installing).
 * Reverts to Sparkling first if the custom pack happens to be active. */
export function deleteCustomCompanionPack(): Promise<void> {
  return invoke("delete_custom_companion_pack");
}

/** Fires after a custom pack is installed or its details are edited, so
 * the asset manifest (otherwise loaded once at startup) can be re-read. */
export function onCompanionAssetsChanged(cb: () => void): Promise<UnlistenFn> {
  return listen("companion:assets-changed", () => cb());
}

export function activateCustomCompanion(): Promise<CompanionState> {
  return invoke("activate_custom_companion");
}

export function revertToDefaultCompanion(): Promise<CompanionState> {
  return invoke("revert_to_default_companion");
}

export function getCustomCompanionStatus(): Promise<CustomCompanionPackSummary | null> {
  return invoke("get_custom_companion_status");
}

export function getCompanionCollection(): Promise<CollectionEntrySummary[]> {
  return invoke("get_companion_collection");
}

/** Switches the active companion to an already-unlocked collection slot.
 * The previous active companion's progress is untouched — only which slot
 * is_active flips (future_enhancement.md §4). */
export function switchActiveCompanion(id: number): Promise<CompanionState> {
  return invoke("switch_active_companion", { id });
}

