use std::fs;

use uuid::Uuid;

use crate::{
    models::{
        runtime_profiles, AppSettings, Engine, MicrophoneTranscriptionRequest, RuntimeProfile,
        TranscriptionRequest, TranscriptionResponse,
    },
    paths::{runtime_dir, settings_path},
    process::{emit_transcription_progress, mime_type_to_extension},
    transcription::{transcribe_with_python, transcribe_with_whisper_cpp},
};

#[tauri::command]
pub fn get_runtime_profiles() -> Vec<RuntimeProfile> {
    runtime_profiles()
}

#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Result<Option<AppSettings>, String> {
    let path = settings_path(&app).map_err(|e| e.to_string())?;

    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let parsed = serde_json::from_str::<AppSettings>(&raw).map_err(|e| e.to_string())?;
    Ok(Some(parsed))
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn transcribe_audio(
    app: tauri::AppHandle,
    request: TranscriptionRequest,
) -> Result<TranscriptionResponse, String> {
    emit_transcription_progress(&app, None, "Transcription started…", false, false);

    let profile = runtime_profiles()
        .into_iter()
        .find(|profile| profile.id == request.settings.profile_id)
        .ok_or_else(|| "Selected runtime profile does not exist".to_string())?;

    let preferred = match profile.engine {
        Engine::WhisperCpp => transcribe_with_whisper_cpp(&app, &request, &profile).await,
        Engine::OpenaiWhisper => transcribe_with_python(&app, &request, &profile).await,
    };

    match preferred {
        Ok(value) => {
            emit_transcription_progress(
                &app,
                Some(value.text.clone()),
                "Transcription complete.",
                true,
                false,
            );
            Ok(value)
        }
        Err(primary_err) => {
            emit_transcription_progress(
                &app,
                None,
                "Primary engine failed. Trying Python fallback…",
                false,
                false,
            );

            let fallback = transcribe_with_python(&app, &request, &profile).await;
            match fallback {
                Ok(value) => {
                    emit_transcription_progress(
                        &app,
                        Some(value.text.clone()),
                        "Transcription complete (fallback engine).",
                        true,
                        false,
                    );
                    Ok(value)
                }
                Err(fallback_err) => {
                    let message = format!(
                        "Primary transcription failed: {}\nFallback failed: {}",
                        primary_err, fallback_err
                    );
                    emit_transcription_progress(&app, None, message.clone(), true, true);
                    Err(message)
                }
            }
        }
    }
}

#[tauri::command]
pub async fn transcribe_microphone_audio(
    app: tauri::AppHandle,
    request: MicrophoneTranscriptionRequest,
) -> Result<TranscriptionResponse, String> {
    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
    use base64::Engine as Base64Engine;

    let bytes = BASE64_STANDARD
        .decode(request.audio_base64.as_bytes())
        .map_err(|e| format!("Invalid microphone payload: {e}"))?;

    let extension = mime_type_to_extension(request.mime_type.as_deref());
    let input_path = runtime_dir(&app)
        .map_err(|e| e.to_string())?
        .join("output")
        .join(format!("mic-{}.{}", Uuid::new_v4(), extension));

    fs::write(&input_path, bytes).map_err(|e| format!("Failed to save microphone audio: {e}"))?;

    emit_transcription_progress(&app, None, "Preparing microphone audio…", false, false);

    let prepared_path = if extension == "wav" {
        input_path
    } else {
        emit_transcription_progress(
            &app,
            None,
            "Converting microphone audio to wav for transcription…",
            false,
            false,
        );

        match crate::binaries::maybe_convert_audio_to_wav(&input_path).await {
            Ok(wav_path) => wav_path,
            Err(error) => {
                let message = format!(
                    "Failed to convert microphone audio before transcription: {}",
                    error
                );
                emit_transcription_progress(&app, None, message.clone(), true, true);
                return Err(message);
            }
        }
    };

    let transcribe_request = TranscriptionRequest {
        audio_path: prepared_path.to_string_lossy().to_string(),
        settings: request.settings,
    };

    transcribe_audio(app, transcribe_request).await
}

#[tauri::command]
pub fn list_microphone_recordings(
    app: tauri::AppHandle,
) -> Result<Vec<crate::models::RecordingHistoryItem>, String> {
    crate::recordings::list_microphone_recordings(app)
}

#[tauri::command]
pub fn recordings_disk_usage(app: tauri::AppHandle) -> Result<u64, String> {
    crate::recordings::recordings_disk_usage(&app)
}

#[tauri::command]
pub fn delete_microphone_recording(
    app: tauri::AppHandle,
    absolute_path: String,
) -> Result<(), String> {
    crate::recordings::delete_microphone_recording(app, absolute_path)
}

#[tauri::command]
pub fn list_legacy_recording_dirs(
    app: tauri::AppHandle,
) -> Result<Vec<crate::models::LegacyRecordingDir>, String> {
    crate::recordings::list_legacy_recording_dirs(&app)
}

#[tauri::command]
pub fn migrate_legacy_recordings(
    app: tauri::AppHandle,
) -> Result<crate::models::LegacyMigrationResult, String> {
    crate::recordings::migrate_legacy_recordings(&app)
}

#[tauri::command]
pub fn current_recordings_output_dir(app: tauri::AppHandle) -> Result<String, String> {
    crate::recordings::current_recordings_output_dir(&app)
}

#[tauri::command]
pub fn reveal_recordings_output_dir(app: tauri::AppHandle) -> Result<(), String> {
    crate::recordings::reveal_recordings_output_dir(&app)
}
