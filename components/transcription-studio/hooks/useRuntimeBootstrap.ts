import { useEffect, useRef, useState } from "react";
import {
	getPersistedSettings,
	getRuntimeProfiles,
	listenRuntimeBootstrapProgress,
	runRuntimeBootstrap,
	savePersistedSettings,
} from "@/lib/tauri";
import type { AppSettings, RuntimeProfile } from "@/lib/types";
import { RUNTIME_PROFILES } from "@/lib/defaults";
import { mergeSettings } from "@/components/transcription-studio/utils/settings";

export interface UseRuntimeBootstrapResult {
	profiles: RuntimeProfile[];
	setProfiles: React.Dispatch<React.SetStateAction<RuntimeProfile[]>>;
	settings: AppSettings;
	setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
	isBootstrapping: boolean;
	runtimeBootstrapPercent: number;
	runtimeBootstrapMessage: string;
	hasCompletedRuntimeSetup: boolean;
}

interface UseRuntimeBootstrapOptions {
	hasAcceptedEula: boolean;
	isCheckingEula: boolean;
	setStatus: (value: string) => void;
}

export function useRuntimeBootstrap({
	hasAcceptedEula,
	isCheckingEula,
	setStatus,
}: UseRuntimeBootstrapOptions): UseRuntimeBootstrapResult {
	const [profiles, setProfiles] = useState<RuntimeProfile[]>(RUNTIME_PROFILES);
	const [settings, setSettings] = useState<AppSettings>(() =>
		mergeSettings(null),
	);
	const [runtimeBootstrapPercent, setRuntimeBootstrapPercent] =
		useState<number>(0);
	const [runtimeBootstrapMessage, setRuntimeBootstrapMessage] =
		useState<string>("Waiting for EULA acceptance…");
	const [isBootstrapping, setIsBootstrapping] = useState<boolean>(false);
	const [hasCompletedRuntimeSetup, setHasCompletedRuntimeSetup] =
		useState<boolean>(false);

	const bootstrapProgressUnlistenRef = useRef<(() => void) | null>(null);

	/**
	 * Whether settings have been read from disk yet.
	 *
	 * `settings` starts as the defaults, and the persist effect below fires on
	 * mount. Loading is gated behind the EULA check, so without this the
	 * defaults were written over the stored settings before anything read them
	 * — losing them outright for anyone who quit at the EULA screen, and
	 * immediately undoing the bundle-id migration that runs at startup.
	 */
	const hasLoadedSettingsRef = useRef<boolean>(false);

	useEffect(() => {
		if (isCheckingEula || !hasAcceptedEula || hasCompletedRuntimeSetup) {
			return;
		}

		let mounted = true;
		setIsBootstrapping(true);
		setRuntimeBootstrapPercent(0);
		setRuntimeBootstrapMessage("Preparing runtime…");
		setStatus("Preparing runtime…");

		async function init() {
			try {
				bootstrapProgressUnlistenRef.current =
					await listenRuntimeBootstrapProgress((event) => {
						if (!mounted) return;
						setRuntimeBootstrapPercent(event.percent);
						setRuntimeBootstrapMessage(event.message);
						setStatus(event.message);
					});

				const [saved, runtimeProfiles, runtimeMessage] = await Promise.all([
					getPersistedSettings(),
					getRuntimeProfiles().catch(() => RUNTIME_PROFILES),
					runRuntimeBootstrap(),
				]);

				if (!mounted) return;

				setSettings(mergeSettings(saved));
				hasLoadedSettingsRef.current = true;
				setProfiles(runtimeProfiles);
				setRuntimeBootstrapPercent(100);
				setRuntimeBootstrapMessage(runtimeMessage);
				setStatus(runtimeMessage);
			} catch (error) {
				if (!mounted) return;
				const message = `Runtime setup failed: ${String(error)}`;
				setRuntimeBootstrapMessage(message);
				setStatus(message);
			} finally {
				bootstrapProgressUnlistenRef.current?.();
				bootstrapProgressUnlistenRef.current = null;
				if (mounted) {
					setIsBootstrapping(false);
					setHasCompletedRuntimeSetup(true);
				}
			}
		}

		void init();

		return () => {
			mounted = false;
			bootstrapProgressUnlistenRef.current?.();
			bootstrapProgressUnlistenRef.current = null;
		};
	}, [hasAcceptedEula, hasCompletedRuntimeSetup, isCheckingEula, setStatus]);

	useEffect(() => {
		// Only persist once the stored settings have been read, so the initial
		// defaults never overwrite them.
		if (!hasLoadedSettingsRef.current) return;
		void savePersistedSettings(settings);
	}, [settings]);

	return {
		profiles,
		setProfiles,
		settings,
		setSettings,
		isBootstrapping,
		runtimeBootstrapPercent,
		runtimeBootstrapMessage,
		hasCompletedRuntimeSetup,
	};
}
