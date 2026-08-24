export interface RuntimeProfile {
	id: string;
	title: string;
	description: string;
	engine: "whisper_cpp" | "openai_whisper";
	model: string;
	recommended: boolean;
}

export interface AppSettings {
	profileId: string;
	customModel?: string;
	language: string;
	task: "transcribe" | "translate";
	autoCopy: boolean;
	temperature: number;
	beamSize: number;
	manualEnginePath?: string;
	micDeviceId?: string;
	/** Domain terms biased during decoding, one per line. */
	customVocabulary: string;
	/** Confirmed corrections replayed after decoding. */
	learnedTerms: LearnedTerm[];
}

/** A confirmed `heard -> intended` correction. */
export interface LearnedTerm {
	heard: string;
	intended: string;
	hits: number;
}

export interface TranscriptionRequest {
	audioPath: string;
	settings: AppSettings;
}

export interface TranscriptionResponse {
	text: string;
	languageDetected?: string;
	elapsedMs: number;
	modelUsed: string;
}

export interface RecordingHistoryItem {
	id: string;
	fileName: string;
	absolutePath: string;
	extension: string;
	sizeBytes: number;
	createdAtEpochMs: number;
	createdAtIso: string;
}

/** A suggested correction awaiting the user's confirmation. */
export interface CorrectionCandidate {
	heard: string;
	intended: string;
}
