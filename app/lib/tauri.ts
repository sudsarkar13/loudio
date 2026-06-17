"use client";

import { DEFAULT_SETTINGS, RUNTIME_PROFILES } from "@/app/lib/defaults";
import type {
	AppSettings,
	RecordingHistoryItem,
	RuntimeProfile,
	TranscriptionResponse,
} from "@/app/lib/types";

const COMPACT_WINDOW_WIDTH = 430;
const COMPACT_WINDOW_HEIGHT = 220;
const GENERAL_WINDOW_WIDTH = 1200;
const GENERAL_WINDOW_HEIGHT = 820;
const COMPACT_WINDOW_MARGIN_BOTTOM = 18;
const COMPACT_WINDOW_POSITION_KEY = "loudio:compact:window-position";

interface StoredWindowPosition {
	x: number;
	y: number;
}

export type CompactWindowAnchor = "top" | "bottom";

interface MicrophoneTranscriptionPayload {
	audioBase64: string;
	mimeType?: string;
	settings: AppSettings;
}

export interface RuntimeBootstrapProgressEvent {
	percent: number;
	message: string;
	done: boolean;
}

export interface TranscriptionProgressEvent {
	partialText?: string | null;
	status: string;
	done: boolean;
	error: boolean;
}

export function isTauriRuntime(): boolean {
	if (typeof window === "undefined") return false;

	const runtimeWindow = window as Window & {
		__TAURI_INTERNALS__?: { invoke?: unknown };
		__TAURI__?: { core?: unknown };
		isTauri?: boolean;
	};

	return Boolean(
		runtimeWindow.isTauri ||
		runtimeWindow.__TAURI_INTERNALS__?.invoke ||
		runtimeWindow.__TAURI__?.core,
	);
}

async function invokeCommand<T>(
	command: string,
	payload?: Record<string, unknown>,
): Promise<T> {
	if (!isTauriRuntime()) {
		throw new Error(
			"Tauri runtime not detected. Launch with `yarn tauri:dev`.",
		);
	}

	const tauriModule = await import("@tauri-apps/api/core");
	const invoke: <R>(cmd: string, args?: Record<string, unknown>) => Promise<R> =
		tauriModule.invoke;
	return invoke<T>(command, payload);
}

export async function listenRuntimeBootstrapProgress(
	callback: (payload: RuntimeBootstrapProgressEvent) => void,
): Promise<() => void> {
	if (!isTauriRuntime()) return () => {};
	const { listen } = await import("@tauri-apps/api/event");

	return listen<RuntimeBootstrapProgressEvent>(
		"runtime-bootstrap-progress",
		(event) => {
			callback(event.payload);
		},
	);
}

export async function listenTranscriptionProgress(
	callback: (payload: TranscriptionProgressEvent) => void,
): Promise<() => void> {
	if (!isTauriRuntime()) return () => {};
	const { listen } = await import("@tauri-apps/api/event");

	return listen<TranscriptionProgressEvent>(
		"transcription-progress",
		(event) => {
			callback(event.payload);
		},
	);
}

export async function getRuntimeProfiles(): Promise<RuntimeProfile[]> {
	if (!isTauriRuntime()) return RUNTIME_PROFILES;
	return invokeCommand<RuntimeProfile[]>("get_runtime_profiles");
}

export async function getPersistedSettings(): Promise<AppSettings | null> {
	if (!isTauriRuntime()) return DEFAULT_SETTINGS;
	return invokeCommand<AppSettings | null>("load_settings");
}

export async function savePersistedSettings(
	settings: AppSettings,
): Promise<void> {
	if (!isTauriRuntime()) return;
	await invokeCommand<void>("save_settings", { settings });
}

export async function runRuntimeBootstrap(): Promise<string> {
	if (!isTauriRuntime()) {
		return "Web preview mode. Runtime bootstrap available in Tauri desktop app.";
	}

	return invokeCommand<string>("bootstrap_runtime");
}

export async function chooseAudioFile(): Promise<string | null> {
	if (isTauriRuntime()) {
		const { open } = await import("@tauri-apps/plugin-dialog");
		const selected = await open({
			multiple: false,
			filters: [
				{
					name: "Audio",
					extensions: ["mp3", "wav", "m4a", "flac", "aac", "ogg"],
				},
			],
		});

		if (Array.isArray(selected)) return selected[0] ?? null;
		return selected;
	}

	return null;
}

export async function startTranscription(
	audioPath: string,
	settings: AppSettings,
): Promise<TranscriptionResponse> {
	return invokeCommand<TranscriptionResponse>("transcribe_audio", {
		request: { audioPath, settings },
	});
}

async function blobToBase64(blob: Blob): Promise<string> {
	const buffer = await blob.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	let binary = "";

	for (let index = 0; index < bytes.length; index += 1) {
		binary += String.fromCharCode(bytes[index]);
	}

	return btoa(binary);
}

