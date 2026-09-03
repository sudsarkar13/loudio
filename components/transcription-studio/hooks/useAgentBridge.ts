import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

import { invokeCommand, isTauriRuntime } from "@/lib/tauri/runtime";
import { logDiagnostic } from "@/lib/diagnostics";
import type { AppSettings } from "@/lib/types";

/**
 * The webview half of the agent bridge.
 *
 * The Rust half serves `/state` and forwards `/invoke`, but it cannot see UI
 * state or press buttons — the webview owns both. This publishes a snapshot when
 * something meaningful changes, and executes the actions the bridge forwards.
 *
 * Development only, matching the Rust module's `debug_assertions` gate: a
 * packaged build runs `next build`, so `NODE_ENV` is "production" there and none
 * of this activates. The two gates are independent on purpose — either one alone
 * is enough to keep the bridge out of a shipped app.
 */
const IS_DEV = process.env.NODE_ENV !== "production";

export interface AgentBridgeSnapshot {
	windowMode: "compact" | "general";
	isRecording: boolean;
	isTranscribing: boolean;
	isBootstrapping: boolean;
	status: string;
	transcript: string;
	audioPath: string;
	activeView: string;
	settings: AppSettings;
	microphoneCount: number;
	hasMicrophonePermission: boolean;
}

export interface AgentBridgeActions {
	startRecording: () => void;
	stopRecording: () => void;
	toggleCompactMode: () => void;
	setCompactMode: (compact: boolean) => void;
	transcribeFile: (path?: string) => void;
	clearTranscript: () => void;
	updateSettings: (patch: Partial<AppSettings>) => void;
	selectView: (view: "activity" | "history") => void;
}

interface InvokeEvent {
	action: string;
	args?: Record<string, unknown> | null;
}

export function useAgentBridge(
	snapshot: AgentBridgeSnapshot,
	actions: AgentBridgeActions,
): void {
	// Actions are read through a ref so the listener is installed once. Binding
	// it to callback identity would tear down and re-register the native
	// listener on every render that changes a handler.
	const actionsRef = useRef(actions);
	actionsRef.current = actions;

	useEffect(() => {
		if (!IS_DEV || !isTauriRuntime()) return;

		void invokeCommand<void>("agent_bridge_publish_state", { snapshot }).catch(
			() => {
				// The bridge is a convenience; never let it disturb the UI.
			},
		);
	}, [snapshot]);

	useEffect(() => {
		if (!IS_DEV || !isTauriRuntime()) return;

		let unlisten: (() => void) | null = null;
		let cancelled = false;

		void listen<InvokeEvent>("agent-bridge:invoke", (event) => {
			const { action, args } = event.payload;
			logDiagnostic("info", "agent-bridge", "Action received", { action });

			const current = actionsRef.current;
			switch (action) {
				case "start_recording":
					return current.startRecording();
				case "stop_recording":
					return current.stopRecording();
				case "toggle_compact_mode":
					return current.toggleCompactMode();
				case "set_compact_mode":
					return current.setCompactMode(Boolean(args?.compact));
				case "transcribe_file":
					return current.transcribeFile(
						typeof args?.path === "string" ? args.path : undefined,
					);
				case "clear_transcript":
					return current.clearTranscript();
				case "update_settings":
					return current.updateSettings(
						(args ?? {}) as Partial<AppSettings>,
					);
				case "select_view":
					return current.selectView(
						args?.view === "history" ? "history" : "activity",
					);
				default:
					// The Rust side already rejects anything off the whitelist, so
					// reaching here means the two lists have drifted apart.
					logDiagnostic("warn", "agent-bridge", "Unhandled action", {
						action,
					});
			}
		}).then((dispose) => {
			if (cancelled) {
				dispose();
				return;
			}
			unlisten = dispose;
		});

		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, []);
}
