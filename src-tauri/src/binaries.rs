use anyhow::{anyhow, Context, Result};
use std::{env, path::PathBuf};

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

    run_command(
        "/bin/bash",
        &["-c".into(), install_script.into()],
    )
    .await
    .context("Failed to run Homebrew installer")?;

    detect_brew_bin().await.ok_or_else(|| {
        anyhow!("Homebrew installer finished but brew is still not discoverable")
    })
}

pub async fn detect_ffmpeg_bin() -> Option<String> {
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

pub async fn maybe_convert_audio_to_wav(input_path: &PathBuf) -> Result<PathBuf> {
    let wav_path = input_path.with_extension("wav");

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
            wav_path.to_string_lossy().to_string(),
        ],
    )
    .await
    .with_context(|| {
        format!("Failed to convert microphone audio to wav with ffmpeg at {ffmpeg_bin}")
    })?;

    Ok(wav_path)
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

pub async fn ensure_python_whisper_runtime(
    app: &tauri::AppHandle,
) -> Result<String> {
    if let Some(system_python) = detect_python_with_whisper().await {
        return Ok(system_python);
    }

    let venv_dir = runtime_dir(app)?.join("python-venv");
    let venv_python = venv_python_path(&venv_dir);

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
        .context("Failed to create app-local Python virtual environment")?;
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

    let ready = command_available(
        &venv_python.to_string_lossy(),
        &["-m", "whisper", "--help"],
    )
    .await;

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

    for candidate in [
        "whisper-cli",
        "/opt/homebrew/bin/whisper-cli",
        "/usr/local/bin/whisper-cli",
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
