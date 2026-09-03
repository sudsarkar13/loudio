import { useCallback, useEffect, useRef, useState } from "react";
import { logDiagnostic } from "@/lib/diagnostics";

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

/**
 * Remembers that capture has been granted at least once.
 *
 * The webview cannot tell us. `navigator.permissions.query({name:
 * "microphone"})` is unimplemented in WKWebView and rejects, and
 * `enumerateDevices()` withholds labels until a `getUserMedia` call has
 * succeeded *in the current page session* — it returns a single unlabelled
 * placeholder before that. So on every cold start both permission signals read
 * as "no", even though the OS grant (macOS TCC, which is per app bundle and
 * permanent) is still in force. That is why the app asked for access on every
 * launch: it had no way to observe a grant it already held.
 *
 * The grant therefore has to be remembered on our side.
 */
const GRANT_MEMORY_KEY = "loudio:mic:granted:v1";

function readRememberedGrant(): boolean {
	try {
		return window.localStorage.getItem(GRANT_MEMORY_KEY) === "true";
	} catch {
		// Private browsing and hardened webviews can throw on access.
		return false;
	}
}

function rememberGrant(granted: boolean): void {
	try {
		if (granted) {
			window.localStorage.setItem(GRANT_MEMORY_KEY, "true");
		} else {
			window.localStorage.removeItem(GRANT_MEMORY_KEY);
		}
	} catch {
		// Losing the memory only costs an extra prompt; never fail the caller.
	}
}

/**
 * Whether a `getUserMedia` rejection means the user actually denied access.
 *
 * Only these justify forgetting a remembered grant. An unplugged interface
 * raises `NotFoundError` and a device held by another app raises
 * `NotReadableError` — neither is a permission decision, and treating them as
 * one would put the "Grant microphone access" button back in front of a user
 * who has nothing left to grant.
 */
function isPermissionDenial(error: unknown): boolean {
	const name = (error as { name?: string } | null)?.name ?? "";
	return name === "NotAllowedError" || name === "SecurityError";
}

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
	// React 18 mounts effects twice in development; without this the silent
	// re-prime would open two capture streams on every dev reload.
	const primedRef = useRef<boolean>(false);

	const refresh = useCallback(async (): Promise<void> => {
		setIsEnumerating(true);
		try {
			const raw = await readAudioInputDevices();

			// Labels are the one portable permission signal, but only a positive
			// one: their absence means "not yet granted *in this session*", not
			// "not granted". See GRANT_MEMORY_KEY.
			const labelled = raw.filter(
				(device) => (device.label ?? "").trim().length > 0,
			).length;

			logDiagnostic("info", "mic", "Enumerated audio inputs", {
				deviceCount: raw.length,
				labelledCount: labelled,
			});

			// Labels are proof: a webview only exposes them once capture has
			// been granted, so seeing one is enough to record the grant even if
			// it was earned by the recorder rather than by the button.
			if (labelled > 0) {
				setHasPermission(true);
				rememberGrant(true);
			}

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
			rememberGrant(true);
			setErrorMessage("");
			await refresh();
			return true;
		} catch (error) {
			const denied = isPermissionDenial(error);
			logDiagnostic("warn", "mic", "Capture request failed", {
				name: (error as { name?: string } | null)?.name ?? "unknown",
				treatedAsDenial: denied,
			});

			if (denied) {
				// A real denial: forget the grant so the button comes back.
				setHasPermission(false);
				rememberGrant(false);
				setErrorMessage(`Microphone permission denied: ${String(error)}`);
			} else {
				// The device failed, not the permission. Report it without
				// claiming access was revoked.
				setErrorMessage(`Microphone unavailable: ${String(error)}`);
			}
			return false;
		}
	}, [refresh]);

	useEffect(() => {
		if (typeof navigator === "undefined" || !navigator.mediaDevices) {
			return;
		}

		// Restore the remembered grant before anything async runs, so the
		// "Grant microphone access" button never flashes for a user who has
		// already granted it.
		const remembered = readRememberedGrant();
		if (remembered) {
			setHasPermission(true);
		}

		void refresh();

		// Re-prime capture so the webview releases the real device labels.
		//
		// Gated on the remembered grant, which makes this silent: the OS only
		// prompts the first time, and that first time is always a deliberate
		// click on the button below. A first-run user is never ambushed by a
		// permission dialog they did not ask for — on macOS or on Linux, where
		// this would otherwise reach xdg-desktop-portal.
		if (remembered && !primedRef.current) {
			primedRef.current = true;
			void navigator.mediaDevices
				.getUserMedia({ audio: true, video: false })
				.then((stream) => {
					stream.getTracks().forEach((track) => track.stop());
					void refresh();
				})
				.catch((error: unknown) => {
					logDiagnostic("warn", "mic", "Silent re-prime failed", {
						name: (error as { name?: string } | null)?.name ?? "unknown",
					});
					// Revoked in System Settings since we last recorded a grant.
					if (isPermissionDenial(error)) {
						setHasPermission(false);
						rememberGrant(false);
					}
				});
		}

		void detectMicrophonePermission().then((granted) => {
			// Only ever promotes. The query is unsupported on some webviews and
			// resolves false there, which would otherwise undo the label-based
			// detection above.
			if (!granted) return;
			setHasPermission(true);
			// Permission already granted: re-query to populate labels.
			void refresh();
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
