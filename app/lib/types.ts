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
