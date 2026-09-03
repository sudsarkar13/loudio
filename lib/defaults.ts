import type { AppSettings, RuntimeProfile } from "@/lib/types";

export const RUNTIME_PROFILES: RuntimeProfile[] = [
	{
		id: "recommended-local",
		title: "Recommended (Local)",
		description:
			"whisper.cpp local runtime tuned for this processor. Offline transcription without Mac-specific assumptions.",
		engine: "whisper_cpp",
		model: "small",
		recommended: true,
	},
	{
		id: "high-accuracy",
		title: "High Accuracy (Local)",
		description:
			"whisper.cpp with medium model for better accuracy on difficult audio.",
		engine: "whisper_cpp",
		model: "medium",
		recommended: false,
	},
	{
		id: "python-whisper",
		title: "Python Whisper Compatibility",
		description:
			"OpenAI Whisper Python runtime for compatibility with existing whisper CLI flows.",
		engine: "openai_whisper",
		model: "small",
		recommended: false,
	},
];

export const DEFAULT_SETTINGS: AppSettings = {
	profileId: "recommended-local",
	customModel: "",
	language: "auto",
	task: "transcribe",
	autoCopy: true,
	temperature: 0,
	beamSize: 5,
	manualEnginePath: "",
	micDeviceId: "",
	customVocabulary: "",
	learnedTerms: [],
	translateTargetLanguage: "auto",
	translationModelSize: "small",
};

export const LANGUAGES: Array<{ value: string; label: string }> = [
	{ value: "auto", label: "Auto Detect" },
	{ value: "en", label: "English" },
	{ value: "hi", label: "Hindi" },
	{ value: "bn", label: "Bengali" },
	{ value: "es", label: "Spanish" },
	{ value: "fr", label: "French" },
	{ value: "de", label: "German" },
	{ value: "ja", label: "Japanese" },
];
