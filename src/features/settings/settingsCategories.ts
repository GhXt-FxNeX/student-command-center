/**
 * Single source of truth for the Settings category grid (Settings home
 * page). UI/UX modernization phase: replaces the old single
 * giant-scrolling-page Settings with Settings -> Category -> Section.
 *
 * `key` also selects the icon in `icons.tsx` (see ICONS map in
 * `SettingsHome`) — keep the two in sync if a category is renamed.
 */
export interface SettingsCategoryMeta {
  key: string;
  label: string;
  path: string;
  description: string;
}

export const SETTINGS_CATEGORIES: SettingsCategoryMeta[] = [
  {
    key: "general",
    label: "General",
    path: "/settings/general",
    description: "Your name, week start, study & planner defaults, and finance basics.",
  },
  {
    key: "appearance",
    label: "Appearance",
    path: "/settings/appearance",
    description: "Theme and accent color.",
  },
  {
    key: "ai",
    label: "AI",
    path: "/settings/ai",
    description: "Provider, models, API keys, and spending limits.",
  },
  {
    key: "companion",
    label: "Companion",
    path: "/settings/companion",
    description: "Name, custom art, and your companion collection.",
  },
  {
    key: "spotify",
    label: "Spotify",
    path: "/settings/spotify",
    description: "Connect your account and control playback.",
  },
  {
    key: "data",
    label: "Data",
    path: "/settings/data",
    description: "Demo data, and resetting what you've saved.",
  },
  {
    key: "privacy",
    label: "Privacy & Security",
    path: "/settings/privacy",
    description: "How your data is stored and what leaves the app.",
  },
  {
    key: "about",
    label: "About",
    path: "/settings/about",
    description: "Version and app information.",
  },
];
