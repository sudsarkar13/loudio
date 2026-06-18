"use client";

export {
	isTauriRuntime,
	invokeCommand,
	listenReadinessProgress,
	listenRuntimeBootstrapProgress,
	listenTranscriptionProgress,
} from "@/lib/tauri/runtime";

export {
	checkSystemReadiness,
	chooseAudioFile,
	deleteMicrophoneRecording,
	getMicrophoneRecordingPlaybackUrl,
	getPersistedSettings,
	getRuntimeProfiles,
	installReadinessItem,
	listMicrophoneRecordingHistory,
	readFullLicense,
	readinessManualCommand,
	resetReadinessSkips,
	runRuntimeBootstrap,
	savePersistedSettings,
	skipReadinessItem,
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
	ReadinessActionKind,
	ReadinessCheck,
	ReadinessProgressEvent,
	ReadinessReport,
	ReadinessSeverity,
	ReadinessState,
	RuntimeBootstrapProgressEvent,
	StoredWindowPosition,
	TranscriptionProgressEvent,
} from "@/lib/tauri/types";

export { setupDesktopAppMenu } from "@/lib/desktop-menu";
export type { DesktopMenuActions } from "@/lib/desktop-menu";
