//! Version discovery and stable-update comparison for the external tools
//! Loudio depends on (whisper.cpp, FFmpeg, Python, OpenAI Whisper).
//!
//! Everything here is a pure function over command output so it can be tested
//! from any host — the tools themselves are only present on a configured
//! machine, and the macOS paths cannot be exercised on Linux at all.

use std::cmp::Ordering;

/// Tokens that mark a build as a pre-release. An update is only ever offered
/// when the candidate is stable, so these are filtered out entirely.
const PRERELEASE_MARKERS: [&str; 9] = [
    "alpha", "beta", "rc", "pre", "dev", "edge", "snapshot", "nightly", "test",
];

/// `whisper.cpp version: 1.9.2` -> `1.9.2`
pub fn parse_whisper_cpp_version(output: &str) -> Option<String> {
    output
        .lines()
        .find_map(|line| line.split("version:").nth(1))
        .map(|rest| rest.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// `Python 3.12.3` -> `3.12.3`
pub fn parse_python_version(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|token| token.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(str::to_string)
}

/// The `Version:` field of `pip show <package>`.
pub fn parse_pip_show_version(output: &str) -> Option<String> {
    output
        .lines()
        .find_map(|line| line.strip_prefix("Version:"))
        .map(|rest| rest.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// The `latest/stable:` row of `snap info <snap>`.
///
/// Deliberately reads only the stable row. The beta and edge rows regularly
/// carry a higher version, and following them is exactly what must not happen.
/// A row of `^` means "same as the channel above" and carries no version.
pub fn parse_snap_stable_version(output: &str) -> Option<String> {
    output
        .lines()
        .find_map(|line| line.trim().strip_prefix("latest/stable:"))
        .map(str::trim)
        .and_then(|rest| rest.split_whitespace().next())
        .filter(|value| *value != "^" && *value != "--")
        .map(str::to_string)
}

/// The `Candidate:` field of `apt-cache policy <pkg>`.
pub fn parse_apt_candidate(output: &str) -> Option<String> {
    output
        .lines()
        .find_map(|line| line.trim().strip_prefix("Candidate:"))
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "(none)")
        .map(str::to_string)
}

/// `versions.stable` from `brew info --json=v2 <formula>`.
pub fn parse_brew_stable_version(json: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(json).ok()?;
    parsed
        .get("formulae")?
        .as_array()?
        .first()?
        .get("versions")?
        .get("stable")?
        .as_str()
        .map(str::to_string)
}

/// Strips a Debian epoch and keeps the leading dotted-numeric core, so
/// `7:6.1.1-3ubuntu5` and `1.8.4+pkg-368f` both reduce to comparable numbers.
fn numeric_core(version: &str) -> Vec<u64> {
    let without_epoch = version.split_once(':').map_or(version, |(_, rest)| rest);

    without_epoch
        .split(|c: char| !c.is_ascii_digit() && c != '.')
        .next()
        .unwrap_or("")
        .split('.')
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

/// True when the version carries no pre-release marker.
pub fn is_stable(version: &str) -> bool {
    !version
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .any(|token| {
            let lowered = token.to_ascii_lowercase();
            PRERELEASE_MARKERS
                .iter()
                .any(|marker| lowered.starts_with(marker))
        })
}

/// Orders two versions by their numeric core. Shorter cores are zero-extended,
/// so `1.9` and `1.9.0` compare equal.
pub fn compare_versions(left: &str, right: &str) -> Ordering {
    let (a, b) = (numeric_core(left), numeric_core(right));
    let width = a.len().max(b.len());

    for index in 0..width {
        let l = a.get(index).copied().unwrap_or(0);
        let r = b.get(index).copied().unwrap_or(0);
        match l.cmp(&r) {
            Ordering::Equal => continue,
            other => return other,
        }
    }

    Ordering::Equal
}

/// Whether `candidate` is a stable release strictly newer than `current`.
///
/// Returns false for equal versions, for pre-release candidates, and for
/// anything older. That last case is not hypothetical: a snap installed from
/// beta can sit ahead of its own stable channel, and offering "1.8.4" to a
/// machine running 1.9.2 would be a silent downgrade.
pub fn stable_update_available(current: &str, candidate: &str) -> bool {
    if !is_stable(candidate) {
        return false;
    }

    compare_versions(candidate, current) == Ordering::Greater
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verbatim output from a configured Ubuntu machine.
    const SNAP_INFO: &str = "\
channels:
  latest/stable:    1.8.4+pkg-368f 2026-03-31  (985) 30.1MB -
  latest/candidate: ^
  latest/beta:      1.9.2+pkg-6f96 2026-08-06  (996) 31.2MB -
  latest/edge:      1.9.3+pkg-6f96 2026-08-23 (1014) 31.9MB -
installed:          1.9.2+pkg-6f96             (996) 31.2MB -";

    const APT_POLICY: &str = "\
ffmpeg:
  Installed: 7:6.1.1-3ubuntu5+esm10
  Candidate: 7:6.1.1-3ubuntu5+esm10
  Version table:";

    #[test]
    fn parses_tool_versions() {
        assert_eq!(
            parse_whisper_cpp_version("whisper.cpp version: 1.9.2").as_deref(),
            Some("1.9.2")
        );
        assert_eq!(
            parse_python_version("Python 3.12.3").as_deref(),
            Some("3.12.3")
        );
        assert_eq!(
            parse_pip_show_version("Name: openai-whisper\nVersion: 20250625\n").as_deref(),
            Some("20250625")
        );
    }

    #[test]
    fn reads_only_the_stable_snap_channel() {
        // Not the 1.9.2 beta and not the 1.9.3 edge sitting above it.
        assert_eq!(
            parse_snap_stable_version(SNAP_INFO).as_deref(),
            Some("1.8.4+pkg-368f")
        );
    }

    #[test]
    fn parses_apt_candidate_and_brew_stable() {
        assert_eq!(
            parse_apt_candidate(APT_POLICY).as_deref(),
            Some("7:6.1.1-3ubuntu5+esm10")
        );
        let brew = r#"{"formulae":[{"versions":{"stable":"1.9.2","head":"HEAD"}}]}"#;
        assert_eq!(parse_brew_stable_version(brew).as_deref(), Some("1.9.2"));
        assert_eq!(parse_apt_candidate("  Candidate: (none)"), None);
    }

    #[test]
    fn never_offers_a_downgrade() {
        // The real case on this machine: installed from beta, ahead of stable.
        let installed = "1.9.2";
        let stable = parse_snap_stable_version(SNAP_INFO).unwrap();
        assert!(
            !stable_update_available(installed, &stable),
            "offering {stable} to a machine on {installed} would downgrade it"
        );
    }

    #[test]
    fn offers_only_newer_stable_releases() {
        assert!(stable_update_available("1.8.4", "1.9.2"));
        assert!(stable_update_available("1.8.4+pkg-368f", "1.9.0+pkg-abcd"));
        assert!(!stable_update_available("1.9.2", "1.9.2"));
        assert!(!stable_update_available("1.9.2", "1.9.2+pkg-6f96"));
        // Pre-release candidates are never offered, even when newer.
        assert!(!stable_update_available("1.8.4", "1.9.3-beta.1"));
        assert!(!stable_update_available("1.8.4", "2.0.0-rc.1"));
        assert!(!stable_update_available("1.8.4", "1.9.9-edge"));
    }

    #[test]
    fn identifies_prerelease_markers_without_false_positives() {
        assert!(is_stable("1.9.2"));
        assert!(is_stable("1.8.4+pkg-368f"));
        assert!(
            is_stable("7:6.1.1-3ubuntu5+esm10"),
            "esm is not a prerelease"
        );
        assert!(is_stable("20250625"));
        assert!(!is_stable("1.0.0-rc.1"));
        assert!(!is_stable("1.0.0-beta1"));
        assert!(!is_stable("2.1-nightly"));
    }

    #[test]
    fn compares_across_packaging_formats() {
        assert_eq!(compare_versions("1.9", "1.9.0"), Ordering::Equal);
        assert_eq!(compare_versions("1.10.0", "1.9.0"), Ordering::Greater);
        assert_eq!(
            compare_versions("7:6.1.1-3ubuntu5", "6.1.1"),
            Ordering::Equal
        );
        assert_eq!(
            compare_versions("1.8.4+pkg-368f", "1.9.2+pkg-6f96"),
            Ordering::Less
        );
    }
}

#[cfg(test)]
mod machine_cases {
    use super::*;

    /// The exact values read from a configured Ubuntu machine, so the decision
    /// this build would make is asserted rather than assumed.
    #[test]
    fn matches_this_machines_state() {
        // whisper.cpp: installed from beta, sits ahead of the stable channel.
        assert!(!stable_update_available("1.9.2", "1.8.4+pkg-368f"));

        // FFmpeg: apt candidate equals what is installed, so nothing to offer.
        assert!(!stable_update_available(
            "6.1.1-3ubuntu5+esm10",
            "7:6.1.1-3ubuntu5+esm10"
        ));

        // And the case that must still fire once stable catches up.
        assert!(stable_update_available("1.8.4+pkg-368f", "1.9.4+pkg-aaaa"));
    }
}
