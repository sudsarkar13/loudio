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

    if !venv_python.exists() {
        run_command(
            "python3",
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
