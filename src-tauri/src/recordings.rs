use std::{fs, path::PathBuf, time::SystemTime};

use crate::{
    models::RecordingHistoryItem,
    paths::{is_mic_recording_file, recordings_output_dir, to_epoch_ms, to_iso},
};

pub fn list_microphone_recordings(
    app: tauri::AppHandle,
) -> Result<Vec<RecordingHistoryItem>, String> {
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

pub fn delete_microphone_recording(
    app: tauri::AppHandle,
    absolute_path: String,
) -> Result<(), String> {
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
