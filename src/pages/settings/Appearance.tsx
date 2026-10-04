import { Card } from "@/components/Card";
import { ACCENT_PRESETS, applyTheme, type AccentPreset } from "@/lib/theme/accent";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SettingsSaveError, useSettingsSave } from "@/features/settings/useSettingsSave";
import { NavigationOrderEditor } from "@/features/settings/NavigationOrderEditor";
import { resolveNavLayout, toNavLayout, type ResolvedNavItem } from "@/app/navItems";
import {
  SavedIndicator,
  SettingsCategoryLayout,
  SettingsSectionTitle,
} from "@/features/settings/SettingsCategoryLayout";
import type { ThemeModeSetting, UserSettings } from "@/types";

const THEME_OPTIONS: { value: ThemeModeSetting; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

interface Props {
  settings: UserSettings;
  onSettingsChange: (s: UserSettings) => void;
}

export function SettingsAppearancePage({ settings, onSettingsChange }: Props) {
  const { draft, save, saving, saved, error, clearError } = useSettingsSave(settings, onSettingsChange, {
    // Theme/accent are applied instantly for feedback; if the save then fails,
    // put the stored theme back so the screen matches what is actually saved.
    onOptimistic: (next) => applyTheme(next.theme, next.accentColor),
    onRollback: (stored) => applyTheme(stored.theme, stored.accentColor),
  });

  // Navigation order/visibility goes through the same save, so a failed save
  // rolls the editor back and shows the banner — it must never show a layout
  // that wasn't actually stored.
  const saveNavLayout = (items: ResolvedNavItem[]) => save({ ...draft, navLayout: toNavLayout(items) });

  return (
    <SettingsCategoryLayout title="Appearance" description="Theme, accent color and navigation.">
      <SettingsSaveError error={error} onDismiss={clearError} />
      <Card>
        <SettingsSectionTitle>Theme</SettingsSectionTitle>
        <SegmentedControl ariaLabel="Theme"
          options={THEME_OPTIONS}
          value={draft.theme}
          onChange={(mode) => save({ ...draft, theme: mode })}
        />
      </Card>

      <Card>
        <SettingsSectionTitle>Accent color</SettingsSectionTitle>
        <div className="flex flex-wrap gap-2 mb-3">
          {(Object.entries(ACCENT_PRESETS) as [AccentPreset, string][]).map(([name, hex]) => (
            <button
              key={name}
              title={name}
              onClick={() => save({ ...draft, accentColor: hex })}
              type="button"
              aria-label={`${name.charAt(0).toUpperCase()}${name.slice(1)} accent`}
              aria-pressed={draft.accentColor.toLowerCase() === hex.toLowerCase()}
              className="h-8 w-8 rounded-full border-2 transition-all duration-150 hover:scale-105 active:scale-95"
              style={{
                backgroundColor: hex,
                borderColor:
                  draft.accentColor.toLowerCase() === hex.toLowerCase() ? "var(--color-text)" : "transparent",
              }}
            />
          ))}
          <label className="h-8 w-8 rounded-full border border-dashed border-border flex items-center justify-center text-xs cursor-pointer">
            <input
              type="color"
              aria-label="Custom accent color"
              className="opacity-0 absolute w-8 h-8 cursor-pointer"
              value={draft.accentColor}
              onChange={(e) => save({ ...draft, accentColor: e.target.value })}
            />
            +
          </label>
        </div>
        <p className="text-xs text-text-secondary">
          Hover, active, and highlight colors are generated automatically from this one color. Text and
          button colors are nudged slightly darker or lighter where needed so they stay readable.
        </p>
      </Card>

      <Card>
        <SettingsSectionTitle>Navigation</SettingsSectionTitle>
        <p className="text-xs text-text-secondary mb-3">
          Choose which tabs appear in the navigation panel and in what order. Hiding a tab only removes its link —
          your data is untouched and you can bring it back here at any time.
        </p>
        <NavigationOrderEditor items={resolveNavLayout(draft.navLayout)} onChange={saveNavLayout} />
      </Card>

      <SavedIndicator saving={saving} saved={saved} />
    </SettingsCategoryLayout>
  );
}
