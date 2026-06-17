"use client";

export {
	isTauriRuntime,
	invokeCommand,
	listenRuntimeBootstrapProgress,
	listenTranscriptionProgress,
} from "@/lib/tauri/runtime";

export {
	chooseAudioFile,
	deleteMicrophoneRecording,
	getMicrophoneRecordingPlaybackUrl,
	getPersistedSettings,
	getRuntimeProfiles,
	listMicrophoneRecordingHistory,
	runRuntimeBootstrap,
	savePersistedSettings,
	startMicrophoneTranscription,
	startTranscription,
} from "@/lib/tauri/commands";

export { copyToClipboard, exportTextFile } from "@/lib/tauri/clipboard";

export {
	closeDesktopApp,
	enterCompactWindowMode,
	exitCompactWindowMode,
	minimizeDesktopAppWindow,
	moveCompactWindowToAnchor,
	persistCompactWindowPosition,
	startCompactWindowDrag,
} from "@/lib/tauri/window";

export type {
	CompactWindowAnchor,
	MicrophoneTranscriptionPayload,
	RuntimeBootstrapProgressEvent,
	StoredWindowPosition,
	TranscriptionProgressEvent,
} from "@/lib/tauri/types";

export { setupDesktopAppMenu } from "@/lib/desktop-menu";
export type { DesktopMenuActions } from "@/lib/desktop-menu";
