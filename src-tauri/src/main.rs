#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use anyhow::{anyhow, Context};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as Base64Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Engine {
    WhisperCpp,
    OpenaiWhisper,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeProfile {
    id: String,
    title: String,
    description: String,
    engine: Engine,
    model: String,
    recommended: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    profile_id: String,
    custom_model: Option<String>,
    language: String,
    task: String,
    auto_copy: bool,
    timestamps: bool,
    temperature: f32,
    beam_size: u8,
    manual_engine_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptionRequest {
    audio_path: String,
    settings: AppSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptionResponse {
    text: String,
    language_detected: Option<String>,
    elapsed_ms: u128,
    model_used: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MicrophoneTranscriptionRequest {
    audio_base64: String,
    mime_type: Option<String>,
    settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBootstrapProgressEvent {
    percent: u8,
    message: String,
    done: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptionProgressEvent {
    partial_text: Option<String>,
    status: String,
    done: bool,
    error: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingHistoryItem {
    id: String,
    file_name: String,
    absolute_path: String,
    extension: String,
    size_bytes: u64,
    created_at_epoch_ms: u128,
    created_at_iso: String,
}

fn runtime_profiles() -> Vec<RuntimeProfile> {
    vec![
        RuntimeProfile {
            id: "recommended-m1".into(),
            title: "Recommended (M1 Fast Local)".into(),
            description:
                "whisper.cpp with Metal acceleration. Best speed + offline reliability on Apple Silicon."
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

fn app_data_dir(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!("Unable to resolve app data directory: {e}"))?;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn settings_path(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app_data_dir(app)?;
    Ok(dir.join("settings.json"))
}

fn runtime_dir(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app_data_dir(app)?.join("runtime");
    fs::create_dir_all(&dir)?;
    fs::create_dir_all(dir.join("models"))?;
    fs::create_dir_all(dir.join("output"))?;
    Ok(dir)
}

fn recordings_output_dir(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    let dir = runtime_dir(app)?.join("output");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn is_supported_mic_extension(ext: &str) -> bool {
    matches!(ext, "wav" | "webm" | "m4a" | "ogg" | "mp3" | "aac" | "flac")
}

fn is_mic_recording_file(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };

    if !file_name.starts_with("mic-") {
        return false;
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    is_supported_mic_extension(&extension)
}

fn to_epoch_ms(system_time: SystemTime) -> u128 {
    system_time
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn to_iso(system_time: SystemTime) -> String {
    let dt: DateTime<Utc> = DateTime::<Utc>::from(system_time);
    dt.to_rfc3339()
}

fn model_name(settings: &AppSettings, profile: &RuntimeProfile) -> String {
    let custom = settings
        .custom_model
        .as_ref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty());

    custom.unwrap_or(&profile.model).to_string()
}

fn mime_type_to_extension(mime_type: Option<&str>) -> &'static str {
    match mime_type.unwrap_or_default() {
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" => "m4a",
        "audio/ogg" => "ogg",
        "audio/mpeg" => "mp3",
        _ => "webm",
    }
}

async fn detect_ffmpeg_bin() -> Option<String> {
    if command_available("ffmpeg", &["-version"]).await {
        return Some("ffmpeg".to_string());
    }

    if let Ok(path) = env::var("LOUDIO_FFMPEG_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() && command_available(trimmed, &["-version"]).await {
            return Some(trimmed.to_string());
        }
    }

    let candidates = [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ];

    for candidate in candidates {
        if command_available(candidate, &["-version"]).await {
            return Some(candidate.to_string());
        }
    }

    None
}

async fn maybe_convert_audio_to_wav(input_path: &PathBuf) -> anyhow::Result<PathBuf> {
    let wav_path = input_path.with_extension("wav");

    let ffmpeg_bin = detect_ffmpeg_bin()
        .await
        .ok_or_else(|| anyhow!("ffmpeg not found in PATH or common install locations"))?;

    run_command(
        &ffmpeg_bin,
        &[
            "-y".into(),
            "-i".into(),
            input_path.to_string_lossy().to_string(),
            "-ar".into(),
            "16000".into(),
            "-ac".into(),
            "1".into(),
            wav_path.to_string_lossy().to_string(),
        ],
    )
    .await
    .with_context(|| format!("Failed to convert microphone audio to wav with ffmpeg at {ffmpeg_bin}"))?;

    Ok(wav_path)
}

fn emit_runtime_bootstrap_progress(app: &tauri::AppHandle, percent: u8, message: impl Into<String>, done: bool) {
    let _ = app.emit(
        "runtime-bootstrap-progress",
        RuntimeBootstrapProgressEvent {
            percent,
            message: message.into(),
            done,
        },
    );
}

fn emit_transcription_progress(
    app: &tauri::AppHandle,
    partial_text: Option<String>,
    status: impl Into<String>,
    done: bool,
    error: bool,
) {
    let _ = app.emit(
        "transcription-progress",
        TranscriptionProgressEvent {
            partial_text,
            status: status.into(),
            done,
            error,
        },
    );
}

async fn run_command(bin: &str, args: &[String]) -> anyhow::Result<(String, String)> {
    let output = Command::new(bin)
        .args(args)
        .output()
        .await
        .with_context(|| format!("Failed to launch command: {bin}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(anyhow!(
            "Command failed: {} {}\n{}",
            bin,
            args.join(" "),
            if stderr.trim().is_empty() { stdout.clone() } else { stderr.clone() }
        ));
    }

    Ok((stdout, stderr))
}

async fn command_available(bin: &str, args: &[&str]) -> bool {
    Command::new(bin).args(args).output().await.is_ok_and(|o| o.status.success())
}

async fn detect_python_with_whisper() -> Option<String> {
    let python_candidates = ["python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"];

    for candidate in python_candidates {
        if command_available(candidate, &["-m", "whisper", "--help"]).await {
            return Some(candidate.to_string());
        }
    }

    None
}

fn venv_python_path(venv_dir: &PathBuf) -> PathBuf {
    venv_dir.join("bin").join("python3")
}

async fn ensure_python_whisper_runtime(app: &tauri::AppHandle) -> anyhow::Result<String> {
    if let Some(system_python) = detect_python_with_whisper().await {
        return Ok(system_python);
    }

    let venv_dir = runtime_dir(app)?.join("python-venv");
    let venv_python = venv_python_path(&venv_dir);

    if !venv_python.exists() {
        run_command(
            "python3",
            &[
                "-m".into(),
                "venv".into(),
                venv_dir.to_string_lossy().to_string(),
            ],
        )
        .await
        .context("Failed to create app-local Python virtual environment")?;
    }

    run_command(
        &venv_python.to_string_lossy(),
        &["-m".into(), "pip".into(), "install".into(), "-U".into(), "pip".into()],
    )
    .await
    .context("Failed to upgrade pip in app-local virtual environment")?;

    run_command(
        &venv_python.to_string_lossy(),
        &[
            "-m".into(),
            "pip".into(),
            "install".into(),
            "-U".into(),
            "openai-whisper".into(),
        ],
    )
    .await
    .context("Failed to install openai-whisper in app-local virtual environment")?;

    let ready = command_available(
        &venv_python.to_string_lossy(),
        &["-m", "whisper", "--help"],
    )
    .await;

    if !ready {
        return Err(anyhow!(
            "openai-whisper installation in app-local virtual environment did not succeed"
        ));
    }

    Ok(venv_python.to_string_lossy().to_string())
}

async fn detect_whisper_cli(manual_engine_path: Option<&str>) -> Option<String> {
    if let Some(path) = manual_engine_path {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            let ok = Command::new(trimmed)
                .arg("-h")
                .output()
                .await
                .is_ok_and(|o| o.status.success() || !o.stderr.is_empty());
            if ok {
                return Some(trimmed.to_string());
            }
        }
    }

    for candidate in ["whisper-cli", "/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli"] {
        let ok = Command::new(candidate)
            .arg("-h")
            .output()
            .await
            .is_ok_and(|o| o.status.success() || !o.stderr.is_empty());
        if ok {
            return Some(candidate.to_string());
        }
    }

    None
}

async fn ensure_ggml_model(app: &tauri::AppHandle, model: &str) -> anyhow::Result<PathBuf> {
    let model_path = runtime_dir(app)?.join("models").join(format!("ggml-{model}.bin"));

    if model_path.exists() {
        return Ok(model_path);
    }

    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin"
    );

    run_command(
        "curl",
        &[
            "-L".into(),
            "-o".into(),
            model_path.to_string_lossy().to_string(),
            url,
        ],
    )
    .await
    .context("Failed to download ggml model")?;

    Ok(model_path)
}

async fn transcribe_with_whisper_cpp(
    app: &tauri::AppHandle,
    request: &TranscriptionRequest,
    profile: &RuntimeProfile,
) -> anyhow::Result<TranscriptionResponse> {
    let model = model_name(&request.settings, profile);
    let model_path = ensure_ggml_model(app, &model).await?;

    let whisper_cli = detect_whisper_cli(request.settings.manual_engine_path.as_deref())
        .await
        .ok_or_else(|| anyhow!("whisper-cli not found. Bootstrap runtime first or set manual engine path."))?;

    let output_root = runtime_dir(app)?.join("output").join(Uuid::new_v4().to_string());
    fs::create_dir_all(output_root.parent().unwrap_or(&runtime_dir(app)?))?;

    let mut args = vec![
        "-f".into(),
        request.audio_path.clone(),
        "-m".into(),
        model_path.to_string_lossy().to_string(),
        "-otxt".into(),
        "-of".into(),
        output_root.to_string_lossy().to_string(),
    ];

    if request.settings.language != "auto" {
        args.push("-l".into());
        args.push(request.settings.language.clone());
    }

    if request.settings.task == "translate" {
        args.push("-tr".into());
    }

    let started = Instant::now();
    run_command(&whisper_cli, &args).await?;
    let elapsed = started.elapsed().as_millis();

    let txt_path = output_root.with_extension("txt");
    let text = fs::read_to_string(&txt_path)
        .with_context(|| format!("Missing transcription output file: {}", txt_path.display()))?;

    Ok(TranscriptionResponse {
        text,
        language_detected: if request.settings.language == "auto" {
            None
        } else {
            Some(request.settings.language.clone())
        },
        elapsed_ms: elapsed,
        model_used: format!("whisper.cpp:{model}"),
    })
}

async fn transcribe_with_python(
    app: &tauri::AppHandle,
    request: &TranscriptionRequest,
    profile: &RuntimeProfile,
) -> anyhow::Result<TranscriptionResponse> {
    let python_bin = ensure_python_whisper_runtime(app)
        .await
        .context("Python Whisper runtime is not ready")?;

    let model = model_name(&request.settings, profile);
    let run_id = Uuid::new_v4().to_string();
    let output_dir = runtime_dir(app)?.join("output").join(&run_id);
    fs::create_dir_all(&output_dir)?;

    let mut args = vec![
        "-m".into(),
        "whisper".into(),
        request.audio_path.clone(),
        "--model".into(),
        model.clone(),
        "--output_format".into(),
        "txt".into(),
        "--output_dir".into(),
        output_dir.to_string_lossy().to_string(),
        "--task".into(),
        request.settings.task.clone(),
        "--temperature".into(),
        request.settings.temperature.to_string(),
        "--beam_size".into(),
        request.settings.beam_size.to_string(),
        "--fp16".into(),
        "False".into(),
        "--verbose".into(),
        "True".into(),
    ];

    if request.settings.language != "auto" {
        args.push("--language".into());
        args.push(request.settings.language.clone());
    }

    let mut child = Command::new(&python_bin)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .with_context(|| format!("Failed to launch command: {python_bin}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Failed to capture python whisper stdout"))?;

    let mut reader = BufReader::new(stdout).lines();
    let started = Instant::now();
    let mut partial = String::new();

    while let Some(line) = reader.next_line().await.context("Failed reading whisper output")? {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        partial.push_str(trimmed);
        partial.push('\n');

        emit_transcription_progress(
            app,
            Some(partial.clone()),
            format!("Transcribing… {trimmed}"),
            false,
            false,
        );
    }

    let status = child.wait().await.context("Failed waiting for python whisper process")?;
    if !status.success() {
        return Err(anyhow!("Python Whisper process exited with status: {status}"));
    }

    let elapsed = started.elapsed().as_millis();

    let stem = PathBuf::from(&request.audio_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or_else(|| anyhow!("Invalid audio file path"))?;

    let txt_path = output_dir.join(format!("{stem}.txt"));
    let text = if txt_path.exists() {
        fs::read_to_string(&txt_path)
            .with_context(|| format!("Unable to read transcription output: {}", txt_path.display()))?
    } else {
        let first_txt = fs::read_dir(&output_dir)
            .with_context(|| format!("Unable to inspect output directory: {}", output_dir.display()))?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .find(|path| path.extension().is_some_and(|ext| ext == "txt"))
            .ok_or_else(|| anyhow!("No transcript file produced by Whisper"))?;

        fs::read_to_string(&first_txt)
            .with_context(|| format!("Unable to read transcription output: {}", first_txt.display()))?
    };

    Ok(TranscriptionResponse {
        text,
        language_detected: if request.settings.language == "auto" {
            None
        } else {
            Some(request.settings.language.clone())
        },
        elapsed_ms: elapsed,
        model_used: format!("openai-whisper:{model}"),
    })
}

#[tauri::command]
fn get_runtime_profiles() -> Vec<RuntimeProfile> {
    runtime_profiles()
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<Option<AppSettings>, String> {
    let path = settings_path(&app).map_err(|e| e.to_string())?;

    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let parsed = serde_json::from_str::<AppSettings>(&raw).map_err(|e| e.to_string())?;
    Ok(Some(parsed))
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_microphone_recordings(app: tauri::AppHandle) -> Result<Vec<RecordingHistoryItem>, String> {
    let output_dir = recordings_output_dir(&app).map_err(|e| e.to_string())?;

    let mut items: Vec<RecordingHistoryItem> = fs::read_dir(&output_dir)
        .map_err(|e| format!("Failed to read recordings directory: {e}"))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() || !is_mic_recording_file(&path) {
                return None;
            }

            let metadata = entry.metadata().ok()?;
            let created_time = metadata
                .created()
                .ok()
                .or_else(|| metadata.modified().ok())
                .unwrap_or(SystemTime::UNIX_EPOCH);

            let epoch_ms = to_epoch_ms(created_time);
            let iso = to_iso(created_time);
            let absolute_path = path.to_string_lossy().to_string();
            let file_name = path.file_name()?.to_string_lossy().to_string();
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.to_ascii_lowercase())
                .unwrap_or_default();

            Some(RecordingHistoryItem {
                id: absolute_path.clone(),
                file_name,
                absolute_path,
                extension,
                size_bytes: metadata.len(),
                created_at_epoch_ms: epoch_ms,
                created_at_iso: iso,
            })
        })
        .collect();

    items.sort_by(|a, b| b.created_at_epoch_ms.cmp(&a.created_at_epoch_ms));
    Ok(items)
}

#[tauri::command]
fn delete_microphone_recording(app: tauri::AppHandle, absolute_path: String) -> Result<(), String> {
    let output_dir = recordings_output_dir(&app).map_err(|e| e.to_string())?;
    let canonical_output = fs::canonicalize(&output_dir)
        .map_err(|e| format!("Failed to resolve recordings directory: {e}"))?;

    let candidate_path = PathBuf::from(&absolute_path);
    if !candidate_path.exists() {
        return Err("Recording file no longer exists.".into());
    }

    let canonical_candidate = fs::canonicalize(&candidate_path)
        .map_err(|e| format!("Failed to resolve recording path: {e}"))?;

    if !canonical_candidate.starts_with(&canonical_output) {
        return Err("Refusing to delete files outside Loudio recordings directory.".into());
    }

    if !is_mic_recording_file(&canonical_candidate) {
        return Err("Refusing to delete non-microphone recording file.".into());
    }

    fs::remove_file(&canonical_candidate)
        .map_err(|e| format!("Failed to delete recording file: {e}"))?;

    Ok(())
}

#[tauri::command]
async fn bootstrap_runtime(app: tauri::AppHandle) -> Result<String, String> {
    let mut messages: Vec<String> = Vec::new();

    emit_runtime_bootstrap_progress(&app, 5, "Preparing runtime directories…", false);
    runtime_dir(&app).map_err(|e| e.to_string())?;

    emit_runtime_bootstrap_progress(&app, 20, "Checking FFmpeg availability…", false);
    if let Some(ffmpeg_bin) = detect_ffmpeg_bin().await {
        messages.push(format!("FFmpeg detected at {ffmpeg_bin}."));
        emit_runtime_bootstrap_progress(&app, 35, "FFmpeg detected.", false);
    } else {
        messages.push("FFmpeg missing. Attempting Homebrew install...".into());
        emit_runtime_bootstrap_progress(&app, 35, "FFmpeg missing. Attempting install…", false);
        if run_command("brew", &["install".into(), "ffmpeg".into()]).await.is_ok() {
            if let Some(ffmpeg_bin) = detect_ffmpeg_bin().await {
                messages.push(format!("FFmpeg installed via Homebrew at {ffmpeg_bin}."));
                emit_runtime_bootstrap_progress(&app, 45, "FFmpeg installed.", false);
            } else {
                messages.push("FFmpeg install completed but binary is still not discoverable from Loudio runtime.".into());
                emit_runtime_bootstrap_progress(
                    &app,
                    45,
                    "FFmpeg installed but not discoverable. Configure LOUDIO_FFMPEG_PATH.",
                    false,
                );
            }
        } else {
            messages.push("Failed to auto-install FFmpeg. Install manually with `brew install ffmpeg` or set LOUDIO_FFMPEG_PATH.".into());
            emit_runtime_bootstrap_progress(&app, 45, "FFmpeg install failed. Manual install required.", false);
        }
    }

    emit_runtime_bootstrap_progress(&app, 55, "Checking whisper.cpp availability…", false);
    let has_whisper_cpp = detect_whisper_cli(None).await.is_some();
    if has_whisper_cpp {
        messages.push("whisper.cpp CLI detected.".into());
        emit_runtime_bootstrap_progress(&app, 65, "whisper.cpp detected.", false);
    } else {
        messages.push("whisper.cpp missing. Attempting Homebrew install...".into());
        emit_runtime_bootstrap_progress(&app, 65, "whisper.cpp missing. Attempting install…", false);
        if run_command("brew", &["install".into(), "whisper-cpp".into()]).await.is_ok() {
            messages.push("whisper.cpp installed via Homebrew.".into());
            emit_runtime_bootstrap_progress(&app, 75, "whisper.cpp installed.", false);
        } else {
            messages.push("Failed to auto-install whisper.cpp. You can still run Python Whisper profile.".into());
            emit_runtime_bootstrap_progress(&app, 75, "whisper.cpp install failed. Python profile can still work.", false);
        }
    }

    emit_runtime_bootstrap_progress(&app, 82, "Checking Python Whisper availability…", false);
    match ensure_python_whisper_runtime(&app).await {
        Ok(python_bin) => {
            if python_bin.contains("python-venv") {
                messages.push("OpenAI Whisper installed in app-local virtual environment.".into());
                emit_runtime_bootstrap_progress(&app, 95, "Python Whisper ready (app-local venv).", false);
            } else {
                messages.push("OpenAI Whisper (Python) detected.".into());
                emit_runtime_bootstrap_progress(&app, 95, "Python Whisper detected.", false);
            }
        }
        Err(error) => {
            messages.push(format!(
                "Python Whisper unavailable. Automatic app-local setup failed: {}",
                error
            ));
            emit_runtime_bootstrap_progress(
                &app,
                95,
                "Python Whisper setup failed. whisper.cpp profile remains available.",
                false,
            );
        }
    }

    emit_runtime_bootstrap_progress(&app, 100, "Runtime check complete.", true);
    Ok(messages.join(" "))
}


#[tauri::command]
async fn transcribe_audio(
    app: tauri::AppHandle,
    request: TranscriptionRequest,
) -> Result<TranscriptionResponse, String> {
    emit_transcription_progress(
        &app,
        None,
        "Transcription started…",
        false,
        false,
    );

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
async fn transcribe_microphone_audio(
    app: tauri::AppHandle,
    request: MicrophoneTranscriptionRequest,
) -> Result<TranscriptionResponse, String> {
    let bytes = BASE64_STANDARD
        .decode(request.audio_base64.as_bytes())
        .map_err(|e| format!("Invalid microphone payload: {e}"))?;

    let extension = mime_type_to_extension(request.mime_type.as_deref());
    let input_path = runtime_dir(&app)
        .map_err(|e| e.to_string())?
        .join("output")
        .join(format!("mic-{}.{}", Uuid::new_v4(), extension));

    fs::write(&input_path, bytes).map_err(|e| format!("Failed to save microphone audio: {e}"))?;

    emit_transcription_progress(
        &app,
        None,
        "Preparing microphone audio…",
        false,
        false,
    );

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

        match maybe_convert_audio_to_wav(&input_path).await {
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

fn main() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_runtime_profiles,
            load_settings,
            save_settings,
            bootstrap_runtime,
            transcribe_audio,
            transcribe_microphone_audio,
            list_microphone_recordings,
            delete_microphone_recording
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
