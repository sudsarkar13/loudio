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
	/**
	 * Language the translate task outputs, as ISO-639-1.
	 *
	 * "auto" means English — the only direction Whisper itself can produce.
	 * Anything else runs the transcript through NLLB-200 afterwards.
	 */
	translateTargetLanguage: string;
	/**
	 * Which NLLB checkpoint translation uses.
	 *
	 * "small" (~2.5 GB) is the default; "large" (~5.5 GB) is more accurate but
	 * costs roughly twice the disk and is slower per sentence.
	 */
	translationModelSize: "small" | "large";
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
