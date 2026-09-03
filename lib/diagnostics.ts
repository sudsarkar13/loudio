"use client";

import { invokeCommand, isTauriRuntime } from "@/lib/tauri/runtime";

export type DiagnosticLevel = "info" | "warn" | "error";

export interface DiagnosticFields {
	[key: string]: unknown;
}

/**
 * Context stamped onto every event.
 *
 * Which window mode was active is the whole point: a microphone failure that
 * only reproduces in compact mode is indistinguishable from a flaky one until
 * the log says which mode each attempt ran in. The visibility and focus flags
 * are here for the same reason — WebKit interrupts media capture when it
 * decides a page is no longer visible, and that is invisible from the UI.
 */
function ambientFields(): DiagnosticFields {
	if (typeof document === "undefined") return {};

	return {
		windowMode:
			document.documentElement.classList.contains("loudio-compact-window") ?
				"compact"
			:	"general",
		visibility: document.visibilityState,
		hasFocus: document.hasFocus(),
	};
}

/**
 * Records one diagnostic event.
 *
 * Fire-and-forget by design: instrumentation must never delay or fail the code
 * path it observes, so the invoke is not awaited and a rejection is swallowed.
 */
export function logDiagnostic(
	level: DiagnosticLevel,
	scope: string,
	message: string,
	fields: DiagnosticFields = {},
): void {
	const merged = { ...ambientFields(), ...fields };

	if (!isTauriRuntime()) {
		// Web preview has no backend to write to; the console is the log.
		console[level === "error" ? "error" : "log"](
			`[loudio:${scope}] ${message}`,
			merged,
		);
		return;
	}

	void invokeCommand<void>("log_diagnostic_event", {
		event: { level, scope, message, fields: merged },
	}).catch(() => {
		// Logging failures are not worth surfacing or retrying.
	});
}

export async function readDiagnosticsLog(maxBytes?: number): Promise<string> {
	if (!isTauriRuntime()) return "";
	return invokeCommand<string>("read_diagnostics_log", {
		maxBytes: maxBytes ?? null,
	});
}

export async function revealDiagnosticsLogs(): Promise<void> {
	if (!isTauriRuntime()) return;
	await invokeCommand<void>("reveal_diagnostics_logs");
}

/** Normalises a thrown value into something worth reading in a log line. */
export function describeError(error: unknown): DiagnosticFields {
	if (error instanceof DOMException || error instanceof Error) {
		return {
			errorName: error.name,
			errorMessage: error.message,
			// OverconstrainedError carries the constraint that could not be met,
			// which is what tells a stale device id apart from a denied prompt.
			errorConstraint:
				(error as { constraint?: string }).constraint ?? undefined,
		};
	}
	return { errorMessage: String(error) };
}
