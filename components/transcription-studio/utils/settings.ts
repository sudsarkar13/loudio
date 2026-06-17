import { DEFAULT_SETTINGS } from "@/lib/defaults";
import type { AppSettings } from "@/lib/types";

/**
 * Merges persisted settings with defaults to keep new fields backward compatible.
 */
export function mergeSettings(incoming: AppSettings | null): AppSettings {
  if (!incoming) {
    return DEFAULT_SETTINGS;
  }

  return {
    ...DEFAULT_SETTINGS,
    ...incoming,
  };
}
