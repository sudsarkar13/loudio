use anyhow::{anyhow, Context, Result};
use std::{fs, time::Instant};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};
use uuid::Uuid;

use crate::{
    binaries::{detect_whisper_cli, ensure_python_whisper_runtime},
    models::{AppSettings, RuntimeProfile, TranscriptionRequest, TranscriptionResponse},
    paths::runtime_dir,
    process::{emit_transcription_progress, run_command},
};

pub fn model_name(settings: &AppSettings, profile: &RuntimeProfile) -> String {
    let custom = settings
        .custom_model
        .as_ref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty());

    custom.unwrap_or(&profile.model).to_string()
}

pub async fn ensure_ggml_model(app: &tauri::AppHandle, model: &str) -> Result<std::path::PathBuf> {
    let model_path = runtime_dir(app)?
        .join("models")
        .join(format!("ggml-{model}.bin"));

    if model_path.exists() {
        return Ok(model_path);
    }

    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin");

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

pub async fn transcribe_with_whisper_cpp(
    app: &tauri::AppHandle,
    request: &TranscriptionRequest,
    profile: &RuntimeProfile,
) -> Result<TranscriptionResponse> {
    let model = model_name(&request.settings, profile);
    let model_path = ensure_ggml_model(app, &model).await?;

    let whisper_cli = detect_whisper_cli(request.settings.manual_engine_path.as_deref())
        .await
        .ok_or_else(|| {
            anyhow!("whisper-cli not found. Bootstrap runtime first or set manual engine path.")
        })?;

    let output_root = runtime_dir(app)?
        .join("output")
        .join(Uuid::new_v4().to_string());
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

pub async fn transcribe_with_python(
    app: &tauri::AppHandle,
    request: &TranscriptionRequest,
    profile: &RuntimeProfile,
) -> Result<TranscriptionResponse> {
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
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .with_context(|| format!("Failed to launch command: {python_bin}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Failed to capture python whisper stdout"))?;

    let mut reader = BufReader::new(stdout).lines();
    let started = Instant::now();
    let mut partial = String::new();

    while let Some(line) = reader
        .next_line()
        .await
        .context("Failed reading whisper output")?
    {
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

    let status = child
        .wait()
        .await
        .context("Failed waiting for python whisper process")?;
    if !status.success() {
        return Err(anyhow!(
            "Python Whisper process exited with status: {status}"
        ));
    }

    let elapsed = started.elapsed().as_millis();

    let stem = std::path::PathBuf::from(&request.audio_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or_else(|| anyhow!("Invalid audio file path"))?;

    let txt_path = output_dir.join(format!("{stem}.txt"));
    let text = if txt_path.exists() {
        fs::read_to_string(&txt_path).with_context(|| {
            format!(
                "Unable to read transcription output: {}",
                txt_path.display()
            )
        })?
    } else {
        let first_txt = fs::read_dir(&output_dir)
            .with_context(|| {
                format!(
                    "Unable to inspect output directory: {}",
                    output_dir.display()
                )
            })?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .find(|path| path.extension().is_some_and(|ext| ext == "txt"))
            .ok_or_else(|| anyhow!("No transcript file produced by Whisper"))?;

        fs::read_to_string(&first_txt).with_context(|| {
            format!(
                "Unable to read transcription output: {}",
                first_txt.display()
            )
        })?
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
