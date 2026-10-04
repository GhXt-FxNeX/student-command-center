import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Input, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SettingsSaveError, useSettingsSave } from "@/features/settings/useSettingsSave";
import {
  deleteAiApiKey,
  getAiUsageStats,
  getProviderStatuses,
  hasAiApiKey,
  setAiApiKey,
  testAiConnection,
} from "@/lib/ipc/ai";
import { formatCurrency } from "@/lib/currency";
import { FieldMessage } from "@/components/ui/Callout";
import {
  SavedIndicator,
  SettingsCategoryLayout,
  SettingsSectionTitle,
} from "@/features/settings/SettingsCategoryLayout";
import type {
  AiGeminiTier,
  AiProviderName,
  AiUsageStats,
  ProviderStatusInfo,
  TestCallResult,
  UserSettings,
} from "@/types";

const ROUTING_OPTIONS: { value: "automatic" | "manual"; label: string }[] = [
  { value: "automatic", label: "Automatic" },
  { value: "manual", label: "Manual" },
];

const SPENDING_PRESETS: { value: string; label: string }[] = [0, 1, 5, 10].map((n) => ({
  value: String(n),
  label: `$${n}`,
}));

interface Props {
  settings: UserSettings;
  onSettingsChange: (s: UserSettings) => void;
}

