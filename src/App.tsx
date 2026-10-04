import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { Shell } from "./app/Shell";
import { Dashboard } from "./pages/Dashboard";
import { TasksPage } from "./pages/Tasks";
import { SettingsPage } from "./pages/Settings";
import { SettingsGeneralPage } from "./pages/settings/General";
import { SettingsAppearancePage } from "./pages/settings/Appearance";
import { SettingsAiPage } from "./pages/settings/Ai";
import { SettingsCompanionPage } from "./pages/settings/Companion";
import { SettingsSpotifyPage } from "./pages/settings/Spotify";
import { SettingsDataPage } from "./pages/settings/Data";
import { SettingsPrivacyPage } from "./pages/settings/Privacy";
import { SettingsAboutPage } from "./pages/settings/About";
import { PomodoroPage } from "./pages/Pomodoro";
import { CalendarPage } from "./pages/Calendar";
import { StudyAnalyticsPage } from "./pages/StudyAnalytics";
import { FinancesPage } from "./pages/Finances";
import { SpotifyPage } from "./pages/Spotify";
import { ExamsPage } from "./pages/Exams";
import { PlannerPage } from "./pages/Planner";
import { CoursesPage } from "./pages/Courses";
import { getSettings } from "./lib/ipc/settings";
import { applyTheme } from "./lib/theme/accent";
import { useCompanion } from "./features/companion/useCompanion";
import { ErrorBanner } from "./components/ui/Callout";
import { SplashScreen } from "./components/SplashScreen";
import { OnboardingScreen } from "./features/profile/OnboardingScreen";
import type { UserSettings } from "./types";

export default function App() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Single companion subscription for the whole app, lifted here so the
  // global FloatingCompanion (rendered from Shell, outside <Routes>) and
  // the Dashboard's detailed CompanionWidget share one IPC listener
  // instead of each opening its own (Phase 14 Item 3).
  const companion = useCompanion();

  function loadSettings() {
    setLoadError(null);
    getSettings()
      .then((s) => {
        setSettings(s);
        applyTheme(s.theme, s.accentColor);
      })
      .catch((err) => setLoadError(String(err)));
  }

  useEffect(() => {
    loadSettings();
  }, []);

  if (loadError) {
    // Nothing else can render without settings (theme, name, week start…), so
    // this is a full-screen state — but it still explains what happened and
    // offers a way forward instead of dead-ending on bare text.
    return (
      <div className="flex h-full items-center justify-center bg-bg text-text p-8">
        <div className="w-full max-w-md">
          <ErrorBanner
            title="Couldn't load your settings"
            message={`${loadError}\n\nYour data hasn't been touched. If this keeps happening, restart the app.`}
            onReload={loadSettings}
          />
        </div>
      </div>
    );
  }

  if (!settings) {
    // Same screen index.html paints before any JavaScript runs (logo + spinner),
    // in the theme cached from the last launch — so there is no white flash and
    // no visible hand-off between the static page and this component.
    return <SplashScreen />;
  }

  // First launch, or after "Reset saved data": pick a name + icon first.
  if (!settings.onboardingCompleted) {
    return <OnboardingScreen settings={settings} onDone={setSettings} />;
  }

  return (
    <Shell settings={settings} onSettingsChange={setSettings} companion={companion}>
      <Routes>
        <Route path="/" element={<Dashboard settings={settings} companion={companion} />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="/settings/general"
          element={<SettingsGeneralPage settings={settings} onSettingsChange={setSettings} />}
        />
        <Route
          path="/settings/appearance"
          element={<SettingsAppearancePage settings={settings} onSettingsChange={setSettings} />}
        />
        <Route
          path="/settings/ai"
          element={<SettingsAiPage settings={settings} onSettingsChange={setSettings} />}
        />
        <Route
          path="/settings/companion"
          element={
            <SettingsCompanionPage settings={settings} onSettingsChange={setSettings} companion={companion} />
          }
        />
        <Route
          path="/settings/spotify"
          element={<SettingsSpotifyPage settings={settings} onSettingsChange={setSettings} />}
        />
        <Route path="/settings/data" element={<SettingsDataPage />} />
        <Route path="/settings/privacy" element={<SettingsPrivacyPage />} />
        <Route path="/settings/about" element={<SettingsAboutPage />} />
        <Route
          path="/pomodoro"
          element={<PomodoroPage settings={settings} onSettingsChange={setSettings} />}
        />
        <Route path="/calendar" element={<CalendarPage settings={settings} />} />
        <Route path="/study-analytics" element={<StudyAnalyticsPage />} />
        <Route path="/finances" element={<FinancesPage settings={settings} />} />
        <Route path="/spotify" element={<SpotifyPage />} />
        <Route path="/exams" element={<ExamsPage />} />
        <Route path="/planner" element={<PlannerPage settings={settings} />} />

        {/* Phase 1 nav item still expanding; Phases 8-13 (Documents/Medical AI/
            MCQs/Flashcards/Reviews) were built then fully removed — the
            roadmap now moves to Phase 14 (future enhancements & polish, per
            future_enhancement.md) instead of continuing down that path. */}
        <Route path="/courses" element={<CoursesPage />} />
      </Routes>
    </Shell>
  );
}
