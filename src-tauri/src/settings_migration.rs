//! Carries `settings.json` across bundle identifier changes.
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

use std::{fs, path::PathBuf, time::SystemTime};

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
    fn no_candidates_means_nothing_to_adopt() {
        assert_eq!(pick_legacy_settings(&[]), None);
    }

    #[test]
    fn finds_a_previous_bundle_ids_settings_under_the_data_root() {
        let root = std::env::temp_dir().join(format!("loudio-root-{}", std::process::id()));
        let legacy = root.join("com.loudio.app");
        let current = root.join("io.github.sudsarkar13.loudio");
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&current).unwrap();
        write(&legacy, "settings.json", &valid_settings("en"));

        std::env::set_var("XDG_DATA_HOME", &root);
        let found = legacy_settings_candidates(&current);
        std::env::remove_var("XDG_DATA_HOME");

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