export function SettingsAiPage({ settings, onSettingsChange }: Props) {
  const { draft, setDraft, save, saving, saved, error: saveError, clearError: clearSaveError } = useSettingsSave(
    settings,
    onSettingsChange
  );

  const [geminiKeyDraft, setGeminiKeyDraft] = useState("");
  const [openrouterKeyDraft, setOpenrouterKeyDraft] = useState("");
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [hasOpenrouterKey, setHasOpenrouterKey] = useState(false);
  const [keyBusy, setKeyBusy] = useState<AiProviderName | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatusInfo[] | null>(null);
  const [usageStats, setUsageStats] = useState<AiUsageStats | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestCallResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  async function refreshAiStatus() {
    try {
      const [g, o, statuses, usage] = await Promise.all([
        hasAiApiKey("gemini"),
        hasAiApiKey("openrouter"),
        getProviderStatuses(),
        getAiUsageStats(),
      ]);
      setHasGeminiKey(g);
      setHasOpenrouterKey(o);
      setProviderStatuses(statuses);
      setUsageStats(usage);
    } catch (e) {
      setKeyError(String(e));
    }
  }

  useEffect(() => {
    refreshAiStatus();
  }, []);

  async function saveApiKey(provider: AiProviderName, value: string) {
    if (!value.trim()) return;
    setKeyBusy(provider);
    setKeyError(null);
    try {
      await setAiApiKey(provider, value.trim());
      if (provider === "gemini") setGeminiKeyDraft("");
      if (provider === "openrouter") setOpenrouterKeyDraft("");
      await refreshAiStatus();
    } catch (e) {
      setKeyError(String(e));
    } finally {
      setKeyBusy(null);
    }
  }

  async function removeApiKey(provider: AiProviderName) {
    setKeyBusy(provider);
    setKeyError(null);
    try {
      await deleteAiApiKey(provider);
      await refreshAiStatus();
    } catch (e) {
      setKeyError(String(e));
    } finally {
      setKeyBusy(null);
    }
  }

  async function runTestConnection() {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const result = await testAiConnection();
      setTestResult(result);
      await refreshAiStatus(); // usage stats changed after a real call
    } catch (e) {
      setTestError(String(e));
    } finally {
      setTesting(false);
    }
  }

  function statusDot(provider: AiProviderName): { color: string; label: string } {
    const info = providerStatuses?.find((p) => p.provider === provider);
    if (!info) return { color: "bg-text-secondary", label: "Checking…" };
    if (info.status === "connected") return { color: "bg-emerald-500", label: "Connected" };
    return { color: "bg-text-secondary", label: "Not configured" };
  }

  return (
    <SettingsCategoryLayout title="AI" description="Provider, models, API keys, and spending limits.">
      <SettingsSaveError error={saveError} onDismiss={clearSaveError} />
      <Card>
        <SettingsSectionTitle>Provider &amp; routing</SettingsSectionTitle>
        <label className="block text-sm text-text-secondary mb-2">Routing</label>
        <SegmentedControl ariaLabel="AI routing mode"
          className="mb-4"
          options={ROUTING_OPTIONS}
          value={draft.aiRoutingMode}
          onChange={(mode) => save({ ...draft, aiRoutingMode: mode })}
        />
        <p className="text-xs text-text-secondary mb-4">
          {draft.aiRoutingMode === "automatic"
            ? "Simple tasks use Gemini Flash; complex tasks use Gemini Pro. Cost protection below can override this to a free provider."
            : "Every AI request uses the provider/model picked below, subject to cost protection."}
        </p>

        {draft.aiRoutingMode === "manual" && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <label className="text-sm text-text-secondary">
              Provider
              <Select
                size="sm"
                className="mt-1 w-full"
                value={draft.aiManualProvider}
                onChange={(e) => save({ ...draft, aiManualProvider: e.target.value as AiProviderName })}
              >
                <option value="gemini">Gemini</option>
                <option value="openrouter">OpenRouter</option>
              </Select>
            </label>
            {draft.aiManualProvider === "gemini" && (
              <label className="text-sm text-text-secondary">
                Gemini tier
                <Select
                  size="sm"
                  className="mt-1 w-full"
                  value={draft.aiManualGeminiTier}
                  onChange={(e) => save({ ...draft, aiManualGeminiTier: e.target.value as AiGeminiTier })}
                >
                  <option value="flash">Flash (fast, low-cost)</option>
                  <option value="pro">Pro (complex reasoning)</option>
                </Select>
              </label>
            )}
          </div>
        )}

        <label htmlFor="f-gemini-flash-model" className="block text-sm text-text-secondary mb-1">Gemini Flash model</label>
        <Input id="f-gemini-flash-model"
          className="w-full mb-3"
          value={draft.aiGeminiFlashModel}
          onChange={(e) => setDraft({ ...draft, aiGeminiFlashModel: e.target.value })}
          onBlur={() => save(draft)}
        />
        <label htmlFor="f-gemini-pro-model" className="block text-sm text-text-secondary mb-1">Gemini Pro model</label>
        <Input id="f-gemini-pro-model"
          className="w-full mb-3"
          value={draft.aiGeminiProModel}
          onChange={(e) => setDraft({ ...draft, aiGeminiProModel: e.target.value })}
          onBlur={() => save(draft)}
        />
        <label htmlFor="f-openrouter-model" className="block text-sm text-text-secondary mb-1">OpenRouter model</label>
        <Input id="f-openrouter-model"
          className="w-full mb-3"
          value={draft.aiOpenrouterModel}
          onChange={(e) => setDraft({ ...draft, aiOpenrouterModel: e.target.value })}
          onBlur={() => save(draft)}
        />
        <p className="text-xs text-text-secondary mb-3">
          "openrouter/free" auto-picks a $0 model regardless of your spending limit. Model names
          (especially Gemini's) change over time — if a request fails with "model not found", check
          the current name against the provider's docs and update it here.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-text-secondary">
            Temperature (0–2)
            <Input
              type="number"
              size="sm"
              min={0}
              max={2}
              step="0.1"
              className="mt-1 w-full"
              value={draft.aiTemperature}
              onChange={(e) => setDraft({ ...draft, aiTemperature: Number(e.target.value) })}
              onBlur={() => save(draft)}
            />
          </label>
          <label className="text-sm text-text-secondary">
            Max output tokens
            <Input
              type="number"
              size="sm"
              min={1}
              className="mt-1 w-full"
              value={draft.aiMaxOutputTokens}
              onChange={(e) => setDraft({ ...draft, aiMaxOutputTokens: Number(e.target.value) || 1 })}
              onBlur={() => save(draft)}
            />
          </label>
        </div>
      </Card>

      <Card>
        <SettingsSectionTitle>API &amp; connection</SettingsSectionTitle>
        {keyError && <FieldMessage className="mb-3">{keyError}</FieldMessage>}

        {[
          {
            provider: "gemini" as AiProviderName,
            label: "Gemini API key",
            draft: geminiKeyDraft,
            setDraft: setGeminiKeyDraft,
            hasKey: hasGeminiKey,
          },
          {
            provider: "openrouter" as AiProviderName,
            label: "OpenRouter API key",
            draft: openrouterKeyDraft,
            setDraft: setOpenrouterKeyDraft,
            hasKey: hasOpenrouterKey,
          },
        ].map((row) => {
          const dot = statusDot(row.provider);
          return (
            <div key={row.provider} className="mb-4">
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${dot.color}`} />
                <label className="text-sm text-text-secondary">
                  {row.label} — <span className="text-xs">{dot.label}</span>
                </label>
              </div>
              <div className="flex gap-2">
                <Input
                  type="password"
                  aria-label={`${row.label} API key`}
                  placeholder={row.hasKey ? "•••••••••••• (already set)" : "Paste your API key"}
                  className="flex-1"
                  value={row.draft}
                  onChange={(e) => row.setDraft(e.target.value)}
                />
                <Button
                  variant="primary"
                  disabled={keyBusy === row.provider || !row.draft.trim()}
                  onClick={() => saveApiKey(row.provider, row.draft)}
                  className="shrink-0"
                >
                  Save
                </Button>
                {row.hasKey && (
                  <Button
                    variant="secondary"
                    disabled={keyBusy === row.provider}
                    onClick={() => removeApiKey(row.provider)}
                    className="shrink-0"
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        <Button variant="ghost" onClick={refreshAiStatus}>
          Refresh status
        </Button>

        <div className="mt-4 pt-4 border-t border-border">
          <Button variant="primary" size="md" disabled={testing} onClick={runTestConnection}>
            {testing ? "Testing…" : "Test AI connection"}
          </Button>
          <p className="text-xs text-text-secondary mt-1">
            Sends one short prompt through your current routing/provider settings — proves the
            connection works without doing anything else.
          </p>

          {testError && <FieldMessage className="mt-3 whitespace-pre-wrap">{testError}</FieldMessage>}
          {testResult && (
            <div className="mt-3 rounded-md border border-border bg-bg p-3 text-sm">
              <p className="text-xs text-text-secondary mb-1">
                {testResult.provider} · {testResult.model} — {testResult.reason}
              </p>
              <p>{testResult.responseText}</p>
              {(testResult.inputTokens !== null || testResult.outputTokens !== null) && (
                <p className="text-xs text-text-secondary mt-1">
                  {testResult.inputTokens ?? "?"} in / {testResult.outputTokens ?? "?"} out tokens
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <SettingsSectionTitle>Limits &amp; safety</SettingsSectionTitle>
        <label className="block text-sm text-text-secondary mb-2">Monthly AI spending limit</label>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <SegmentedControl ariaLabel="Monthly spending limit presets"
            options={SPENDING_PRESETS}
            value={String(draft.aiMonthlySpendingLimitUsd)}
            onChange={(v) => save({ ...draft, aiMonthlySpendingLimitUsd: Number(v) })}
          />
          <span className="text-xs text-text-secondary">or custom:</span>
          <Input
            type="number"
            size="sm"
            min={0}
            step="0.01"
            aria-label="Custom monthly spending limit in US dollars"
            className="w-24"
            value={draft.aiMonthlySpendingLimitUsd}
            onChange={(e) => setDraft({ ...draft, aiMonthlySpendingLimitUsd: Number(e.target.value) || 0 })}
            onBlur={() => save(draft)}
          />
        </div>
        <p className="text-xs text-text-secondary mb-4">
          $0 means AI generation never intentionally makes a paid request — Gemini Flash (within
          Google's free Standard-API allowance) or a confirmed free OpenRouter model will be used;
          Gemini Pro always requires paid usage and stays blocked at $0. If Flash's free quota is
          exhausted, generation automatically falls back to a free OpenRouter model rather than risk
          a paid Gemini request. Above $0, paid requests stop once your spend reaches the limit —
          this covers OpenRouter, which reports a cost for every request. Gemini Pro is guarded
          separately, by request count (below), because Gemini doesn't report prices.
        </p>

        <div className="mb-4">
          <label htmlFor="f-pro-cap" className="block text-sm text-text-secondary mb-2">
            Gemini Pro requests per month
          </label>
          <Input
            id="f-pro-cap"
            type="number"
            min={0}
            max={10000}
            step={1}
            className="w-24"
            value={draft.aiProMonthlyRequestCap}
            onChange={(e) =>
              setDraft({
                ...draft,
                aiProMonthlyRequestCap: Math.max(0, Math.min(10000, Math.round(Number(e.target.value) || 0))),
              })
            }
            onBlur={() => save(draft)}
          />
          <p className="text-xs text-text-secondary mt-2">
            Gemini doesn't tell us what a Pro request costs, so its usage can't be added up in dollars.
            Instead, once this many paid Gemini requests have been made this month (failed attempts
            included), Pro stops until next month or until you raise this number. It only applies when
            your spending limit is above $0 — at $0, Pro is always blocked. Set it to 0 to turn Gemini Pro
            off completely. Flash and OpenRouter aren't counted here.
          </p>
        </div>
        <p className="text-xs text-text-secondary mb-4">
          Note: Google enforces Gemini's free tier via rate limits, not a mode this app can request —
          if billing is ever enabled on the Google Cloud project behind your API key, a request beyond
          the free allowance would be billed automatically with nothing in the response to tell us
          that happened. This app cannot see or prevent that; the guarantee above only holds as long
          as no billing is attached to that project.
        </p>

        {usageStats && (
          <div>
            <div className="flex items-baseline justify-between">
              <p className="text-text-secondary text-sm">This month</p>
              <p className="text-sm font-medium">
                {formatCurrency(usageStats.monthSpentUsd, "USD")}
                {usageStats.monthlySpendingLimitUsd > 0 && (
                  <span className="text-text-secondary">
                    {" "}
                    / {formatCurrency(usageStats.monthlySpendingLimitUsd, "USD")}
                  </span>
                )}
              </p>
            </div>
            {(usageStats.monthlySpendingLimitUsd > 0 || usageStats.proRequestsThisMonth > 0) && (
              <div className="flex items-baseline justify-between mt-1">
                <p className="text-text-secondary text-sm">Gemini Pro requests</p>
                <p
                  className={`text-sm font-medium ${
                    usageStats.proRequestsThisMonth >= usageStats.proRequestCap ? "text-red-600 dark:text-red-400" : ""
                  }`}
                >
                  {usageStats.proRequestsThisMonth}
                  <span className="text-text-secondary"> / {usageStats.proRequestCap}</span>
                </p>
              </div>
            )}
            {usageStats.byProvider.length > 0 && (
              <div className="mt-2 space-y-1">
                {usageStats.byProvider.map((p) => (
                  <div
                    key={`${p.provider}-${p.model}`}
                    className="flex items-center justify-between text-xs text-text-secondary gap-2"
                  >
                    <span className="min-w-0 truncate">
                      <span className="capitalize">{p.provider}</span> · {p.model}{" "}
                      <span
                        className={`rounded px-1 ${
                          p.tier === "free" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        }`}
                      >
                        {p.tier}
                      </span>
                      {" — "}
                      {p.requestCount} request{p.requestCount === 1 ? "" : "s"}
                      {p.errorCount > 0 ? ` (${p.errorCount} failed)` : ""}
                    </span>
                    <span className="shrink-0">
                      {p.estimatedCostUsd !== null
                        ? formatCurrency(p.estimatedCostUsd, "USD")
                        : p.tier === "free"
                          ? "Free"
                          : "Cost unavailable — not counted toward your limit"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <SavedIndicator saving={saving} saved={saved} />
    </SettingsCategoryLayout>
  );
}
