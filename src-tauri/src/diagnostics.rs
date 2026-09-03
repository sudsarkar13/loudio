//! Append-only diagnostic log.
//!
//! Loudio previously initialised `tracing_subscriber` to stderr, which a
//! packaged `.app` or `.deb` discards — so when a user reported that the
//! microphone "sometimes" fails there was nothing on disk to look at. Failures
//! that only reproduce in one window mode, on one machine, are exactly the kind
//! that need a record rather than a repro.
//!
//! One JSON object per line, so the file is greppable by hand and parseable by
//! machine without a schema.

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
};

use serde::{Deserialize, Serialize};

use crate::paths::app_data_dir;

/// Rotate once the live file passes this. Two generations are kept, so the log
/// costs at most ~4 MB and still spans many sessions.
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticEvent {
    /// "info" | "warn" | "error".
    pub level: String,
    /// Subsystem the event came from, e.g. "mic", "transcribe", "window".
    pub scope: String,
    pub message: String,
    /// Free-form context. Kept untyped so instrumentation can be added without
    /// a schema change on both sides of the IPC.
    #[serde(default)]
    pub fields: serde_json::Value,
}

pub fn logs_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app).map_err(|e| e.to_string())?.join("logs");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create logs directory: {e}"))?;
    Ok(dir)
}

fn log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(logs_dir(app)?.join("loudio.log"))
}

fn rotate_if_needed(path: &PathBuf) {
    let too_big = fs::metadata(path).map(|meta| meta.len() > MAX_LOG_BYTES).unwrap_or(false);
    if !too_big {
        return;
    }
    // A failed rotation must not stop logging, so the result is deliberately
    // ignored: the worst case is a file that grows past the cap.
    let _ = fs::rename(path, path.with_extension("log.1"));
}

/// Appends one event. Never returns an error to the caller — logging must not
/// be able to break the thing it is observing.
pub fn record(app: &tauri::AppHandle, event: &DiagnosticEvent) {
    let Ok(path) = log_path(app) else { return };
    rotate_if_needed(&path);

    let line = serde_json::json!({
        "ts": chrono::Utc::now().to_rfc3339(),
        "level": event.level,
        "scope": event.scope,
        "message": event.message,
        "fields": event.fields,
    });

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
}

/// Writes an event produced by the webview into the same file as the backend's,
/// so a capture failure and the ffmpeg run that followed it sit in one timeline.
#[tauri::command]
pub fn log_diagnostic_event(app: tauri::AppHandle, event: DiagnosticEvent) {
    record(&app, &event);
}

/// Returns the tail of the log, newest content last.
///
/// Bounded because the UI renders this and the file can reach the rotation cap.
#[tauri::command]
pub fn read_diagnostics_log(app: tauri::AppHandle, max_bytes: Option<u64>) -> Result<String, String> {
    let path = log_path(&app)?;
    if !path.is_file() {
        return Ok(String::new());
    }

    let limit = max_bytes.unwrap_or(256 * 1024);
    let raw = fs::read(&path).map_err(|e| format!("Failed to read diagnostics log: {e}"))?;

    let start = raw.len().saturating_sub(limit as usize);
    // Resume at a line boundary so a truncated first line is not shown as a
    // corrupt JSON record.
    let slice = match raw[start..].iter().position(|byte| *byte == b'\n') {
        Some(offset) if start > 0 => &raw[start + offset + 1..],
        _ => &raw[start..],
    };

    Ok(String::from_utf8_lossy(slice).to_string())
}

/// Opens the logs directory in the platform file manager, so a user can attach
/// the file to a bug report without being told where to look.
///
/// Mirrors `recordings::reveal_recordings_output_dir` rather than sharing a
/// helper: each arm is a single `Command`, and per-platform `cfg` blocks keep
/// the Linux build free of the macOS and Windows branches entirely.
#[tauri::command]
pub fn reveal_diagnostics_logs(app: tauri::AppHandle) -> Result<(), String> {
    let dir = logs_dir(&app)?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Failed to open the file manager: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Failed to open Explorer: {e}"))?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        return Err("Revealing the logs directory is not supported on this platform.".into());
    }

    Ok(())
}
