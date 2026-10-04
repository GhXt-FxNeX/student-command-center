import { Card } from "@/components/Card";
import { SettingsCategoryLayout, SettingsSectionTitle } from "@/features/settings/SettingsCategoryLayout";

/**
 * Purely informational — there's currently no dedicated Privacy/Security
 * *setting* to relocate here (nothing existed in the old giant Settings
 * page under this name). Rather than invent controls that don't exist,
 * this page explains, in plain language, how the app already handles
 * sensitive data by design.
 */
export function SettingsPrivacyPage() {
  return (
    <SettingsCategoryLayout
      title="Privacy & Security"
      description="How your data is stored and what leaves the app."
    >
      <Card>
        <SettingsSectionTitle>Where your data lives</SettingsSectionTitle>
        <p className="text-sm text-text-secondary">
          Student Command Center is local-first: your tasks, courses, exams, transactions, study
          history, and companion progress are all stored in a database on this device. Nothing is
          uploaded anywhere unless a feature explicitly says so.
        </p>
      </Card>

      <Card>
        <SettingsSectionTitle>API keys &amp; connected accounts</SettingsSectionTitle>
        <p className="text-sm text-text-secondary">
          AI provider API keys and your Spotify sign-in are stored in your operating system's own
          secure credential manager — never written to disk as plain text, and never visible again
          in the app once saved (you can only replace or remove them).
        </p>
      </Card>

      <Card>
        <SettingsSectionTitle>What leaves the app</SettingsSectionTitle>
        <p className="text-sm text-text-secondary">
          AI features send the relevant text to whichever provider you've configured under Settings
          → AI (Gemini or OpenRouter) — and only when you trigger an AI action. Spotify features
          talk to Spotify's own API to show and control your account. Nothing else in the app makes
          network requests.
        </p>
      </Card>
    </SettingsCategoryLayout>
  );
}
