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
import type { MicrophoneTranscriptionPayload } from "@/lib/tauri/types";

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
