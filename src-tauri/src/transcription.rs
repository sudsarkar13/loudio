use anyhow::{anyhow, Context, Result};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Instant,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};
use uuid::Uuid;

use crate::{
    binaries::{
        detect_whisper_cli, ensure_python_whisper_runtime, snap_name_for, snap_staging_dir,
        stage_file,
    },
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

/// Size the model weights should have upstream, or `None` when we cannot ask
/// (offline, proxy, transient failure). Used to tell a complete download apart
/// from a truncated one.
async fn remote_content_length(url: &str) -> Option<u64> {
    let (stdout, _) = run_command(
        "curl",
        &[
            "-sIL".into(),
            "--max-time".into(),
            "20".into(),
            url.to_string(),
        ],
    )
    .await
    .ok()?;

    // Follow-redirect responses stack up; the final header block is the real one.
    stdout
        .lines()
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.trim()
                .eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<u64>().ok())?
        })
        .next_back()
}

/// Downloads the ggml weights for `model` if they are not already present and
/// complete.
///
/// Downloads land in a `.part` file and are only promoted to the final name
/// after the byte count matches upstream. Without that, an interrupted download
/// (closing the app mid-transfer, a dropped connection, or an HTTP error page
/// saved verbatim because `curl` was not run with `-f`) leaves a short file that
/// `exists()` happily accepts forever — whisper.cpp then fails on every
/// subsequent run with "not all tensors loaded from model file".
pub async fn ensure_ggml_model(app: &tauri::AppHandle, model: &str) -> Result<PathBuf> {
    let model_path = runtime_dir(app)?
        .join("models")
        .join(format!("ggml-{model}.bin"));
    let part_path = model_path.with_extension("bin.part");
    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin");

    let local_len = fs::metadata(&model_path).ok().map(|meta| meta.len());
    let expected_len = remote_content_length(&url).await;

    match (local_len, expected_len) {
        (Some(local), Some(expected)) if local == expected => return Ok(model_path),
        // Offline with weights already on disk: trust them rather than blocking
        // an otherwise-working offline transcription.
        (Some(_), None) => return Ok(model_path),
        (Some(local), Some(expected)) => {
            emit_transcription_progress(
                app,
                None,
                format!(
                    "Model ggml-{model}.bin is incomplete ({local} of {expected} bytes). Re-downloading…"
                ),
                false,
                false,
            );
            // Resume from what we already have instead of starting over.
            let _ = fs::rename(&model_path, &part_path);
        }
        (None, _) => {
            emit_transcription_progress(
                app,
                None,
                format!("Downloading whisper model ggml-{model}.bin (one-time, may take a while)…"),
                false,
                false,
            );
        }
    }

    run_command(
        "curl",
        &[
            // -f: fail on HTTP errors instead of writing the error body as weights.
            // -C -: resume a partial transfer. --retry: survive flaky connections.
            "-fL".into(),
            "-C".into(),
            "-".into(),
            "--retry".into(),
            "3".into(),
            "--retry-delay".into(),
            "2".into(),
            "-o".into(),
            part_path.to_string_lossy().to_string(),
            url.clone(),
        ],
    )
    .await
    .with_context(|| format!("Failed to download whisper model ggml-{model}.bin"))?;

    let downloaded_len = fs::metadata(&part_path)
        .with_context(|| format!("Model download produced no file at {}", part_path.display()))?
        .len();

    if let Some(expected) = expected_len {
        if downloaded_len != expected {
            let _ = fs::remove_file(&part_path);
            return Err(anyhow!(
                "Model download for ggml-{model}.bin is incomplete ({downloaded_len} of {expected} bytes). Check the network connection and try again."
            ));
        }
    }

    fs::rename(&part_path, &model_path).with_context(|| {
        format!(
            "Failed to move downloaded model into place at {}",
            model_path.display()
        )
    })?;

    Ok(model_path)
}

