//! How this copy of Loudio was installed.
//!
//! The store packages bundle FFmpeg and whisper.cpp, while the `.deb` and
//! `.dmg` expect them on the system and offer the readiness wizard to install
//! them. Both behaviours are correct for their package, but a bug report cannot
//! be read without knowing which one is running — so the flavour is surfaced in
//! the UI rather than inferred.
//!
//! It also decides whether the wizard may act at all: inside a sandbox there is
//! no `apt`, `brew` or `snap` to call, so offering an install button would only
//! produce a confusing failure.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstallFlavor {
    /// Installed as a snap. `SNAP` points at the mounted revision.
    Snap,
    /// Installed as a Flatpak. `FLATPAK_ID` carries the application id.
    Flatpak,
    /// A `.deb`, a `.dmg`, or a development build.
    Native,
}

impl InstallFlavor {
    /// Whether the transcription engines ship inside the package.
    pub fn engines_are_bundled(self) -> bool {
        matches!(self, InstallFlavor::Snap | InstallFlavor::Flatpak)
    }

    pub fn label(self) -> &'static str {
        match self {
            InstallFlavor::Snap => "Snap",
            InstallFlavor::Flatpak => "Flatpak",
            InstallFlavor::Native => "System",
        }
    }
}

/// Classifies an install from the environment variables its runtime sets.
///
/// Split from [`detect`] so the mapping can be tested without touching the
/// real process environment.
pub fn classify(snap: Option<&str>, flatpak_id: Option<&str>) -> InstallFlavor {
    // Flatpak first: `FLATPAK_ID` is only ever set by the Flatpak runtime,
    // whereas `SNAP` is occasionally exported by unrelated tooling.
    if flatpak_id.is_some_and(|value| !value.is_empty()) {
        return InstallFlavor::Flatpak;
    }
    if snap.is_some_and(|value| !value.is_empty()) {
        return InstallFlavor::Snap;
    }
    InstallFlavor::Native
}

pub fn detect() -> InstallFlavor {
    let snap = std::env::var("SNAP").ok();
    let flatpak = std::env::var("FLATPAK_ID").ok();
    classify(snap.as_deref(), flatpak.as_deref())
}

/// Where a bundled engine binary lives, for the given flavour and package root.
///
/// Split from [`bundled_binary_candidates`] so the path shapes can be tested
/// without a snap or Flatpak to run inside.
pub fn bundled_paths_for(flavor: InstallFlavor, root: Option<&str>, name: &str) -> Vec<String> {
    match flavor {
        // $SNAP is the mounted revision. Parts stage into usr/bin or bin
        // depending on whether they came from the archive or were built.
        InstallFlavor::Snap => match root {
            Some(root) if !root.is_empty() => vec![
                format!("{root}/usr/bin/{name}"),
                format!("{root}/bin/{name}"),
            ],
            _ => Vec::new(),
        },
        // /app is the Flatpak prefix; /usr is the runtime, which is where the
        // GNOME platform's own ffmpeg lives.
        InstallFlavor::Flatpak => vec![
            format!("/app/bin/{name}"),
            format!("/usr/bin/{name}"),
        ],
        InstallFlavor::Native => Vec::new(),
    }
}

/// Bundled locations to try before anything on the host.
///
/// Inside a sandbox a host binary is usually unreachable anyway, so preferring
/// the bundled copy avoids detecting something that cannot then be executed.
pub fn bundled_binary_candidates(name: &str) -> Vec<String> {
    let flavor = detect();
    let root = std::env::var("SNAP").ok();
    bundled_paths_for(flavor, root.as_deref(), name)
}

/// What the UI shows about this install.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    pub flavor: InstallFlavor,
    pub label: String,
    pub engines_are_bundled: bool,
}

#[tauri::command]
pub fn get_install_info() -> InstallInfo {
    let flavor = detect();
    InstallInfo {
        flavor,
        label: flavor.label().to_string(),
        engines_are_bundled: flavor.engines_are_bundled(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bare_environment_is_a_native_install() {
        assert_eq!(classify(None, None), InstallFlavor::Native);
    }

    #[test]
    fn snap_is_detected_from_its_mount_point() {
        assert_eq!(classify(Some("/snap/loudio/42"), None), InstallFlavor::Snap);
    }

    #[test]
    fn flatpak_is_detected_from_its_app_id() {
        assert_eq!(
            classify(None, Some("io.github.sudsarkar13.loudio")),
            InstallFlavor::Flatpak
        );
    }

    #[test]
    fn flatpak_wins_when_both_are_set() {
        // Some tooling exports SNAP without the app being a snap; FLATPAK_ID
        // is set only by the Flatpak runtime, so it is the stronger signal.
        assert_eq!(
            classify(Some("/snap/something/1"), Some("io.github.sudsarkar13.loudio")),
            InstallFlavor::Flatpak
        );
    }

    #[test]
    fn empty_values_do_not_count_as_set() {
        assert_eq!(classify(Some(""), Some("")), InstallFlavor::Native);
    }

    #[test]
    fn a_native_install_has_no_bundled_paths_to_try() {
        assert!(bundled_paths_for(InstallFlavor::Native, None, "ffmpeg").is_empty());
        // Even if SNAP leaked into the environment of a native build.
        assert!(bundled_paths_for(InstallFlavor::Native, Some("/snap/x/1"), "ffmpeg").is_empty());
    }

    #[test]
    fn snap_paths_are_rooted_at_the_mounted_revision() {
        assert_eq!(
            bundled_paths_for(InstallFlavor::Snap, Some("/snap/loudio/42"), "whisper-cli"),
            vec![
                "/snap/loudio/42/usr/bin/whisper-cli".to_string(),
                "/snap/loudio/42/bin/whisper-cli".to_string(),
            ]
        );
    }

    #[test]
    fn a_snap_without_a_root_offers_nothing_rather_than_a_bare_path() {
        // Guards against building "/usr/bin/ffmpeg" and reaching outside the snap.
        assert!(bundled_paths_for(InstallFlavor::Snap, None, "ffmpeg").is_empty());
        assert!(bundled_paths_for(InstallFlavor::Snap, Some(""), "ffmpeg").is_empty());
    }

    #[test]
    fn flatpak_prefers_the_app_prefix_then_the_runtime() {
        assert_eq!(
            bundled_paths_for(InstallFlavor::Flatpak, None, "ffmpeg"),
            vec!["/app/bin/ffmpeg".to_string(), "/usr/bin/ffmpeg".to_string()]
        );
    }

    #[test]
    fn only_sandboxed_packages_bundle_the_engines() {
        assert!(InstallFlavor::Snap.engines_are_bundled());
        assert!(InstallFlavor::Flatpak.engines_are_bundled());
        assert!(!InstallFlavor::Native.engines_are_bundled());
    }
}
