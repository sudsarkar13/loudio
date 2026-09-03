use anyhow::{anyhow, Context, Result};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

use crate::{
    paths::runtime_dir,
    process::{command_available, run_command},
};

pub async fn detect_brew_bin() -> Option<String> {
    if command_available("brew", &["--version"]).await {
        return Some("brew".to_string());
    }

    for candidate in ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"] {
        if command_available(candidate, &["--version"]).await {
            return Some(candidate.to_string());
        }
    }

    None
}

pub async fn ensure_homebrew_available() -> Result<String> {
    if let Some(brew_bin) = detect_brew_bin().await {
        return Ok(brew_bin);
    }

    if !cfg!(target_os = "macos") {
        return Err(anyhow!(
            "Automatic Homebrew installation is only supported on macOS"
        ));
    }

    if !command_available("curl", &["--version"]).await {
        return Err(anyhow!(
            "curl is required to install Homebrew automatically"
        ));
    }

    let install_script =
        "NONINTERACTIVE=1 CI=1 /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"";

    run_command("/bin/bash", &["-c".into(), install_script.into()])
        .await
        .context("Failed to run Homebrew installer")?;

    detect_brew_bin()
        .await
        .ok_or_else(|| anyhow!("Homebrew installer finished but brew is still not discoverable"))
}

pub async fn detect_ffmpeg_bin() -> Option<String> {
    // Bundled copies first: inside a snap or Flatpak the host's ffmpeg is not
    // reachable, so detecting it would only produce a failure at run time.
    for candidate in crate::install_flavor::bundled_binary_candidates("ffmpeg") {
        if command_available(&candidate, &["-version"]).await {
            return Some(candidate);
        }
    }

    if command_available("ffmpeg", &["-version"]).await {
        return Some("ffmpeg".to_string());
    }

    if let Ok(path) = env::var("LOUDIO_FFMPEG_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() && command_available(trimmed, &["-version"]).await {
            return Some(trimmed.to_string());
        }
    }

    let candidates = [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ];

    for candidate in candidates {
        if command_available(candidate, &["-version"]).await {
            return Some(candidate.to_string());
        }
    }

    None
}

/// Normalises any captured audio into the 16 kHz mono PCM wav that both whisper
/// engines expect.
///
/// `output_path` is always distinct from `input_path` — the Linux capture path
/// already produces a wav (at the AudioContext's native rate, typically 44.1
/// kHz), so deriving the destination from the input extension would make ffmpeg
/// read and write the same file.
pub async fn convert_audio_to_wav_16k(input_path: &Path, output_path: &Path) -> Result<()> {
    let ffmpeg_bin = detect_ffmpeg_bin()
        .await
        .ok_or_else(|| anyhow!("ffmpeg not found in PATH or common install locations"))?;

    run_command(
        &ffmpeg_bin,
        &[
            "-y".into(),
            "-i".into(),
            input_path.to_string_lossy().to_string(),
            "-ar".into(),
            "16000".into(),
            "-ac".into(),
            "1".into(),
            "-c:a".into(),
            "pcm_s16le".into(),
            output_path.to_string_lossy().to_string(),
        ],
    )
    .await
    .with_context(|| {
        format!("Failed to convert microphone audio to 16 kHz wav with ffmpeg at {ffmpeg_bin}")
    })?;

    Ok(())
}

/// Resolves a command name to an absolute path by scanning `PATH`, so callers
/// can inspect *where* a binary actually lives rather than just whether it runs.
pub fn resolve_binary_path(bin: &str) -> Option<PathBuf> {
    if bin.contains('/') {
        let candidate = PathBuf::from(bin);
        return candidate.exists().then_some(candidate);
    }

    env::split_paths(&env::var_os("PATH")?)
        .map(|dir| dir.join(bin))
        .find(|path| path.exists())
}

