import type { AppSettings } from "@/app/lib/types";

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
