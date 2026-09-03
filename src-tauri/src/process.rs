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
            if stderr.trim().is_empty() {
                stdout.clone()
            } else {
                stderr.clone()
            }
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

/// Maps a `MediaRecorder` blob type onto the file extension to store it under.
///
/// The essence is matched on its own: a blob's type carries codec parameters
/// (`audio/webm;codecs=opus`, `audio/mp4;codecs=mp4a.40.2`), and matching the
/// full string meant anything parameterised other than webm fell through to the
/// catch-all and was written as `.webm` regardless of what it actually held.
pub fn mime_type_to_extension(mime_type: Option<&str>) -> &'static str {
    let essence = mime_type
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();

    match essence.as_str() {
        "audio/wav" | "audio/x-wav" | "audio/wave" | "audio/vnd.wave" => "wav",
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" | "audio/aac" => "m4a",
        "audio/ogg" | "application/ogg" => "ogg",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/flac" | "audio/x-flac" => "flac",
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

#[cfg(test)]
mod tests {
    use super::mime_type_to_extension;

    /// The Linux capture path always reports `audio/wav`, so this mapping is
    /// what keeps recordings on that platform from being filed as `.webm`.
    #[test]
    fn maps_linux_audiocontext_wav() {
        assert_eq!(mime_type_to_extension(Some("audio/wav")), "wav");
        assert_eq!(mime_type_to_extension(Some("audio/x-wav")), "wav");
    }

    #[test]
    fn maps_webm_with_codec_parameters() {
        assert_eq!(mime_type_to_extension(Some("audio/webm")), "webm");
        assert_eq!(
            mime_type_to_extension(Some("audio/webm;codecs=opus")),
            "webm"
        );
    }

    /// The regression this function was changed for: matching the full MIME
    /// string sent every parameterised type that was not webm to the catch-all,
    /// so an MP4 capture was written to a `.webm` file it could not be read from.
    #[test]
    fn parameterised_types_are_not_misfiled_as_webm() {
        assert_eq!(
            mime_type_to_extension(Some("audio/mp4;codecs=mp4a.40.2")),
            "m4a"
        );
        assert_eq!(mime_type_to_extension(Some("audio/wav;codecs=1")), "wav");
        assert_eq!(
            mime_type_to_extension(Some("audio/ogg; codecs=opus")),
            "ogg"
        );
    }

    #[test]
    fn ignores_case_and_surrounding_space() {
        assert_eq!(mime_type_to_extension(Some("AUDIO/WAV")), "wav");
        assert_eq!(mime_type_to_extension(Some("  audio/mpeg  ")), "mp3");
    }

    /// webm remains the fallback: it is what MediaRecorder produces by default,
    /// and ffmpeg sniffs the real container regardless of the extension.
    #[test]
    fn falls_back_to_webm_when_unknown_or_absent() {
        assert_eq!(mime_type_to_extension(None), "webm");
        assert_eq!(mime_type_to_extension(Some("")), "webm");
        assert_eq!(mime_type_to_extension(Some("application/octet-stream")), "webm");
    }
}