/// Snap-packaged binaries run under AppArmor confinement. The `home` interface
/// deliberately excludes dot-directories, so a snap engine cannot read anything
/// under Loudio's data dir (`~/.local/share/<bundle-id>/…`) even though the
/// files are plainly world-readable — it reports the input as "not found".
///
/// Returns the snap name when `bin` resolves into `/snap/bin`, so callers can
/// stage engine input somewhere the snap is allowed to see.
pub fn snap_name_for(bin: &str) -> Option<String> {
    if !cfg!(target_os = "linux") {
        return None;
    }

    let resolved = resolve_binary_path(bin)?;
    if !resolved.starts_with("/snap/bin") {
        return None;
    }

    let file_name = resolved.file_name()?.to_str()?;
    if let Some((snap, _)) = file_name.split_once('.') {
        return Some(snap.to_string());
    }

    // A snap *alias* (e.g. `whisper-cli`) is a relative symlink to the canonical
    // `<snap>.<app>` entry point, which is where the snap name lives.
    let target = fs::read_link(&resolved).ok()?;
    let target_name = target.file_name()?.to_str()?;
    target_name
        .split_once('.')
        .map(|(snap, _)| snap.to_string())
}

/// A directory a snap-confined engine is always allowed to read and write.
/// `$HOME/snap/<snap>/common` belongs to the snap itself; Loudio is
/// unconfined, so it can populate it on the snap's behalf.
pub fn snap_staging_dir(snap: &str) -> Result<PathBuf> {
    let home = env::var_os("HOME").ok_or_else(|| anyhow!("HOME is not set"))?;
    let dir = PathBuf::from(home)
        .join("snap")
        .join(snap)
        .join("common")
        .join("loudio");
    fs::create_dir_all(&dir).with_context(|| {
        format!("Failed to prepare snap staging directory for {snap} at {dir:?}")
    })?;
    Ok(dir)
}

/// Exposes `source` inside `dir` under `file_name`. Hardlinks keep the ~500 MB
/// model files single-instance and instant to stage; copying is only used when
/// the two paths live on different filesystems.
pub fn stage_file(source: &Path, dir: &Path, file_name: &str) -> Result<PathBuf> {
    let dest = dir.join(file_name);
    let source_len = fs::metadata(source)
        .with_context(|| format!("Failed to inspect {}", source.display()))?
        .len();

    if let Ok(existing) = fs::metadata(&dest) {
        if existing.len() == source_len {
            return Ok(dest);
        }
        let _ = fs::remove_file(&dest);
    }

    if fs::hard_link(source, &dest).is_ok() {
        return Ok(dest);
    }

    fs::copy(source, &dest).with_context(|| {
        format!(
            "Failed to stage {} into {}",
            source.display(),
            dir.display()
        )
    })?;
    Ok(dest)
}

pub async fn detect_python_with_whisper() -> Option<String> {
    let python_candidates = [
        "python3",
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
    ];

    for candidate in python_candidates {
        if command_available(candidate, &["-m", "whisper", "--help"]).await {
            return Some(candidate.to_string());
        }
    }

    None
}

pub fn venv_python_path(venv_dir: &PathBuf) -> PathBuf {
    venv_dir.join("bin").join("python3")
}

/// Oldest Python the fallback runtime supports. Matches the readiness check, so
/// the app cannot build a venv from an interpreter it would then report as too
/// old.
const MIN_PYTHON: (u32, u32) = (3, 10);

/// Disk the fallback venv needs once torch and its dependencies are unpacked.
/// Measured at ~1.1 GB on macOS arm64; the margin covers pip's build caches and
/// the larger CUDA-enabled wheels on Linux.
const PYTHON_RUNTIME_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// Reads `major.minor machine` back from the interpreter probe below.
///
/// Split out from the spawn so the parsing is testable: a wrong answer here
/// silently picks the wrong interpreter, which is not something a running app
/// makes obvious.
fn parse_python_probe(output: &str) -> Option<(u32, u32, String)> {
    let line = output.lines().find(|line| !line.trim().is_empty())?;
    let mut parts = line.split_whitespace();

    let version = parts.next()?;
    let machine = parts.next()?.to_string();

    let (major, minor) = version.split_once('.')?;
    Some((major.parse().ok()?, minor.parse().ok()?, machine))
}

