"use client";

"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
	ReadinessProgressEvent,
	RuntimeBootstrapProgressEvent,
	TranscriptionProgressEvent,
} from "@/lib/tauri/types";

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

export async function invokeCommand<T>(
	command: string,
	payload?: Record<string, unknown>,
): Promise<T> {
	if (!isTauriRuntime()) {
		throw new Error(
			"Tauri runtime not detected. Launch with `yarn tauri:dev`.",
		);
	}

	return invoke<T>(command, payload);
}

export async function listenRuntimeBootstrapProgress(
	callback: (payload: RuntimeBootstrapProgressEvent) => void,
): Promise<() => void> {
	if (!isTauriRuntime()) return () => {};
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
	return listen<TranscriptionProgressEvent>(
		"transcription-progress",
		(event) => {
			callback(event.payload);
		},
	);
}

export async function listenReadinessProgress(
	callback: (payload: ReadinessProgressEvent) => void,
): Promise<() => void> {
	if (!isTauriRuntime()) return () => {};
	return listen<ReadinessProgressEvent>("readiness-progress", (event) => {
		callback(event.payload);
	});
}
