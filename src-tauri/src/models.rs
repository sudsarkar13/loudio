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
    /// Domain terms biased toward during decoding, one per line. Whisper
    /// conditions on prior text, so naming terms up front makes them likely
    /// instead of unlikely ("Supabase" rather than "super base").
    #[serde(default)]
    pub custom_vocabulary: String,
    /// Learned `heard -> intended` corrections, applied after decoding.
    #[serde(default)]
    pub learned_terms: Vec<LearnedTerm>,
}

/// One confirmed correction. Stored rather than inferred, so a typo in an
/// edited transcript never silently becomes vocabulary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LearnedTerm {
    /// What the engine produced, e.g. "super base".
    pub heard: String,
    /// What it should have been, e.g. "Supabase".
    pub intended: String,
    /// How often this correction has been confirmed; used to rank terms into
    /// the prompt, which is capped well below an unbounded dictionary.
    #[serde(default = "one")]
    pub hits: u32,
}

fn one() -> u32 {
    1
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

/// Extracts the `M<n>` family from a CPU brand string such as `Apple M4 Pro`.
///
/// Parses the number rather than matching a fixed list, so a chip released
/// after this code was written is still recognised. The previous
/// `["M4", "M3", "M2", "M1"]` list downgraded anything newer to the generic
/// ARM64 profile and told the user there was no Metal acceleration — which
/// matters more now that Apple Silicon is the only macOS target.
fn parse_apple_silicon_generation(brand: &str) -> Option<String> {
    let upper = brand.to_uppercase();
    let bytes = upper.as_bytes();

    for (index, byte) in bytes.iter().enumerate() {
        if *byte != b'M' {
            continue;
        }

        // The M must start a word, otherwise "ARM64" and "AMD" look like families.
        if index > 0 && bytes[index - 1].is_ascii_alphanumeric() {
            continue;
        }

        let digits: String = upper[index + 1..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();

        if !digits.is_empty() {
            return Some(format!("M{digits}"));
        }
    }

    None
}

fn apple_silicon_generation() -> Option<String> {
    if !cfg!(target_os = "macos") || !cfg!(target_arch = "aarch64") {
        return None;
    }

    let output = std::process::Command::new("sysctl")
        .args(["-n", "machdep.cpu.brand_string"])
        .output()
        .ok()?;

    parse_apple_silicon_generation(&String::from_utf8_lossy(&output.stdout))
}

fn recommended_runtime_title() -> String {
    if let Some(generation) = apple_silicon_generation() {
        return format!("Recommended ({generation} Fast Local)");
    }

    if cfg!(target_arch = "x86_64") {
        if cfg!(target_os = "linux") {
            "Recommended (Linux x86_64 Local)".into()
        } else if cfg!(target_os = "windows") {
            "Recommended (Windows x86_64 Local)".into()
        } else if cfg!(target_os = "macos") {
            "Recommended (Intel Mac Local)".into()
        } else {
            "Recommended (x86_64 Local)".into()
        }
    } else if cfg!(target_arch = "aarch64") {
        "Recommended (ARM64 Local)".into()
    } else {
        "Recommended (Local)".into()
    }
}

fn recommended_runtime_description() -> String {
    if apple_silicon_generation().is_some() {
        "whisper.cpp with Metal acceleration. Best speed + offline reliability on Apple Silicon."
            .into()
    } else if cfg!(target_os = "linux") {
        "whisper.cpp local runtime tuned for this Linux processor. Offline transcription without Mac-specific assumptions."
            .into()
    } else if cfg!(target_os = "windows") {
        "whisper.cpp local runtime tuned for this Windows processor. Offline transcription without Mac-specific assumptions."
            .into()
    } else {
        "whisper.cpp local runtime tuned for this processor. Offline transcription without Mac-specific assumptions."
            .into()
    }
}

pub fn runtime_profiles() -> Vec<RuntimeProfile> {
    vec![
        RuntimeProfile {
            id: "recommended-local".into(),
            title: recommended_runtime_title(),
            description: recommended_runtime_description(),
            engine: Engine::WhisperCpp,
            model: "small".into(),
            recommended: true,
        },
        RuntimeProfile {
            id: "high-accuracy".into(),
            title: "High Accuracy (Local)".into(),
            description: "whisper.cpp with medium model for better accuracy on difficult audio."
                .into(),
            engine: Engine::WhisperCpp,
            model: "medium".into(),
            recommended: false,
        },
        RuntimeProfile {
            id: "python-whisper".into(),
            title: "Python Whisper Compatibility".into(),
            description:
                "OpenAI Whisper Python runtime for compatibility with existing whisper CLI flows."
                    .into(),
            engine: Engine::OpenaiWhisper,
            model: "small".into(),
            recommended: false,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::parse_apple_silicon_generation;

    #[test]
    fn detects_every_apple_silicon_family() {
        for (brand, expected) in [
            ("Apple M1", "M1"),
            ("Apple M1 Pro", "M1"),
            ("Apple M2 Max", "M2"),
            ("Apple M3 Ultra", "M3"),
            ("Apple M4 Pro", "M4"),
            // The reason this parses rather than matching a list: chips that
            // did not exist when this was written must still be recognised.
            ("Apple M5", "M5"),
            ("Apple M10 Max", "M10"),
        ] {
            assert_eq!(
                parse_apple_silicon_generation(brand).as_deref(),
                Some(expected),
                "failed on {brand}"
            );
        }
    }

    #[test]
    fn ignores_brands_that_merely_contain_an_m() {
        for brand in [
            "Intel(R) Core(TM) i7-9750H",
            "AMD Ryzen 9 5900X",
            "ARM64 Neoverse-N1",
            "12th Gen Intel(R) Core(TM) i9-12900K",
            "",
        ] {
            assert_eq!(
                parse_apple_silicon_generation(brand),
                None,
                "false positive on {brand}"
            );
        }
    }
}