/// Whether an interpreter is new enough *and* built for the machine it will run
/// on.
///
/// The architecture half is not theoretical. A universal2 interpreter can
/// resolve x86_64 wheels on an arm64 Mac, which produces a venv whose torch
/// loads on no machine at all — `import torch` dies inside `dlopen` with a
/// linker error that says nothing about why.
fn python_is_suitable(major: u32, minor: u32, machine: &str, host_machine: &str) -> bool {
    if (major, minor) < MIN_PYTHON {
        return false;
    }
    machine.eq_ignore_ascii_case(host_machine)
}

fn host_machine() -> &'static str {
    // `std::env::consts::ARCH` uses Rust's spelling; Python's `platform.machine()`
    // uses the platform's. They agree on x86_64 but not on arm64/aarch64.
    match std::env::consts::ARCH {
        "aarch64" => {
            if cfg!(target_os = "macos") {
                "arm64"
            } else {
                "aarch64"
            }
        }
        other => other,
    }
}

/// Interpreters to consider when building the venv, best first.
///
/// Bare names alone are not enough: a packaged `.app` launched from Finder
/// inherits a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so `python3`
/// resolves to the system interpreter regardless of what the user installed.
/// That is exactly how this project's reference machine ended up building its
/// venv from a Python its own readiness check rejects as too old.
fn venv_python_candidates() -> Vec<String> {
    let prefixes = ["/opt/homebrew/bin/", "/usr/local/bin/", "/usr/bin/", ""];
    let mut candidates = Vec::new();

    // Newest first, so a machine with several installed gets the best one.
    for minor in (MIN_PYTHON.1..=15).rev() {
        for prefix in prefixes {
            candidates.push(format!("{prefix}python3.{minor}"));
        }
    }
    for prefix in prefixes {
        candidates.push(format!("{prefix}python3"));
    }

    candidates
}

/// Picks an interpreter suitable for building the fallback venv.
pub async fn resolve_venv_python() -> Option<String> {
    let host = host_machine();

    for candidate in venv_python_candidates() {
        let probe = run_command(
            &candidate,
            &[
                "-c".into(),
                "import sys,platform;print(f'{sys.version_info.major}.{sys.version_info.minor} {platform.machine()}')".into(),
            ],
        )
        .await;

        let Ok((stdout, _)) = probe else { continue };
        let Some((major, minor, machine)) = parse_python_probe(&stdout) else {
            continue;
        };

        if python_is_suitable(major, minor, &machine, host) {
            return Some(candidate);
        }
    }

    None
}

pub async fn ensure_python_whisper_runtime(app: &tauri::AppHandle) -> Result<String> {
    if let Some(system_python) = detect_python_with_whisper().await {
        return Ok(system_python);
    }

    let venv_dir = runtime_dir(app)?.join("python-venv");
    let venv_python = venv_python_path(&venv_dir);
    let venv_python_str = venv_python.to_string_lossy().to_string();

    // A working venv is the common case once the app has been set up, and this
    // runs on the transcription hot path. Re-running pip here would make every
    // fallback transcription depend on the network (and take minutes), so only
    // fall through to installation when whisper is genuinely not importable.
    if venv_python.exists()
        && command_available(&venv_python_str, &["-m", "whisper", "--help"]).await
    {
        return Ok(venv_python_str);
    }

    // openai-whisper pulls torch, which is the single largest thing Loudio ever
    // installs. Checked up front so a half-written venv cannot be what fills the
    // disk.
    crate::disk::ensure_room_for(
        &venv_dir,
        PYTHON_RUNTIME_BYTES,
        "the Python Whisper runtime (PyTorch and its dependencies)",
    )?;

    if !venv_python.exists() {
        let base_python = resolve_venv_python().await.ok_or_else(|| {
            anyhow!(
                "No suitable Python found. Loudio's Whisper fallback needs Python {}.{} or newer, \
                 built for this machine's CPU architecture.",
                MIN_PYTHON.0,
                MIN_PYTHON.1
            )
        })?;

        run_command(
            &base_python,
            &[
                "-m".into(),
                "venv".into(),
                venv_dir.to_string_lossy().to_string(),
            ],
        )
        .await
        .context(if cfg!(target_os = "linux") {
            "Failed to create app-local Python virtual environment. On Debian/Ubuntu this usually means the `python3-venv` package is missing: sudo apt-get install -y python3-venv"
        } else {
            "Failed to create app-local Python virtual environment"
        })?;
    }

    run_command(
        &venv_python.to_string_lossy(),
        &[
            "-m".into(),
            "pip".into(),
            "install".into(),
            "-U".into(),
            "pip".into(),
        ],
    )
    .await
    .context("Failed to upgrade pip in app-local virtual environment")?;

    run_command(
        &venv_python.to_string_lossy(),
        &[
            "-m".into(),
            "pip".into(),
            "install".into(),
            "-U".into(),
            "openai-whisper".into(),
        ],
    )
    .await
    .context("Failed to install openai-whisper in app-local virtual environment")?;

    let ready =
        command_available(&venv_python.to_string_lossy(), &["-m", "whisper", "--help"]).await;

    if !ready {
        return Err(anyhow!(
            "openai-whisper installation in app-local virtual environment did not succeed"
        ));
    }

    Ok(venv_python.to_string_lossy().to_string())
}

