import { Card } from "@/components/Card";
import { SettingsCategoryLayout, SettingsSectionTitle } from "@/features/settings/SettingsCategoryLayout";
import packageJson from "../../../package.json";

export function SettingsAboutPage() {
  return (
    <SettingsCategoryLayout title="About" description="Version and app information.">
      <Card>
        <SettingsSectionTitle>Student Command Center</SettingsSectionTitle>
        <p className="text-sm text-text-secondary">Version {packageJson.version}</p>
        <p className="text-xs text-text-secondary mt-2">
          A local-first desktop app for managing tasks, planning, studying, exams, and finances in
          one place.
        </p>
      </Card>
    </SettingsCategoryLayout>
  );
}
