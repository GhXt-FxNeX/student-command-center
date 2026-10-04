import { invoke } from "@tauri-apps/api/core";
import type { AiProviderName, AiUsageStats, ProviderStatusInfo, TestCallResult } from "@/types";

/** Only ever reports whether a key is set — the key itself never leaves
 * the OS keychain / crosses back into the frontend. */
export function hasAiApiKey(provider: AiProviderName): Promise<boolean> {
  return invoke("has_ai_api_key", { provider });
}

export function setAiApiKey(provider: AiProviderName, key: string): Promise<void> {
  return invoke("set_ai_api_key", { provider, key });
}

export function deleteAiApiKey(provider: AiProviderName): Promise<void> {
  return invoke("delete_ai_api_key", { provider });
}

export function getProviderStatuses(): Promise<ProviderStatusInfo[]> {
  return invoke("get_provider_statuses");
}

export function testAiConnection(): Promise<TestCallResult> {
  return invoke("test_ai_connection");
}

export function getAiUsageStats(): Promise<AiUsageStats> {
  return invoke("get_ai_usage_stats");
}
