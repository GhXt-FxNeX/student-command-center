import { invoke } from "@tauri-apps/api/core";
import type { UserSettings } from "@/types";

export function getSettings(): Promise<UserSettings> {
  return invoke("get_settings");
}

export function updateSettings(settings: UserSettings): Promise<UserSettings> {
  return invoke("update_settings", { settings });
}
