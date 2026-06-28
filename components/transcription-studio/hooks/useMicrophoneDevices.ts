import { useCallback, useEffect, useState } from "react";

export interface MicrophoneDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

export interface UseMicrophoneDevicesResult {
	devices: MicrophoneDevice[];
	hasPermission: boolean;
	isEnumerating: boolean;
	errorMessage: string;
	/**
	 * Triggers a microphone permission prompt so the browser will surface
	 * populated device labels. Safe to call multiple times; it re-resolves
	 * with the current permission state.
	 */
	requestPermission: () => Promise<boolean>;
	refresh: () => Promise<void>;
}

const DEFAULT_DEVICE: MicrophoneDevice = {
	deviceId: "",
	label: "System default microphone",
	groupId: "",
};

function isAudioInput(device: MediaDeviceInfo): boolean {
	return device.kind === "audioinput";
}

function toMicrophoneDevice(
	device: MediaDeviceInfo,
	index: number,
): MicrophoneDevice {
	const trimmedLabel = (device.label ?? "").trim();
	const fallbackLabel = `Microphone ${index + 1}`;
	return {
		deviceId: device.deviceId,
		label: trimmedLabel.length > 0 ? trimmedLabel : fallbackLabel,
		groupId: device.groupId,
	};
}

async function readAudioInputDevices(): Promise<MediaDeviceInfo[]> {
	if (
		typeof navigator === "undefined" ||
		!navigator.mediaDevices?.enumerateDevices
	) {
		return [];
	}

	const devices = await navigator.mediaDevices.enumerateDevices();
	return devices.filter(isAudioInput);
}

async function detectMicrophonePermission(): Promise<boolean> {
	if (typeof navigator === "undefined" || !navigator.permissions?.query) {
		return false;
	}

	try {
		const status = await navigator.permissions.query({
			// `name` is a non-standard but widely-supported extension for microphone.
			name: "microphone" as PermissionName,
		});
		return status.state === "granted";
	} catch {
		// Some browsers (Safari) reject unknown permission names; treat as unknown.
		return false;
	}
}

export function useMicrophoneDevices(): UseMicrophoneDevicesResult {
	const [devices, setDevices] = useState<MicrophoneDevice[]>([DEFAULT_DEVICE]);
	const [hasPermission, setHasPermission] = useState<boolean>(false);
	const [isEnumerating, setIsEnumerating] = useState<boolean>(false);
	const [errorMessage, setErrorMessage] = useState<string>("");

	const refresh = useCallback(async (): Promise<void> => {
		setIsEnumerating(true);
		try {
			const raw = await readAudioInputDevices();
			const mapped: MicrophoneDevice[] = [
				DEFAULT_DEVICE,
				...raw.map((device, index) => toMicrophoneDevice(device, index)),
			];

			// Deduplicate by deviceId while keeping the "System default" entry first.
			const seen = new Set<string>();
			const deduped: MicrophoneDevice[] = [];
			for (const device of mapped) {
				const key = device.deviceId || "__default__";
				if (seen.has(key)) continue;
				seen.add(key);
				deduped.push(device);
			}

			setDevices(deduped);
			setErrorMessage("");
		} catch (error) {
			setErrorMessage(`Unable to enumerate microphones: ${String(error)}`);
		} finally {
			setIsEnumerating(false);
		}
	}, []);

	const requestPermission = useCallback(async (): Promise<boolean> => {
		if (
			typeof navigator === "undefined" ||
			!navigator.mediaDevices?.getUserMedia
		) {
			setErrorMessage(
				"Microphone access is not available in this environment.",
			);
			return false;
		}

		try {
			// Explicit audio constraints help the underlying webview (notably
			// WebKitGTK on Linux/Ubuntu) request microphone-only access from
			// the xdg-desktop-portal. Without them, the portal sometimes
			// surfaces a camera permission prompt even though no video is
			// requested.
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: { ideal: true },
					noiseSuppression: { ideal: true },
					autoGainControl: { ideal: true },
				},
				video: false,
			});
			stream.getTracks().forEach((track) => track.stop());
			setHasPermission(true);
			setErrorMessage("");
			await refresh();
			return true;
		} catch (error) {
			setHasPermission(false);
			setErrorMessage(`Microphone permission denied: ${String(error)}`);
			return false;
		}
	}, [refresh]);

	useEffect(() => {
		if (typeof navigator === "undefined" || !navigator.mediaDevices) {
			return;
		}

		void refresh();
		void detectMicrophonePermission().then((granted) => {
			setHasPermission(granted);
			if (granted) {
				// Permission already granted: re-query to populate labels.
				void refresh();
			}
		});

		const handleDeviceChange = () => {
			void refresh();
		};

		navigator.mediaDevices.addEventListener?.(
			"devicechange",
			handleDeviceChange,
		);
		return () => {
			navigator.mediaDevices.removeEventListener?.(
				"devicechange",
				handleDeviceChange,
			);
		};
	}, [refresh]);

	return {
		devices,
		hasPermission,
		isEnumerating,
		errorMessage,
		requestPermission,
		refresh,
	};
}