export async function startMicrophoneTranscription(
	blob: Blob,
	settings: AppSettings,
): Promise<TranscriptionResponse> {
	if (!isTauriRuntime()) {
		throw new Error(
			"Microphone transcription is available in the Tauri desktop app.",
		);
	}

	const payload: MicrophoneTranscriptionPayload = {
		audioBase64: await blobToBase64(blob),
		mimeType: blob.type || undefined,
		settings,
	};

	return invokeCommand<TranscriptionResponse>("transcribe_microphone_audio", {
		request: payload,
	});
}

export async function listMicrophoneRecordingHistory(): Promise<
	RecordingHistoryItem[]
> {
	if (!isTauriRuntime()) return [];
	return invokeCommand<RecordingHistoryItem[]>("list_microphone_recordings");
}

export async function deleteMicrophoneRecording(
	absolutePath: string,
): Promise<void> {
	if (!isTauriRuntime()) return;
	await invokeCommand<void>("delete_microphone_recording", { absolutePath });
}

export async function getMicrophoneRecordingPlaybackUrl(
	absolutePath: string,
): Promise<string> {
	if (!isTauriRuntime()) {
		return absolutePath;
	}

	const { convertFileSrc } = await import("@tauri-apps/api/core");
	return convertFileSrc(absolutePath);
}

export async function copyToClipboard(text: string): Promise<void> {
	if (!text.trim()) return;

	if (isTauriRuntime()) {
		const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
		await writeText(text);
		return;
	}

	if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
	}
}

export async function exportTextFile(
	defaultName: string,
	content: string,
): Promise<boolean> {
	if (!content.trim()) return false;

	if (isTauriRuntime()) {
		const { save } = await import("@tauri-apps/plugin-dialog");
		const { writeTextFile } = await import("@tauri-apps/plugin-fs");

		const path = await save({
			defaultPath: defaultName,
			filters: [{ name: "Text", extensions: ["txt"] }],
		});

		if (!path) return false;
		await writeTextFile(path, content);
		return true;
	}

	const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = defaultName;
	anchor.click();
	URL.revokeObjectURL(url);
	return true;
}

export { setupDesktopAppMenu } from "@/app/lib/desktop-menu";
export type { DesktopMenuActions } from "@/app/lib/desktop-menu";

function getDefaultCompactWindowPosition(
	width: number,
	height: number,
): StoredWindowPosition | null {
	if (typeof window === "undefined") return null;

	const x = Math.max(0, Math.round((window.screen.availWidth - width) / 2));
	const y = Math.max(
		0,
		Math.round(
			window.screen.availHeight - height - COMPACT_WINDOW_MARGIN_BOTTOM,
		),
	);

	return { x, y };
}

function getDefaultGeneralWindowPosition(): StoredWindowPosition | null {
	if (typeof window === "undefined") return null;

	const x = Math.max(
		0,
		Math.round((window.screen.availWidth - GENERAL_WINDOW_WIDTH) / 2),
	);
	const y = Math.max(
		0,
		Math.round((window.screen.availHeight - GENERAL_WINDOW_HEIGHT) / 2),
	);

	return { x, y };
}

function getAnchoredCompactWindowPosition(
	anchor: CompactWindowAnchor,
): StoredWindowPosition | null {
	if (typeof window === "undefined") return null;

	const x = Math.max(
		0,
		Math.round((window.screen.availWidth - COMPACT_WINDOW_WIDTH) / 2),
	);
	const y =
		anchor === "top" ?
			COMPACT_WINDOW_MARGIN_BOTTOM
		:	Math.max(
				0,
				Math.round(
					window.screen.availHeight -
						COMPACT_WINDOW_HEIGHT -
						COMPACT_WINDOW_MARGIN_BOTTOM,
				),
			);

	return { x, y };
}

function readStoredCompactWindowPosition(): StoredWindowPosition | null {
	if (typeof window === "undefined") return null;

	const raw = window.localStorage.getItem(COMPACT_WINDOW_POSITION_KEY);
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as StoredWindowPosition;
		if (typeof parsed.x === "number" && typeof parsed.y === "number") {
			return parsed;
		}
	} catch {
		return null;
	}

	return null;
}

function writeStoredCompactWindowPosition(
	position: StoredWindowPosition,
): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(
		COMPACT_WINDOW_POSITION_KEY,
		JSON.stringify(position),
	);
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function isMacOS(): boolean {
	if (typeof navigator === "undefined") return false;
	return /mac/i.test(navigator.userAgent);
}

async function setWindowBackgroundColor(
	appWindow: any,
	color: [number, number, number, number],
): Promise<void> {
	const maybeWindow = appWindow as {
		setBackgroundColor?: (
			color: [number, number, number, number],
		) => Promise<void>;
	};

	try {
		if (maybeWindow.setBackgroundColor) {
			await maybeWindow.setBackgroundColor(color);
		}
	} catch {
		// Best effort only.
	}
}

