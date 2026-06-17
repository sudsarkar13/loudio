"use client";

export {
	isTauriRuntime,
	invokeCommand,
	listenRuntimeBootstrapProgress,
	listenTranscriptionProgress,
} from "@/app/lib/tauri/runtime";

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
} from "@/app/lib/tauri/commands";

export { copyToClipboard, exportTextFile } from "@/app/lib/tauri/clipboard";

export {
	closeDesktopApp,
	enterCompactWindowMode,
	exitCompactWindowMode,
	minimizeDesktopAppWindow,
	moveCompactWindowToAnchor,
	persistCompactWindowPosition,
	startCompactWindowDrag,
} from "@/app/lib/tauri/window";

export type {
	CompactWindowAnchor,
	MicrophoneTranscriptionPayload,
	RuntimeBootstrapProgressEvent,
	StoredWindowPosition,
	TranscriptionProgressEvent,
} from "@/app/lib/tauri/types";

export { setupDesktopAppMenu } from "@/app/lib/desktop-menu";
export type { DesktopMenuActions } from "@/app/lib/desktop-menu";
