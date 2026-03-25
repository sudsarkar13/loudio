import type { AppSettings, RuntimeProfile } from "@/app/lib/types";

export const RUNTIME_PROFILES: RuntimeProfile[] = [
  {
    id: "recommended-m1",
    title: "Recommended (M1 Fast Local)",
    description:
      "whisper.cpp with Metal acceleration. Best speed + offline reliability on Apple Silicon.",
    engine: "whisper_cpp",
    model: "small",
    recommended: true
  },
  {
    id: "high-accuracy",
    title: "High Accuracy (Local)",
    description: "whisper.cpp with medium model for better accuracy on difficult audio.",
    engine: "whisper_cpp",
    model: "medium",
    recommended: false
  },
  {
    id: "python-whisper",
    title: "Python Whisper Compatibility",
    description:
      "OpenAI Whisper Python runtime for compatibility with existing whisper CLI flows.",
    engine: "openai_whisper",
    model: "small",
    recommended: false
  }
];

export const DEFAULT_SETTINGS: AppSettings = {
  profileId: "recommended-m1",
  customModel: "",
  language: "auto",
  task: "transcribe",
  autoCopy: true,
  timestamps: false,
  temperature: 0,
  beamSize: 5,
  manualEnginePath: ""
};

export const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "auto", label: "Auto Detect" },
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "bn", label: "Bengali" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "ja", label: "Japanese" }
];
