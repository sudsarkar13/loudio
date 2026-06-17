use anyhow::{anyhow, Context, Result};
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

use crate::models::{RuntimeBootstrapProgressEvent, TranscriptionProgressEvent};

pub async fn run_command(bin: &str, args: &[String]) -> Result<(String, String)> {
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

pub async fn command_available(bin: &str, args: &[&str]) -> bool {
    Command::new(bin)
        .args(args)
        .output()
        .await
        .is_ok_and(|o| o.status.success())
}

pub fn mime_type_to_extension(mime_type: Option<&str>) -> &'static str {
    match mime_type.unwrap_or_default() {
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" => "m4a",
        "audio/ogg" => "ogg",
        "audio/mpeg" => "mp3",
        _ => "webm",
    }
}

pub fn emit_runtime_bootstrap_progress(
    app: &AppHandle,
    percent: u8,
    message: impl Into<String>,
    done: bool,
) {
    let _ = app.emit(
        "runtime-bootstrap-progress",
        RuntimeBootstrapProgressEvent {
            percent,
            message: message.into(),
            done,
        },
    );
}

pub fn emit_transcription_progress(
    app: &AppHandle,
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