export async function enterCompactWindowMode(): Promise<void> {
	if (!isTauriRuntime()) return;

	const [{ getCurrentWindow }, { LogicalPosition, LogicalSize }] =
		await Promise.all([
			import("@tauri-apps/api/window"),
			import("@tauri-apps/api/dpi"),
		]);

	const appWindow = getCurrentWindow();

	await setWindowBackgroundColor(appWindow, [17, 25, 38, 255]);
	await appWindow.setDecorations(false);
	await appWindow.setResizable(false);
	await appWindow.setMinimizable(true);
	await appWindow.setAlwaysOnTop(true);
	await appWindow.setSize(
		new LogicalSize(COMPACT_WINDOW_WIDTH, COMPACT_WINDOW_HEIGHT),
	);

	const position =
		readStoredCompactWindowPosition() ??
		getDefaultCompactWindowPosition(
			COMPACT_WINDOW_WIDTH,
			COMPACT_WINDOW_HEIGHT,
		);

	if (position) {
		await appWindow.setPosition(new LogicalPosition(position.x, position.y));
	}
}

async function restoreGeneralWindowFrame(appWindow: any): Promise<void> {
	const maybeWindow = appWindow as {
		isFullscreen?: () => Promise<boolean>;
		setFullscreen?: (value: boolean) => Promise<void>;
		isMaximized?: () => Promise<boolean>;
		unmaximize?: () => Promise<void>;
		show?: () => Promise<void>;
		setFocus?: () => Promise<void>;
	};

	try {
		if (
			maybeWindow.isFullscreen &&
			maybeWindow.setFullscreen &&
			(await maybeWindow.isFullscreen())
		) {
			await maybeWindow.setFullscreen(false);
		}
	} catch {
		// Best effort only.
	}

	try {
		if (
			maybeWindow.isMaximized &&
			maybeWindow.unmaximize &&
			(await maybeWindow.isMaximized())
		) {
			await maybeWindow.unmaximize();
		}
	} catch {
		// Best effort only.
	}

	await appWindow.setAlwaysOnTop(false);
	await appWindow.setResizable(true);
	await appWindow.setMinimizable(true);
	await setWindowBackgroundColor(appWindow, [11, 17, 27, 255]);

	if (isMacOS()) {
		await appWindow.setDecorations(false);
		await wait(28);
	}

	await appWindow.setDecorations(true);

	if (isMacOS()) {
		await wait(40);
		await appWindow.setDecorations(true);
	}

	try {
		if (maybeWindow.show) {
			await maybeWindow.show();
		}
		if (maybeWindow.setFocus) {
			await maybeWindow.setFocus();
		}
	} catch {
		// Best effort only.
	}
}

export async function exitCompactWindowMode(): Promise<void> {
	if (!isTauriRuntime()) return;

	const [{ getCurrentWindow }, { LogicalPosition, LogicalSize }] =
		await Promise.all([
			import("@tauri-apps/api/window"),
			import("@tauri-apps/api/dpi"),
		]);

	const appWindow = getCurrentWindow();
	const centeredGeneralPosition = getDefaultGeneralWindowPosition();

	await restoreGeneralWindowFrame(appWindow);
	await appWindow.setSize(
		new LogicalSize(GENERAL_WINDOW_WIDTH, GENERAL_WINDOW_HEIGHT),
	);

	if (centeredGeneralPosition) {
		await appWindow.setPosition(
			new LogicalPosition(centeredGeneralPosition.x, centeredGeneralPosition.y),
		);
	}
}

export async function persistCompactWindowPosition(): Promise<void> {
	if (!isTauriRuntime()) return;

	const { getCurrentWindow } = await import("@tauri-apps/api/window");
	const position = await getCurrentWindow().outerPosition();

	writeStoredCompactWindowPosition({ x: position.x, y: position.y });
}

export async function moveCompactWindowToAnchor(
	anchor: CompactWindowAnchor,
): Promise<void> {
	if (!isTauriRuntime()) return;

	const [{ getCurrentWindow }, { LogicalPosition }] = await Promise.all([
		import("@tauri-apps/api/window"),
		import("@tauri-apps/api/dpi"),
	]);

	const appWindow = getCurrentWindow();
	const position = getAnchoredCompactWindowPosition(anchor);

	if (!position) return;

	await appWindow.setPosition(new LogicalPosition(position.x, position.y));
	writeStoredCompactWindowPosition(position);
}

export async function startCompactWindowDrag(): Promise<void> {
	if (!isTauriRuntime()) return;
	const { getCurrentWindow } = await import("@tauri-apps/api/window");
	await getCurrentWindow().startDragging();
}

export async function minimizeDesktopAppWindow(): Promise<void> {
	if (!isTauriRuntime()) return;
	const { getCurrentWindow } = await import("@tauri-apps/api/window");
	await getCurrentWindow().minimize();
}

export async function closeDesktopApp(): Promise<void> {
	if (!isTauriRuntime()) return;
	const { getCurrentWindow } = await import("@tauri-apps/api/window");
	await getCurrentWindow().close();
}