pub async fn detect_whisper_cli(manual_engine_path: Option<&str>) -> Option<String> {
    if let Some(path) = manual_engine_path {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            let ok = tokio::process::Command::new(trimmed)
                .arg("-h")
                .output()
                .await
                .is_ok_and(|o| o.status.success() || !o.stderr.is_empty());
            if ok {
                return Some(trimmed.to_string());
            }
        }
    }

    // Bundled first, for the same reason as ffmpeg above.
    for candidate in crate::install_flavor::bundled_binary_candidates("whisper-cli") {
        let ok = tokio::process::Command::new(&candidate)
            .arg("-h")
            .output()
            .await
            .is_ok_and(|o| o.status.success() || !o.stderr.is_empty());
        if ok {
            return Some(candidate);
        }
    }

    for candidate in [
        "whisper-cli",
        "whisper-cpp.cli",
        "/opt/homebrew/bin/whisper-cli",
        "/usr/local/bin/whisper-cli",
        "/snap/bin/whisper-cli",
        "/snap/bin/whisper-cpp.cli",
    ] {
        let ok = tokio::process::Command::new(candidate)
            .arg("-h")
            .output()
            .await
            .is_ok_and(|o| o.status.success() || !o.stderr.is_empty());
        if ok {
            return Some(candidate.to_string());
        }
    }

    None
}

#[cfg(test)]
mod python_selection_tests {
    use super::{parse_python_probe, python_is_suitable};

    #[test]
    fn reads_version_and_machine_from_the_probe() {
        assert_eq!(
            parse_python_probe("3.12 arm64\n"),
            Some((3, 12, "arm64".to_string()))
        );
        assert_eq!(
            parse_python_probe("3.10 x86_64"),
            Some((3, 10, "x86_64".to_string()))
        );
    }

    #[test]
    fn malformed_probe_output_is_rejected() {
        assert_eq!(parse_python_probe(""), None);
        assert_eq!(parse_python_probe("3.12"), None);
        assert_eq!(parse_python_probe("not a version arm64"), None);
    }

    #[test]
    fn rejects_interpreters_below_the_floor() {
        // The reference machine's venv was built from this one, which the
        // readiness check simultaneously reported as too old.
        assert!(!python_is_suitable(3, 9, "arm64", "arm64"));
        assert!(python_is_suitable(3, 10, "arm64", "arm64"));
        assert!(python_is_suitable(3, 14, "arm64", "arm64"));
    }

    /// The failure that motivated the check: right version, wrong architecture,
    /// producing a venv whose torch cannot be loaded.
    #[test]
    fn rejects_an_interpreter_built_for_another_architecture() {
        assert!(!python_is_suitable(3, 12, "x86_64", "arm64"));
        assert!(python_is_suitable(3, 12, "x86_64", "x86_64"));
    }
}
