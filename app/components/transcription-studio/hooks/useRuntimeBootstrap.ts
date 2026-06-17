import { useEffect, useRef, useState } from "react";
import {
	getPersistedSettings,
	getRuntimeProfiles,
	listenRuntimeBootstrapProgress,
	runRuntimeBootstrap,
	savePersistedSettings,
} from "@/app/lib/tauri";
import type { AppSettings, RuntimeProfile } from "@/app/lib/types";
import { RUNTIME_PROFILES } from "@/app/lib/defaults";
import { mergeSettings } from "@/app/components/transcription-studio/utils/settings";

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
