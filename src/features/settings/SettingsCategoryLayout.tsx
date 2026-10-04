import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BackChevronIcon } from "./icons";
import { PageContainer, PageHeader } from "@/components/ui/PageHeader";

/**
 * Wraps every Settings category subpage (Settings -> AI, Settings ->
 * Appearance, etc.) with the same back-navigation link, title, and
 * description — so navigating in/out of a category feels like a real
 * desktop Preferences app rather than a plain route change.
 */
export function SettingsCategoryLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <PageContainer size="settings">
      <Link
        to="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text transition-colors"
      >
        <BackChevronIcon className="w-3.5 h-3.5" />
        Settings
      </Link>
      <PageHeader title={title} description={description} />
      <div className="space-y-6">{children}</div>
    </PageContainer>
  );
}

/** Card-internal section heading — same look every settings card used to
 * share when they were all stacked on one page. */
export function SettingsSectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="font-medium mb-3">{children}</h2>;
}

/** The little "Saving… / Saved" line every settings page with editable
 * fields shows at the bottom, reserving its height so the page doesn't
 * jump when the text appears/disappears. */
export function SavedIndicator({ saving, saved }: { saving: boolean; saved: boolean }) {
  return <p className="text-xs text-text-secondary h-4">{saving ? "Saving…" : saved ? "Saved" : ""}</p>;
}
