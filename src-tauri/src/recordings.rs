use std::{fs, path::PathBuf, time::SystemTime};

use crate::{
    models::{LegacyMigrationResult, LegacyRecordingDir, RecordingHistoryItem},
    paths::{is_mic_recording_file, recordings_output_dir, to_epoch_ms, to_iso},
};

/// All bundle identifiers that Loudio has shipped under. Any output directory
/// that matches one of these is considered a candidate for migration into the
/// current app's data dir.
///
/// Adding a new historical bundle id here is the supported way to keep old
/// microphone recordings discoverable after a product rename.
pub(crate) const KNOWN_BUNDLE_IDS: &[&str] = &[
    "com.lexprotech.loudio",
    "com.loudio.app",
    "com.loudio.desktop",
    "dev.loudio.app",
];

/// Patterns in app-support subdir names that suggest a Loudio-related
/// installation. We use these as a fallback in case the running binary uses a
/// bundle id that isn't in [`KNOWN_BUNDLE_IDS`] yet (e.g. a developer's local
/// fork), so we never silently strand microphone recordings on disk.
pub(crate) const LOUDIO_DIR_HINTS: &[&str] = &["loudio"];

/// Lists microphone recordings stored in the app's output directory.
///
/// Each microphone capture may produce both a source blob (e.g. `mic-<uuid>.webm`)
/// and an ffmpeg-converted wav (`mic-<uuid>.wav`). We treat them as a single
/// recording entry — preferring the **wav** when both are present — so users see
/// one entry per capture instead of two duplicates.
pub fn list_microphone_recordings(
    app: tauri::AppHandle,
) -> Result<Vec<RecordingHistoryItem>, String> {
    let output_dir = recordings_output_dir(&app).map_err(|e| e.to_string())?;

    // Group files by their base id (filename without extension), so we can dedupe
    // the source blob and its converted wav.
    let mut groups: std::collections::HashMap<String, Vec<PathBuf>> =
        std::collections::HashMap::new();

    for entry in fs::read_dir(&output_dir)
        .map_err(|e| format!("Failed to read recordings directory: {e}"))?
        .flatten()
    {
        let path = entry.path();
        if !path.is_file() || !is_mic_recording_file(&path) {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        groups.entry(stem.to_string()).or_default().push(path);
    }

    let mut items: Vec<RecordingHistoryItem> = groups
        .into_iter()
        .filter_map(|(_stem, mut paths)| {
            // Prefer the wav (converted) file, fall back to the first available
            // entry. Sort so wav comes first when both exist.
            paths.sort_by_key(|p| {
                let ext = p
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| value.to_ascii_lowercase())
                    .unwrap_or_default();
                if ext == "wav" {
                    0
                } else {
                    1
                }
            });
            let path = paths.remove(0);
            let metadata = fs::metadata(&path).ok()?;
            let created_time = metadata
                .created()
                .ok()
                .or_else(|| metadata.modified().ok())
                .unwrap_or(SystemTime::UNIX_EPOCH);

            let epoch_ms = to_epoch_ms(created_time);
            let iso = to_iso(created_time);
            let absolute_path = path.to_string_lossy().to_string();
            let file_name = path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default();
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.to_ascii_lowercase())
                .unwrap_or_default();
            let size_bytes = metadata.len();

            Some(RecordingHistoryItem {
                id: absolute_path.clone(),
                file_name,
                absolute_path,
                extension,
                size_bytes,
                created_at_epoch_ms: epoch_ms,
                created_at_iso: iso,
            })
        })
        .collect();

    items.sort_by(|a, b| b.created_at_epoch_ms.cmp(&a.created_at_epoch_ms));
    Ok(items)
}

