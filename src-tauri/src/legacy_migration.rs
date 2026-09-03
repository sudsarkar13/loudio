//! Carries a previous bundle identifier's data forward.
//!
//! Tauri derives the per-user data directory from the bundle identifier, so
//! renaming it moves that directory and the app starts from an empty state.
//! [`crate::recordings`] already migrates microphone captures across the ids
//! Loudio has shipped under; this does the same for settings.
//!
//! It matters more than it used to. Since v1.0.3 `settings.json` holds the
//! custom vocabulary and the learned-corrections dictionary, so losing it
//! discards everything the user has taught the app — silently, because an empty
//! settings file looks exactly like a first run.

use std::{
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use crate::{
    models::AppSettings,
    paths::settings_path,
    recordings::{platform_app_support_root, KNOWN_BUNDLE_IDS, LOUDIO_DIR_HINTS},
};

/// Picks the settings file to adopt from a set of candidates.
///
/// Newest wins, and only files that actually parse are considered: a truncated
/// or hand-edited file from an old install must not replace a clean first run
/// with a broken one.
pub fn pick_legacy_settings(candidates: &[PathBuf]) -> Option<PathBuf> {
    let mut best: Option<(SystemTime, PathBuf)> = None;

    for candidate in candidates {
        let Ok(raw) = fs::read_to_string(candidate) else {
            continue;
        };
        if serde_json::from_str::<AppSettings>(&raw).is_err() {
            continue;
        }
        let Ok(modified) = fs::metadata(candidate).and_then(|meta| meta.modified()) else {
            continue;
        };

        match &best {
            Some((best_time, _)) if *best_time >= modified => {}
            _ => best = Some((modified, candidate.clone())),
        }
    }

    best.map(|(_, path)| path)
}

/// Every `settings.json` belonging to a bundle id that is not the current one.
fn legacy_settings_candidates(current_dir: &PathBuf) -> Vec<PathBuf> {
    let Some(support_root) = platform_app_support_root() else {
        return Vec::new();
    };
    if !support_root.is_dir() {
        return Vec::new();
    }

    let current = current_dir.canonicalize().ok();

    let mut names: std::collections::BTreeSet<String> =
        KNOWN_BUNDLE_IDS.iter().map(|id| id.to_string()).collect();

    // Also sweep for any Loudio-looking directory, so an id we have not listed
    // yet (a fork, or the next rename) still gets found.
    if let Ok(entries) = fs::read_dir(&support_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
                let lower = name.to_ascii_lowercase();
                if LOUDIO_DIR_HINTS.iter().any(|hint| lower.contains(hint)) {
                    names.insert(name.to_string());
                }
            }
        }
    }

    let mut out = Vec::new();
    for name in names {
        let dir = support_root.join(&name);
        if let (Some(current), Some(candidate)) = (&current, &dir.canonicalize().ok()) {
            if current == candidate {
                continue;
            }
        }
        let file = dir.join("settings.json");
        if file.is_file() {
            out.push(file);
        }
    }
    out
}

/// Adopts a previous install's settings when the current id has none.
///
/// Only ever runs into an empty slot — an existing `settings.json` is never
/// overwritten, so this cannot clobber real state if a stale directory is left
/// behind. Returns the file it copied from, for logging.
pub fn adopt_legacy_settings(app: &tauri::AppHandle) -> Option<PathBuf> {
    let target = settings_path(app).ok()?;
    if target.exists() {
        return None;
    }

    let current_dir = target.parent()?.to_path_buf();
    let source = pick_legacy_settings(&legacy_settings_candidates(&current_dir))?;

    fs::copy(&source, &target).ok()?;
    Some(source)
}

