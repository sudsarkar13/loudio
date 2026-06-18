"use client";

import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";

import { DEFAULT_SETTINGS, RUNTIME_PROFILES } from "@/lib/defaults";
import type {
	AppSettings,
	RecordingHistoryItem,
	RuntimeProfile,
	TranscriptionResponse,
} from "@/lib/types";
import { invokeCommand, isTauriRuntime } from "@/lib/tauri/runtime";
import type {
	MicrophoneTranscriptionPayload,
	ReadinessCheck,
	ReadinessReport,
} from "@/lib/tauri/types";

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

export async function checkSystemReadiness(
	forceFull = false,
): Promise<ReadinessReport> {
	if (!isTauriRuntime()) {
		return {
			generatedAt: new Date().toISOString(),
			os: "web",
			arch: "unknown",
			items: [],
			drift: [],
		};
	}
	return invokeCommand<ReadinessReport>("check_system_readiness", {
		forceFull,
	});
}

export async function installReadinessItem(
	id: string,
): Promise<ReadinessCheck> {
	if (!isTauriRuntime()) {
		throw new Error(
			"System readiness installer is available in the Tauri desktop app.",
		);
	}
	return invokeCommand<ReadinessCheck>("install_readiness_item", { id });
}

export async function skipReadinessItem(id: string): Promise<void> {
	if (!isTauriRuntime()) return;
	await invokeCommand<void>("skip_readiness_item", { id });
}

export async function resetReadinessSkips(): Promise<void> {
	if (!isTauriRuntime()) return;
	await invokeCommand<void>("reset_readiness_skips");
}

export async function readFullLicense(): Promise<string> {
	if (!isTauriRuntime()) {
		return "License text is bundled with the Tauri desktop build.";
	}
	return invokeCommand<string>("read_full_license");
}

export async function readinessManualCommand(
	id: string,
	action: string,
): Promise<string> {
	if (!isTauriRuntime()) {
		return "";
	}
	return invokeCommand<string>("readiness_manual_command", { id, action });
}

export async function chooseAudioFile(): Promise<string | null> {
	if (!isTauriRuntime()) return null;

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

export async function getRecordingsDiskUsage(): Promise<number> {
	if (!isTauriRuntime()) return 0;
	return invokeCommand<number>("recordings_disk_usage");
}

export interface LegacyRecordingDir {
	bundleId: string;
	absolutePath: string;
	fileCount: number;
	sizeBytes: number;
}

export interface LegacyMigrationResult {
	migratedFiles: number;
	migratedBytes: number;
	skippedFiles: number;
	sources: string[];
	errors: string[];
}

export async function listLegacyRecordingDirs(): Promise<LegacyRecordingDir[]> {
	if (!isTauriRuntime()) return [];
	return invokeCommand<LegacyRecordingDir[]>("list_legacy_recording_dirs");
}

export async function migrateLegacyRecordings(): Promise<LegacyMigrationResult> {
	const empty: LegacyMigrationResult = {
		migratedFiles: 0,
		migratedBytes: 0,
		skippedFiles: 0,
		sources: [],
		errors: [],
	};
	if (!isTauriRuntime()) return empty;
	return invokeCommand<LegacyMigrationResult>("migrate_legacy_recordings");
}

export async function getCurrentRecordingsOutputDir(): Promise<string> {
	if (!isTauriRuntime()) return "";
	return invokeCommand<string>("current_recordings_output_dir");
}

export async function revealRecordingsOutputDir(): Promise<void> {
	if (!isTauriRuntime()) return;
	await invokeCommand<void>("reveal_recordings_output_dir");
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

	return convertFileSrc(absolutePath);
}