/// Where whisper.cpp should read its input and write its output.
///
/// Normally that is Loudio's own runtime dir. A snap-packaged `whisper-cli`,
/// however, is confined by AppArmor and cannot see dot-directories in `$HOME`,
/// which is exactly where the app data dir lives — so for snap engines we
/// hardlink the audio and the model into the snap's own writable area first.
struct EngineWorkspace {
    audio: PathBuf,
    model: PathBuf,
    output_root: PathBuf,
    /// True when `audio` is a staged duplicate that should be removed once the
    /// run finishes. The staged *model* is deliberately kept — it is a hardlink
    /// that costs no extra disk and saves staging it again next time.
    staged: bool,
}

fn prepare_engine_workspace(
    app: &tauri::AppHandle,
    engine_bin: &str,
    audio_path: &Path,
    model_path: &Path,
) -> Result<EngineWorkspace> {
    let run_id = Uuid::new_v4().to_string();

    let Some(snap) = snap_name_for(engine_bin) else {
        return Ok(EngineWorkspace {
            audio: audio_path.to_path_buf(),
            model: model_path.to_path_buf(),
            output_root: runtime_dir(app)?.join("output").join(run_id),
            staged: false,
        });
    };

    let staging = snap_staging_dir(&snap)?;

    let audio_name = audio_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("input.wav");
    let model_name = model_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("model.bin");

    let audio = stage_file(audio_path, &staging, audio_name).with_context(|| {
        format!("Failed to stage audio for the snap-confined {snap} engine")
    })?;
    let model = stage_file(model_path, &staging, model_name).with_context(|| {
        format!("Failed to stage the whisper model for the snap-confined {snap} engine")
    })?;

    Ok(EngineWorkspace {
        audio,
        model,
        output_root: staging.join(run_id),
        staged: true,
    })
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

    let workspace = prepare_engine_workspace(
        app,
        &whisper_cli,
        Path::new(&request.audio_path),
        &model_path,
    )?;

    if let Some(parent) = workspace.output_root.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut args = vec![
        "-f".into(),
        workspace.audio.to_string_lossy().to_string(),
        "-m".into(),
        workspace.model.to_string_lossy().to_string(),
        "-otxt".into(),
        "-of".into(),
        workspace.output_root.to_string_lossy().to_string(),
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

    let txt_path = workspace.output_root.with_extension("txt");
    let text = fs::read_to_string(&txt_path)
        .with_context(|| format!("Missing transcription output file: {}", txt_path.display()))?;

    let _ = fs::remove_file(&txt_path);
    if workspace.staged {
        let _ = fs::remove_file(&workspace.audio);
    }

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
        // Unbuffered: python block-buffers stdout when it is a pipe, so without
        // this the `--verbose` segments only arrive in 8 KB bursts and the UI
        // shows no progress for the whole run.
        "-u".into(),
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
        // Whisper's own model cache lives here; keep it stable across runs.
        .env("PYTHONUNBUFFERED", "1")
        .stdout(std::process::Stdio::piped())
        // Captured rather than inherited: in a packaged build there is no
        // terminal attached, so an inherited stderr silently discards the very
        // message explaining why the fallback failed.
        .stderr(std::process::Stdio::piped())
        // Do not leave a multi-gigabyte whisper process running after the app
        // window goes away.
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("Failed to launch command: {python_bin}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Failed to capture python whisper stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("Failed to capture python whisper stderr"))?;

    // Drain stderr concurrently so a chatty run (pip/torch/ffmpeg warnings)
    // cannot fill the pipe buffer and deadlock the child.
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut collected = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            collected.push_str(&line);
            collected.push('\n');
        }
        collected
    });

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
    let stderr_output = stderr_task.await.unwrap_or_default();

    if !status.success() {
        let detail = stderr_output
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("no error output captured");
        return Err(anyhow!(
            "Python Whisper process exited with status {status}: {detail}"
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

    let _ = fs::remove_dir_all(&output_dir);

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
