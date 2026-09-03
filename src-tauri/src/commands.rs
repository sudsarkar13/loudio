use std::fs;

use uuid::Uuid;

use crate::{
    models::{
        runtime_profiles, AppSettings, Engine, MicrophoneTranscriptionRequest, RuntimeProfile,
        TranscriptionRequest, TranscriptionResponse,
    },
    paths::{runtime_dir, settings_path, work_dir},
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
    mut request: TranscriptionRequest,
) -> Result<TranscriptionResponse, String> {
    emit_transcription_progress(&app, None, "Transcription started…", false, false);

    // Whisper's translate task only ever outputs English. For any other target
    // the engine therefore runs as a *transcriber* — capturing the spoken
    // language faithfully — and NLLB changes the language afterwards. Running
    // Whisper's own translation first and then translating again would put two
    // lossy hops in series.
    let translate_target = request.settings.translate_target_language.clone();
    let needs_neural_translation = crate::translation::needs_neural_translation(
        &request.settings.task,
        &translate_target,
    );
    if needs_neural_translation {
        request.settings.task = "transcribe".to_string();
    }

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
            let value = if needs_neural_translation {
                apply_neural_translation(&app, value, &request, &translate_target).await
            } else {
                value
            };

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

/// Runs the NLLB step over a finished transcript.
///
/// Returns the transcript **unchanged** if translation fails, rather than
/// failing the whole request: the speech has already been captured, and losing a
/// long dictation because a translation model could not load would be a worse
/// outcome than delivering it untranslated. The failure is not swallowed — it is
/// emitted as an error-level progress event and written to the diagnostic log,
/// so it never looks like translation silently did nothing.
async fn apply_neural_translation(
    app: &tauri::AppHandle,
    value: TranscriptionResponse,
    request: &TranscriptionRequest,
    target: &str,
) -> TranscriptionResponse {
    // An explicit language setting is authoritative; otherwise use whatever the
    // engine detected. NLLB has to be told the source language — it does not
    // detect one — so with neither we cannot proceed.
    let source = if request.settings.language != "auto" {
        Some(request.settings.language.clone())
    } else {
        value.language_detected.clone()
    };

    let Some(source) = source else {
        let message = "Could not determine the spoken language, so the transcript was not \
                       translated. Select the spoken language instead of Auto Detect and \
                       try again.";
        emit_transcription_progress(app, None, message, false, true);
        crate::diagnostics::record(
            app,
            &crate::diagnostics::DiagnosticEvent {
                level: "error".into(),
                scope: "translate".into(),
                message: "No source language available for translation".into(),
                fields: serde_json::json!({ "target": target }),
            },
        );
        return value;
    };

    match crate::translation::translate_text(app, &value.text, &source, target).await {
        Ok(translated) => {
            crate::diagnostics::record(
                app,
                &crate::diagnostics::DiagnosticEvent {
                    level: "info".into(),
                    scope: "translate".into(),
                    message: "Translated transcript".into(),
                    fields: serde_json::json!({
                        "source": source,
                        "target": target,
                        "inputChars": value.text.len(),
                        "outputChars": translated.len(),
                    }),
                },
            );
            TranscriptionResponse {
                text: translated,
                model_used: format!("{} + nllb-200:{source}->{target}", value.model_used),
                ..value
            }
        }
        Err(error) => {
            let message = format!("Transcript kept, but translation failed: {error:#}");
            emit_transcription_progress(app, None, message.clone(), false, true);
            crate::diagnostics::record(
                app,
                &crate::diagnostics::DiagnosticEvent {
                    level: "error".into(),
                    scope: "translate".into(),
                    message: "Translation failed".into(),
                    fields: serde_json::json!({
                        "source": source,
                        "target": target,
                        "detail": format!("{error:#}"),
                    }),
                },
            );
            value
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

    // Continues the timeline the webview started: pairing the blob size the
    // frontend logged with the file that reached disk is what tells a capture
    // that produced nothing apart from one that failed to save.
    crate::diagnostics::record(
        &app,
        &crate::diagnostics::DiagnosticEvent {
            level: "info".into(),
            scope: "transcribe".into(),
            message: "Microphone payload received".into(),
            fields: serde_json::json!({
                "bytes": bytes.len(),
                "mimeType": request.mime_type,
                "extension": extension,
                "file": input_path.file_name().map(|n| n.to_string_lossy().to_string()),
            }),
        },
    );

    fs::write(&input_path, bytes).map_err(|e| format!("Failed to save microphone audio: {e}"))?;

    emit_transcription_progress(
        &app,
        None,
        "Converting microphone audio to 16 kHz wav for transcription…",
        false,
        false,
    );

    // Normalise unconditionally, including when the capture is already a wav.
    // The Linux capture path uses the AudioContext fallback (WebKitGTK has no
    // usable MediaRecorder), so it yields a wav at the device's native rate —
    // typically 44.1 kHz — where whisper wants 16 kHz mono. Previously that
    // branch skipped ffmpeg entirely and handed the raw capture to the engine.
    let is_wav_capture = extension == "wav";
    let prepared_path = if is_wav_capture {
        // The original already occupies `mic-<uuid>.wav`, so the normalised copy
        // has to live elsewhere or ffmpeg would read and write the same file.
        // `work/` keeps it out of the history view, which groups by file stem.
        work_dir(&app)
            .map_err(|e| e.to_string())?
            .join(format!("mic-{}-16k.wav", Uuid::new_v4()))
    } else {
        // Keep the converted wav beside the original capture. Recording history
        // groups by stem and prefers the wav, which is the only form every
        // platform's webview can actually play back.
        input_path.with_extension("wav")
    };

    if let Err(error) = crate::binaries::convert_audio_to_wav_16k(&input_path, &prepared_path).await
    {
        let message = format!("Failed to convert microphone audio before transcription: {error:#}");
        crate::diagnostics::record(
            &app,
            &crate::diagnostics::DiagnosticEvent {
                level: "error".into(),
                scope: "transcribe".into(),
                message: "ffmpeg conversion failed".into(),
                fields: serde_json::json!({ "detail": format!("{error:#}") }),
            },
        );
        emit_transcription_progress(&app, None, message.clone(), true, true);
        return Err(message);
    }

    let transcribe_request = TranscriptionRequest {
        audio_path: prepared_path.to_string_lossy().to_string(),
        settings: request.settings,
    };

    let result = transcribe_audio(app.clone(), transcribe_request).await;

    crate::diagnostics::record(
        &app,
        &crate::diagnostics::DiagnosticEvent {
            level: if result.is_ok() { "info".into() } else { "error".into() },
            scope: "transcribe".into(),
            message: "Microphone transcription finished".into(),
            fields: match &result {
                Ok(response) => serde_json::json!({
                    "ok": true,
                    "elapsedMs": response.elapsed_ms as u64,
                    "modelUsed": response.model_used,
                    "textChars": response.text.len(),
                }),
                Err(error) => serde_json::json!({ "ok": false, "detail": error }),
            },
        },
    );

    // Only the scratch copy is disposable. The wav written next to a non-wav
    // capture is what recording history plays back, so it has to stay.
    if is_wav_capture {
        let _ = fs::remove_file(&prepared_path);
    }

    result
}

#[tauri::command]
pub fn list_microphone_recordings(
    app: tauri::AppHandle,
) -> Result<Vec<crate::models::RecordingHistoryItem>, String> {
    crate::recordings::list_microphone_recordings(app)
}

/// Returns a path for `absolute_path` that the webview can play, converting the
/// capture to wav first when its own container is not playable.
#[tauri::command]
pub async fn ensure_playback_audio(
    app: tauri::AppHandle,
    absolute_path: String,
) -> Result<String, String> {
    crate::recordings::ensure_playback_audio(app, absolute_path).await
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

/// Shows or hides the in-window menu bar.
///
/// Only meaningful on Linux and Windows, where Tauri packs the menu into the
/// window itself. macOS keeps the menu app-wide in the system bar, so the
/// frontend never calls this there.
#[tauri::command]
pub fn set_window_menu_visible(window: tauri::WebviewWindow, visible: bool) -> Result<(), String> {
    let result = if visible {
        window.show_menu()
    } else {
        window.hide_menu()
    };

    result.map_err(|error| error.to_string())
}

/// Suggests `heard -> intended` corrections from an edited transcript.
///
/// Suggestions only. Nothing is learned until the user confirms, so a typo or
/// a rephrasing cannot quietly become vocabulary.
#[tauri::command]
pub fn suggest_corrections(
    original: String,
    edited: String,
) -> Vec<crate::vocabulary::CorrectionCandidate> {
    crate::vocabulary::correction_candidates(&original, &edited)
}