/// Total on-disk size (in bytes) of all microphone recordings in the output dir.
/// Used by the UI to surface storage usage so users can confirm cleanups.
pub fn recordings_disk_usage(app: &tauri::AppHandle) -> Result<u64, String> {
    let output_dir = recordings_output_dir(app).map_err(|e| e.to_string())?;
    let mut total: u64 = 0;
    for entry in fs::read_dir(&output_dir)
        .map_err(|e| format!("Failed to read recordings directory: {e}"))?
        .flatten()
    {
        let path = entry.path();
        if !path.is_file() || !is_mic_recording_file(&path) {
            continue;
        }
        if let Ok(meta) = fs::metadata(&path) {
            total = total.saturating_add(meta.len());
        }
    }
    Ok(total)
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

    // Also delete the sibling file with the same stem but a different extension
    // (e.g. the original `.webm` next to the converted `.wav`) so users don't
    // see phantom storage usage after deletion.
    let sibling_stem = canonical_candidate.file_stem().map(|s| s.to_os_string());
    let canonical_candidate_str = canonical_candidate.to_string_lossy().to_string();

    fs::remove_file(&canonical_candidate)
        .map_err(|e| format!("Failed to delete recording file: {e}"))?;

    if let Some(stem) = sibling_stem {
        let parent = canonical_candidate.parent();
        if let Some(parent) = parent {
            if let Ok(read_dir) = fs::read_dir(parent) {
                for entry in read_dir.flatten() {
                    let sibling = entry.path();
                    if !sibling.is_file() {
                        continue;
                    }
                    if sibling.to_string_lossy() == canonical_candidate_str {
                        continue;
                    }
                    let sibling_stem_matches = sibling
                        .file_stem()
                        .map(|value| value.to_os_string() == stem)
                        .unwrap_or(false);
                    if sibling_stem_matches && is_mic_recording_file(&sibling) {
                        let _ = fs::remove_file(&sibling);
                    }
                }
            }
        }
    }

    Ok(())
}

/// Returns the platform-specific parent directory that holds per-bundle app
/// data folders (e.g. `~/Library/Application Support` on macOS).
pub(crate) fn platform_app_support_root() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
        })
    }
    #[cfg(target_os = "linux")]
    {
        // Honour $XDG_DATA_HOME first, then fall back to the default.
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
            Some(PathBuf::from(xdg))
        } else {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        }
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        None
    }
}

/// Lists legacy bundle-id output directories that still hold microphone
/// recordings but are NOT the current app's data dir. Each entry has a count
/// and total size so the UI can warn the user about stranded storage and
/// offer a one-click migration.
///
/// The scan is intentionally broad:
///
/// 1. Every bundle id in [`KNOWN_BUNDLE_IDS`] is checked first (the cheap
///    fast-path).
/// 2. Additionally, *any* sibling subdirectory of the platform app-support
///    root whose name contains "loudio" is checked, so we catch cases where
///    a developer ran a local build under a custom bundle id.
///
/// The current app's data dir is excluded via canonical-path comparison so
/// the running binary never lists itself as a "legacy" dir.
pub fn list_legacy_recording_dirs(
    app: &tauri::AppHandle,
) -> Result<Vec<LegacyRecordingDir>, String> {
    let Some(support_root) = platform_app_support_root() else {
        return Ok(Vec::new());
    };
    if !support_root.is_dir() {
        return Ok(Vec::new());
    }

    let current_output = recordings_output_dir(app)
        .map_err(|e| e.to_string())?
        .canonicalize()
        .ok();

    // Collect candidate subdir names: known ids + any "loudio"-named subdir
    // that we discover on disk.
    let mut candidate_names: std::collections::BTreeSet<String> =
        KNOWN_BUNDLE_IDS.iter().map(|s| s.to_string()).collect();

    if let Ok(entries) = fs::read_dir(&support_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let lower = name.to_ascii_lowercase();
            if LOUDIO_DIR_HINTS.iter().any(|hint| lower.contains(hint)) {
                candidate_names.insert(name.to_string());
            }
        }
    }

    let mut out: Vec<LegacyRecordingDir> = Vec::new();
    for candidate_name in candidate_names {
        let candidate = support_root
            .join(&candidate_name)
            .join("runtime")
            .join("output");
        if !candidate.is_dir() {
            continue;
        }
        // Skip the *current* app's dir; we only want legacy / orphaned dirs.
        let canonical_candidate = candidate.canonicalize().ok();
        if let (Some(cur), Some(cand)) = (&current_output, &canonical_candidate) {
            if cur == cand {
                continue;
            }
        }

        let (file_count, size_bytes) = scan_dir_stats(&candidate);
        if file_count == 0 {
            continue;
        }
        out.push(LegacyRecordingDir {
            bundle_id: candidate_name,
            absolute_path: candidate.to_string_lossy().to_string(),
            file_count,
            size_bytes,
        });
    }

    Ok(out)
}

