use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Engine {
    WhisperCpp,
    OpenaiWhisper,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProfile {
    pub id: String,
    pub title: String,
    pub description: String,
    pub engine: Engine,
    pub model: String,
    pub recommended: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub profile_id: String,
    pub custom_model: Option<String>,
    pub language: String,
    pub task: String,
    pub auto_copy: bool,
    pub temperature: f32,
    pub beam_size: u8,
    pub manual_engine_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionRequest {
    pub audio_path: String,
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResponse {
    pub text: String,
    pub language_detected: Option<String>,
    pub elapsed_ms: u128,
    pub model_used: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneTranscriptionRequest {
    pub audio_base64: String,
    pub mime_type: Option<String>,
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBootstrapProgressEvent {
    pub percent: u8,
    pub message: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionProgressEvent {
    pub partial_text: Option<String>,
    pub status: String,
    pub done: bool,
    pub error: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingHistoryItem {
    pub id: String,
    pub file_name: String,
    pub absolute_path: String,
    pub extension: String,
    pub size_bytes: u64,
    pub created_at_epoch_ms: u128,
    pub created_at_iso: String,
}

/// A previous bundle identifier's output directory that still holds microphone
/// recordings. Used by the migration flow so users do not lose history when
/// the bundle identifier changes between releases.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyRecordingDir {
	pub bundle_id: String,
	pub absolute_path: String,
	pub file_count: usize,
	pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyMigrationResult {
	pub migrated_files: usize,
	pub migrated_bytes: u64,
	pub skipped_files: usize,
	pub sources: Vec<String>,
	pub errors: Vec<String>,
}

pub fn runtime_profiles() -> Vec<RuntimeProfile> {
    vec![
        RuntimeProfile {
            id: "recommended-m1".into(),
            title: "Recommended (M1 Fast Local)".into(),
            description: "whisper.cpp with Metal acceleration. Best speed + offline reliability on Apple Silicon."
                .into(),
            engine: Engine::WhisperCpp,
            model: "small".into(),
            recommended: true,
        },
        RuntimeProfile {
            id: "high-accuracy".into(),
            title: "High Accuracy (Local)".into(),
            description: "whisper.cpp with medium model for better accuracy on difficult audio.".into(),
            engine: Engine::WhisperCpp,
            model: "medium".into(),
            recommended: false,
        },
        RuntimeProfile {
            id: "python-whisper".into(),
            title: "Python Whisper Compatibility".into(),
            description: "OpenAI Whisper Python runtime for compatibility with existing whisper CLI flows."
                .into(),
            engine: Engine::OpenaiWhisper,
            model: "small".into(),
            recommended: false,
        },
    ]
}
