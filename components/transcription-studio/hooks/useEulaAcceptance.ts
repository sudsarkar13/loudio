import { useEffect, useState } from "react";
import { closeDesktopApp } from "@/lib/tauri";
import {
	EULA_STORAGE_KEY,
	EULA_VERSION,
	LEGACY_EULA_STORAGE_KEY,
} from "@/components/transcription-studio/constants";

interface EulaAcceptanceRecord {
	version: string;
	acceptedAt: string;
}

export interface UseEulaAcceptanceResult {
	hasAcceptedEula: boolean;
	isCheckingEula: boolean;
	onAccept: () => Promise<void>;
	onDecline: () => Promise<void>;
}

function hasAcceptedCurrentEulaVersion(): boolean {
	if (typeof window === "undefined") return true;

	const raw = window.localStorage.getItem(EULA_STORAGE_KEY);
	if (!raw) return false;

	try {
		const parsed = JSON.parse(raw) as EulaAcceptanceRecord;
		return parsed.version === EULA_VERSION;
	} catch {
		return false;
	}
}

function persistCurrentEulaAcceptance(): void {
	if (typeof window === "undefined") return;

	const acceptance: EulaAcceptanceRecord = {
		version: EULA_VERSION,
		acceptedAt: new Date().toISOString(),
	};

	window.localStorage.setItem(EULA_STORAGE_KEY, JSON.stringify(acceptance));
	window.localStorage.removeItem(LEGACY_EULA_STORAGE_KEY);
}

export function useEulaAcceptance(
	setStatus: (value: string) => void,
): UseEulaAcceptanceResult {
	const [hasAcceptedEula, setHasAcceptedEula] = useState<boolean>(false);
	const [isCheckingEula, setIsCheckingEula] = useState<boolean>(true);

	useEffect(() => {
		if (typeof window === "undefined") {
			setHasAcceptedEula(true);
			setIsCheckingEula(false);
			return;
		}

		const acceptedCurrentEula = hasAcceptedCurrentEulaVersion();
		const acceptedLegacyEula =
			window.localStorage.getItem(LEGACY_EULA_STORAGE_KEY) === "true";
		const accepted = acceptedCurrentEula || acceptedLegacyEula;

		if (!acceptedCurrentEula && acceptedLegacyEula) {
			persistCurrentEulaAcceptance();
		}

		setHasAcceptedEula(accepted);
		setIsCheckingEula(false);
	}, []);

	async function onAccept(): Promise<void> {
		persistCurrentEulaAcceptance();
		setHasAcceptedEula(true);
		setStatus(
			`License terms (${EULA_VERSION}) accepted. Preparing runtime dependencies…`,
		);
	}

	async function onDecline(): Promise<void> {
		setStatus("EULA declined. Closing Loudio.");
		await closeDesktopApp();
	}

	return {
		hasAcceptedEula,
		isCheckingEula,
		onAccept,
		onDecline,
	};
}
