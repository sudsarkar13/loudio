use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

pub fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!("Unable to resolve app data directory: {e}"))?;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    let dir = app_data_dir(app)?;
    Ok(dir.join("settings.json"))
}

pub fn runtime_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    let dir = app_data_dir(app)?.join("runtime");
    fs::create_dir_all(&dir)?;
    fs::create_dir_all(dir.join("models"))?;
    fs::create_dir_all(dir.join("output"))?;
    Ok(dir)
}

pub fn recordings_output_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    let dir = runtime_dir(app)?.join("output");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn is_supported_mic_extension(ext: &str) -> bool {
    matches!(ext, "wav" | "webm" | "m4a" | "ogg" | "mp3" | "aac" | "flac")
}

pub fn is_mic_recording_file(path: &Path) -> bool {
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

pub fn to_epoch_ms(system_time: SystemTime) -> u128 {
    system_time
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

pub fn to_iso(system_time: SystemTime) -> String {
    let dt: DateTime<Utc> = DateTime::<Utc>::from(system_time);
    dt.to_rfc3339()
}