/// Whether a `runtime` directory holds anything worth keeping.
///
/// "Effectively empty" means no Python environment and no downloaded models —
/// i.e. only the empty scaffolding [`crate::paths::runtime_dir`] creates on
/// first use. Such a directory can be replaced; anything else must not be.
pub fn runtime_dir_is_disposable(runtime: &Path) -> bool {
    if !runtime.exists() {
        return true;
    }
    if runtime.join("python-venv").is_dir() {
        return false;
    }
    for sub in ["models", "output"] {
        let dir = runtime.join(sub);
        if let Ok(entries) = fs::read_dir(&dir) {
            if entries.flatten().any(|entry| {
                entry.path().is_file() || entry.path().is_dir()
            }) {
                return false;
            }
        }
    }
    true
}

/// Moves a previous bundle id's `runtime` directory to the current one.
///
/// Moved rather than copied, deliberately. This directory holds the Python
/// environment and the downloaded Whisper models — on a real install that is
/// several gigabytes, so copying would double it on disk for no benefit. A
/// rename within the same data root is instant and costs nothing.
///
/// Without this a rename would report the engines as missing and offer to
/// rebuild the environment and re-download every model, even though both are
/// sitting on disk under the old id.
///
/// Returns the directory it moved from.
pub fn adopt_legacy_runtime(app: &tauri::AppHandle) -> Option<PathBuf> {
    let data_dir = crate::paths::app_data_dir(app).ok()?;
    let target = data_dir.join("runtime");

    // Never replace a runtime that already holds real state.
    if !runtime_dir_is_disposable(&target) {
        return None;
    }

    let support_root = platform_app_support_root()?;
    let current = data_dir.canonicalize().ok();

    let mut names: std::collections::BTreeSet<String> =
        KNOWN_BUNDLE_IDS.iter().map(|id| id.to_string()).collect();
    if let Ok(entries) = fs::read_dir(&support_root) {
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            if let Some(name) = entry.path().file_name().and_then(|v| v.to_str()) {
                if LOUDIO_DIR_HINTS
                    .iter()
                    .any(|hint| name.to_ascii_lowercase().contains(hint))
                {
                    names.insert(name.to_string());
                }
            }
        }
    }

    for name in names {
        let dir = support_root.join(&name);
        if let (Some(current), Some(candidate)) = (&current, &dir.canonicalize().ok()) {
            if current == candidate {
                continue;
            }
        }
        let source = dir.join("runtime");
        if !source.is_dir() || runtime_dir_is_disposable(&source) {
            continue;
        }

        // The empty scaffolding, if any, has to go before a rename can land.
        if target.exists() && fs::remove_dir_all(&target).is_err() {
            continue;
        }
        match fs::rename(&source, &target) {
            Ok(()) => return Some(source),
            Err(error) => {
                // Most likely a cross-device link. Leave the old directory
                // alone rather than starting a multi-gigabyte copy.
                eprintln!(
                    "Could not move {} into place ({error}); leaving it where it is.",
                    source.display()
                );
                return None;
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write(dir: &std::path::Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(body.as_bytes()).unwrap();
        path
    }

    fn valid_settings(language: &str) -> String {
        format!(
            r#"{{"profileId":"balanced","customModel":null,"language":"{language}",
               "task":"transcribe","autoCopy":false,"temperature":0.0,"beamSize":5,
               "manualEnginePath":null}}"#
        )
    }

    #[test]
    fn ignores_files_that_do_not_parse() {
        let dir = std::env::temp_dir().join(format!("loudio-sm-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let broken = write(&dir, "broken.json", "{ not json");

        assert_eq!(pick_legacy_settings(&[broken]), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn prefers_the_most_recently_modified_valid_file() {
        let dir = std::env::temp_dir().join(format!("loudio-sm2-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();

        let older = write(&dir, "older.json", &valid_settings("en"));
        std::thread::sleep(std::time::Duration::from_millis(20));
        let newer = write(&dir, "newer.json", &valid_settings("fr"));

        let picked = pick_legacy_settings(&[older.clone(), newer.clone()]);
        assert_eq!(picked, Some(newer));

        // Order of the candidate list must not matter.
        let picked = pick_legacy_settings(&[
            write(&dir, "newer.json", &valid_settings("fr")),
            older,
        ]);
        assert!(picked.is_some());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_settings_file_from_before_the_vocabulary_fields_still_parses() {
        // v1.0.2 and earlier had no customVocabulary or learnedTerms. Those
        // carry serde defaults, so an old file must still be adoptable.
        let dir = std::env::temp_dir().join(format!("loudio-sm3-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let old = write(&dir, "old.json", &valid_settings("en"));

        assert_eq!(pick_legacy_settings(&[old.clone()]), Some(old));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_absent_or_scaffold_only_runtime_is_disposable() {
        let root = std::env::temp_dir().join(format!("loudio-rt-{}", std::process::id()));
        let runtime = root.join("runtime");
        assert!(runtime_dir_is_disposable(&runtime), "absent should be disposable");

        // What runtime_dir() creates on first use, and nothing more.
        fs::create_dir_all(runtime.join("models")).unwrap();
        fs::create_dir_all(runtime.join("output")).unwrap();
        assert!(runtime_dir_is_disposable(&runtime), "empty scaffolding");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_runtime_holding_models_or_a_venv_is_never_disposable() {
        let root = std::env::temp_dir().join(format!("loudio-rt2-{}", std::process::id()));
        let runtime = root.join("runtime");
        fs::create_dir_all(runtime.join("models")).unwrap();
        write(&runtime.join("models"), "ggml-small.bin", "not really a model");
        assert!(!runtime_dir_is_disposable(&runtime), "a downloaded model counts");

        fs::remove_dir_all(&root).ok();

        let runtime = root.join("runtime");
        fs::create_dir_all(runtime.join("python-venv").join("bin")).unwrap();
        assert!(!runtime_dir_is_disposable(&runtime), "a venv counts");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn no_candidates_means_nothing_to_adopt() {
        assert_eq!(pick_legacy_settings(&[]), None);
    }

    /// The fixture has to mirror whatever `platform_app_support_root` actually
    /// reads, which differs by platform: `XDG_DATA_HOME` on Linux, but
    /// `$HOME/Library/Application Support` on macOS.
    ///
    /// Pointing only `XDG_DATA_HOME` at the temp root left macOS scanning the
    /// developer's real Application Support directory, so the test asserted
    /// against whichever Loudio bundle ids happened to exist on that machine —
    /// green on CI, and failing on any Mac that had ever run the app.
    #[test]
    fn finds_a_previous_bundle_ids_settings_under_the_data_root() {
        let root = std::env::temp_dir().join(format!("loudio-root-{}", std::process::id()));
        let support_root = if cfg!(target_os = "macos") {
            root.join("Library").join("Application Support")
        } else {
            root.clone()
        };

        let legacy = support_root.join("com.loudio.app");
        let current = support_root.join("io.github.sudsarkar13.loudio");
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&current).unwrap();
        write(&legacy, "settings.json", &valid_settings("en"));

        // Both are set regardless of platform so the redirect holds whichever
        // branch `platform_app_support_root` takes, and both are restored: these
        // are process-wide, and the rest of the suite runs in parallel.
        let previous_home = std::env::var_os("HOME");
        let previous_xdg = std::env::var_os("XDG_DATA_HOME");
        std::env::set_var("HOME", &root);
        std::env::set_var("XDG_DATA_HOME", &support_root);

        let found = legacy_settings_candidates(&current);

        match previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        match previous_xdg {
            Some(value) => std::env::set_var("XDG_DATA_HOME", value),
            None => std::env::remove_var("XDG_DATA_HOME"),
        }

        assert_eq!(found, vec![legacy.join("settings.json")]);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn the_real_world_settings_shape_parses() {
        let raw = r#"{"profileId":"balanced","customModel":null,"language":"en",
            "task":"transcribe","autoCopy":true,"temperature":0.0,"beamSize":5,
            "manualEnginePath":null,"customVocabulary":"Supabase\nFlatpak",
            "learnedTerms":[{"heard":"super base","intended":"Supabase","hits":3}]}"#;
        let parsed = serde_json::from_str::<AppSettings>(raw);
        assert!(parsed.is_ok(), "should parse: {parsed:?}");
    }
}
