import type { AppSettings } from "@/lib/types";

export type CompactWindowAnchor = "top" | "bottom";

export interface StoredWindowPosition {
	x: number;
	y: number;
}

export interface MicrophoneTranscriptionPayload {
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

export type ReadinessState =
	| "missing"
	| "installed"
	| "outdated"
	| "failed"
	| "skipped"
	| "unknown";

export type ReadinessActionKind = "install" | "reinstall" | "update" | "none";

export type ReadinessSeverity = "required" | "recommended" | "optional";

export interface ReadinessCheck {
	id: string;
	name: string;
	description: string;
	required: string;
	current: string | null;
	state: ReadinessState;
	actionKind: ReadinessActionKind;
	severity: ReadinessSeverity;
	manualCommand: string | null;
	detail: string | null;
	platformSupported: boolean;
	/** Newer stable release on offer, or null when already current. */
	available: string | null;
}

export interface ReadinessReport {
	generatedAt: string;
	os: string;
	arch: string;
	items: ReadinessCheck[];
	drift: string[];
}

export interface ReadinessProgressEvent {
	id: string;
	percent: number;
	message: string;
	done: boolean;
	error: boolean;
}

/** How Loudio was installed. Decides whether it may update itself. */
export type InstallFlavor = "snap" | "flatpak" | "native";

export interface InstallInfo {
	flavor: InstallFlavor;
	label: string;
	enginesAreBundled: boolean;
}
