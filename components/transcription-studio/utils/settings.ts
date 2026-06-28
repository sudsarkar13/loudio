import { DEFAULT_SETTINGS } from "@/lib/defaults";
import type { AppSettings } from "@/lib/types";

const LEGACY_PROFILE_IDS: Record<string, string> = {
	"recommended-m1": "recommended-local",
};

/**
 * Merges persisted settings with defaults to keep new fields backward compatible.
 */
export function mergeSettings(incoming: AppSettings | null): AppSettings {
	if (!incoming) {
		return DEFAULT_SETTINGS;
	}

	const merged = {
		...DEFAULT_SETTINGS,
		...incoming,
	};

	return {
		...merged,
		profileId: LEGACY_PROFILE_IDS[merged.profileId] ?? merged.profileId,
	};
}