/// Returns the current app's recordings output dir as a plain string. Useful
/// for surfacing the actual path the running Tauri binary is using, so users
/// (and our diagnostics) can see exactly where microphone files are being
/// written and read from.
pub fn current_recordings_output_dir(app: &tauri::AppHandle) -> Result<String, String> {
    let dir = recordings_output_dir(app).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// Opens the recordings output dir in the platform file manager. On macOS
/// this uses `open` which reveals the folder in Finder; on Linux it uses
/// `xdg-open`; on Windows it uses `explorer`. Used by the History view's
/// "Show in Finder" action so users can verify where their files actually
/// live.
pub fn reveal_recordings_output_dir(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = recordings_output_dir(app).map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to ensure recordings directory exists: {e}"))?;

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
            .map_err(|e| format!("Failed to open file manager: {e}"))?;
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
        return Err("Reveal in file manager is not supported on this platform.".into());
    }

    Ok(())
}

/// Walks a directory and returns `(mic_file_count, total_bytes)` for files that
/// pass [`is_mic_recording_file`].
fn scan_dir_stats(dir: &std::path::Path) -> (usize, u64) {
    let Ok(read_dir) = fs::read_dir(dir) else {
        return (0, 0);
    };
    let mut count = 0usize;
    let mut bytes = 0u64;
    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_file() || !is_mic_recording_file(&path) {
            continue;
        }
        if let Ok(meta) = fs::metadata(&path) {
            count += 1;
            bytes = bytes.saturating_add(meta.len());
        }
    }
    (count, bytes)
}

/// Moves microphone recordings from every legacy output dir into the current
/// app's output dir. Files are physically relocated (not copied) and any
/// per-recording duplicates (`.webm` + `.wav` of the same `<uuid>`) are moved
/// as a pair so the history view continues to dedupe correctly.
///
/// Migration is idempotent and conflict-safe:
/// * If a target file already exists with the same name, the legacy file is
///   skipped (we never overwrite) and the skip count is bumped.
/// * On any per-file I/O error we record the error message and keep going.
pub fn migrate_legacy_recordings(app: &tauri::AppHandle) -> Result<LegacyMigrationResult, String> {
    let target_dir = recordings_output_dir(app).map_err(|e| e.to_string())?;
    let legacy_dirs = list_legacy_recording_dirs(app)?;

    let mut result = LegacyMigrationResult {
        migrated_files: 0,
        migrated_bytes: 0,
        skipped_files: 0,
        sources: Vec::new(),
        errors: Vec::new(),
    };

    if legacy_dirs.is_empty() {
        return Ok(result);
    }

    for legacy in legacy_dirs {
        result.sources.push(legacy.absolute_path.clone());
        let legacy_path = PathBuf::from(&legacy.absolute_path);

        let entries = match fs::read_dir(&legacy_path) {
            Ok(entries) => entries,
            Err(err) => {
                result
                    .errors
                    .push(format!("{}: read_dir failed: {err}", legacy.bundle_id));
                continue;
            }
        };

        for entry in entries.flatten() {
            let src = entry.path();
            if !src.is_file() || !is_mic_recording_file(&src) {
                continue;
            }
            let Some(file_name) = src.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let dest = target_dir.join(file_name);

            if dest.exists() {
                // Already migrated in a previous run; skip but count it.
                result.skipped_files += 1;
                continue;
            }

            let size = fs::metadata(&src).map(|m| m.len()).unwrap_or(0);
            match fs::rename(&src, &dest) {
                Ok(()) => {
                    result.migrated_files += 1;
                    result.migrated_bytes = result.migrated_bytes.saturating_add(size);
                }
                Err(err) => {
                    // Fallback for cross-device moves: copy then remove.
                    match fs::copy(&src, &dest) {
                        Ok(_) => match fs::remove_file(&src) {
                            Ok(()) => {
                                result.migrated_files += 1;
                                result.migrated_bytes = result.migrated_bytes.saturating_add(size);
                            }
                            Err(remove_err) => result.errors.push(format!(
                                "{}: copied but failed to remove source {}: {remove_err}",
                                legacy.bundle_id, file_name
                            )),
                        },
                        Err(copy_err) => result.errors.push(format!(
                            "{}: failed to move {}: {err} (copy fallback: {copy_err})",
                            legacy.bundle_id, file_name
                        )),
                    }
                }
            }
        }
    }

    Ok(result)
}
