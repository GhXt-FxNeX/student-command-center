import { SettingsSaveError, useSettingsSave } from "@/features/settings/useSettingsSave";
import { Card } from "@/components/Card";
import { Input, Select } from "@/components/ui/Input";
import {
  SavedIndicator,
  SettingsCategoryLayout,
  SettingsSectionTitle,
} from "@/features/settings/SettingsCategoryLayout";
import { ProfileAvatar } from "@/features/profile/ProfileAvatar";
import { ProfileIconPicker } from "@/features/profile/ProfileIconPicker";
import type { UserSettings, WeekStart } from "@/types";

const WEEKDAYS: WeekStart[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

interface Props {
  settings: UserSettings;
  onSettingsChange: (s: UserSettings) => void;
}

export function SettingsGeneralPage({ settings, onSettingsChange }: Props) {
  const { draft, setDraft, save, saving, saved, error, clearError } = useSettingsSave(settings, onSettingsChange);

  return (
    <SettingsCategoryLayout
      title="General"
      description="Your name, week start, study & planner defaults, and finance basics."
    >
      <SettingsSaveError error={error} onDismiss={clearError} />
      <Card>
        <SettingsSectionTitle>Profile</SettingsSectionTitle>
        <div className="flex items-center gap-3 mb-4">
          <ProfileAvatar iconId={draft.profileIcon} name={draft.name} size={48} />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{draft.name.trim() || "Your name"}</p>
            <p className="text-xs text-text-secondary">Shown in the top-right corner of every page.</p>
          </div>
        </div>
        <p className="text-sm text-text-secondary mb-2">Profile icon</p>
        <div className="mb-4">
          <ProfileIconPicker
            value={draft.profileIcon}
            name={draft.name}
            onChange={(id) => save({ ...draft, profileIcon: id })}
          />
        </div>
        <label htmlFor="f-your-name" className="block text-sm text-text-secondary mb-1">Your name</label>
        <Input id="f-your-name"
          maxLength={80}
          className="w-full mb-3"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onBlur={() => save(draft)}
        />
        <label htmlFor="f-week-starts-on" className="block text-sm text-text-secondary mb-1">Week starts on</label>
        <Select id="f-week-starts-on" value={draft.weekStart} onChange={(e) => save({ ...draft, weekStart: e.target.value as WeekStart })}>
          {WEEKDAYS.map((day) => (
            <option key={day} value={day}>
              {day[0].toUpperCase() + day.slice(1)}
            </option>
          ))}
        </Select>
      </Card>

      <Card>
        <SettingsSectionTitle>Study goals</SettingsSectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-text-secondary">
            Daily study goal (min)
            <Input
              type="number"
              size="sm"
              min={0}
              className="mt-1 w-full"
              value={draft.dailyStudyGoalMinutes}
              onChange={(e) => setDraft({ ...draft, dailyStudyGoalMinutes: Number(e.target.value) || 0 })}
              onBlur={() => save(draft)}
            />
          </label>
          <label className="text-sm text-text-secondary">
            Weekly study goal (min)
            <Input
              type="number"
              size="sm"
              min={0}
              className="mt-1 w-full"
              value={draft.weeklyStudyGoalMinutes}
              onChange={(e) => setDraft({ ...draft, weeklyStudyGoalMinutes: Number(e.target.value) || 0 })}
              onBlur={() => save(draft)}
            />
          </label>
        </div>
        <p className="text-xs text-text-secondary mt-2">
          Pomodoro defaults live on the Pomodoro page. Goal tracking/streaks live on Study Analytics —
          this just sets the target.
        </p>
      </Card>

      <Card>
        <SettingsSectionTitle>Planner defaults</SettingsSectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-text-secondary">
            Wake time
            <Input
              type="time"
              size="sm"
              className="mt-1 w-full"
              value={draft.plannerWakeTime}
              onChange={(e) => setDraft({ ...draft, plannerWakeTime: e.target.value })}
              onBlur={() => save(draft)}
            />
          </label>
          <label className="text-sm text-text-secondary">
            Sleep time
            <Input
              type="time"
              size="sm"
              className="mt-1 w-full"
              value={draft.plannerSleepTime}
              onChange={(e) => setDraft({ ...draft, plannerSleepTime: e.target.value })}
              onBlur={() => save(draft)}
            />
          </label>
          <label className="text-sm text-text-secondary">
            Max continuous study (min)
            <Input
              type="number"
              size="sm"
              min={1}
              className="mt-1 w-full"
              value={draft.plannerMaxContinuousMinutes}
              onChange={(e) =>
                setDraft({ ...draft, plannerMaxContinuousMinutes: Number(e.target.value) || 1 })
              }
              onBlur={() => save(draft)}
            />
          </label>
          <label className="text-sm text-text-secondary">
            Break length (min)
            <Input
              type="number"
              size="sm"
              min={0}
              className="mt-1 w-full"
              value={draft.plannerBreakMinutes}
              onChange={(e) => setDraft({ ...draft, plannerBreakMinutes: Number(e.target.value) || 0 })}
              onBlur={() => save(draft)}
            />
          </label>
        </div>
        <p className="text-xs text-text-secondary mt-2">
          These are the defaults the AI Planner pre-fills when you generate a day — you can still
          override any of them for a single generation from the Planner page itself.
        </p>
      </Card>

      <Card>
        <SettingsSectionTitle>Finance</SettingsSectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-text-secondary">
            Currency
            <Input
              size="sm"
              className="mt-1 w-full uppercase"
              maxLength={3}
              value={draft.currency}
              onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })}
              onBlur={() => save(draft)}
            />
          </label>
          <label className="text-sm text-text-secondary">
            Monthly income (expected)
            <Input
              type="number"
              size="sm"
              min={0}
              step="0.01"
              className="mt-1 w-full"
              value={draft.monthlyIncomeAmount || ""}
              onChange={(e) => setDraft({ ...draft, monthlyIncomeAmount: Number(e.target.value) || 0 })}
              onBlur={() => save(draft)}
            />
          </label>
        </div>
        <p className="text-xs text-text-secondary mt-2">
          A three-letter code (e.g. USD, EUR, EGP) used to format amounts on the Finances page.
          Expected income is shown alongside your logged income each month — it doesn't count toward
          totals until you log it as a transaction.
        </p>
      </Card>

      <SavedIndicator saving={saving} saved={saved} />
    </SettingsCategoryLayout>
  );
}
