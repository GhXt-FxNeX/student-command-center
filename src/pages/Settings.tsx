import { Link } from "react-router-dom";
import type { SVGProps } from "react";
import {
  AboutIcon,
  AiIcon,
  AppearanceIcon,
  CompanionIcon,
  DataIcon,
  GeneralIcon,
  PrivacyIcon,
  SpotifyIcon,
} from "@/features/settings/icons";
import { SETTINGS_CATEGORIES } from "@/features/settings/settingsCategories";
import { PageContainer, PageHeader } from "@/components/ui/PageHeader";

const ICONS: Record<string, (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  general: GeneralIcon,
  appearance: AppearanceIcon,
  ai: AiIcon,
  companion: CompanionIcon,
  spotify: SpotifyIcon,
  data: DataIcon,
  privacy: PrivacyIcon,
  about: AboutIcon,
};

export function SettingsPage() {
  return (
    <PageContainer size="settings">
      <PageHeader
        title="Settings"
        description="Configure how Student Command Center looks and behaves."
      />

      <div className="grid sm:grid-cols-2 gap-3">
        {SETTINGS_CATEGORIES.map((cat) => {
          const Icon = ICONS[cat.key];
          return (
            <Link
              key={cat.key}
              to={cat.path}
              className="group rounded-card border border-border bg-surface p-4 flex items-start gap-3 transition-all duration-150 hover:-translate-y-0.5 hover:border-accent hover:shadow-md motion-reduce:hover:translate-y-0"
            >
              <span className="shrink-0 w-9 h-9 rounded-md bg-accent-soft text-accent-text flex items-center justify-center">
                <Icon className="w-4 h-4" />
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-sm group-hover:text-accent-text transition-colors">
                  {cat.label}
                </span>
                <span className="block text-xs text-text-secondary mt-0.5">{cat.description}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </PageContainer>
  );
}
