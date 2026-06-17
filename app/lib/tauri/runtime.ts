"use client";

import type {
	RuntimeBootstrapProgressEvent,
	TranscriptionProgressEvent,
} from "@/app/lib/tauri/types";

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
