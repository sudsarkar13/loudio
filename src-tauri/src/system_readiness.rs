use std::path::PathBuf;

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

use crate::{
    binaries::{
        detect_ffmpeg_bin, detect_python_with_whisper, detect_whisper_cli,
        ensure_homebrew_available, ensure_python_whisper_runtime, venv_python_path,
    },
    paths::{app_data_dir, runtime_dir},
    process::{command_available, run_command},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ReadinessState {
    Missing,
    Installed,
    Outdated,
    Failed,
    Skipped,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ReadinessActionKind {
    Install,
    Reinstall,
    Update,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ReadinessSeverity {
    Required,
    Recommended,
    Optional,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessCheck {
    pub id: String,
    pub name: String,
    pub description: String,
    pub required: String,
    pub current: Option<String>,
    pub state: ReadinessState,
    pub action_kind: ReadinessActionKind,
    pub severity: ReadinessSeverity,
    pub manual_command: Option<String>,
    pub detail: Option<String>,
    pub platform_supported: bool,
    /// Newest **stable** release offered by this platform's package manager.
    /// `None` when nothing newer is on offer, or when the channel could not be
    /// read. Pre-release channels are never consulted.
    pub available: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessReport {
    pub generated_at: String,
    pub os: String,
    pub arch: String,
    pub items: Vec<ReadinessCheck>,
    pub drift: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessProgressEvent {
    pub id: String,
    pub percent: u8,
    pub message: String,
    pub done: bool,
    pub error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ReadinessSnapshot {
    items: Vec<ReadinessCheck>,
}

fn snapshot_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app_data_dir(app)?.join("readiness");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("snapshot.json"))
}

fn load_snapshot(app: &AppHandle) -> Option<ReadinessSnapshot> {
    let path = snapshot_path(app).ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_snapshot(app: &AppHandle, snapshot: &ReadinessSnapshot) -> Result<()> {
    let path = snapshot_path(app)?;
    let raw = serde_json::to_string_pretty(snapshot)?;
    std::fs::write(path, raw)?;
    Ok(())
}

fn current_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "unknown"
    }
}

fn current_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else {
        "unknown"
    }
}

fn emit_progress(app: &AppHandle, id: &str, percent: u8, message: &str, done: bool, error: bool) {
    let _ = app.emit(
        "readiness-progress",
        ReadinessProgressEvent {
            id: id.to_string(),
            percent,
            message: message.to_string(),
            done,
            error,
        },
    );
}

/// Runs a per-check detection future and emits a completion progress event so
/// the wizard UI can settle the progress bar instead of getting stuck on the
/// initial "Detecting …" event.
async fn run_check<F>(app: &AppHandle, id: &str, fut: F) -> ReadinessCheck
where
    F: std::future::Future<Output = ReadinessCheck>,
{
    let check = fut.await;
    let message = match check.state {
        ReadinessState::Installed => format!("{} ready.", check.name),
        ReadinessState::Outdated => format!("{} outdated.", check.name),
        ReadinessState::Missing => format!("{} missing.", check.name),
        ReadinessState::Failed => format!("{} failed.", check.name),
        ReadinessState::Skipped => format!("{} skipped.", check.name),
        ReadinessState::Unknown => format!("{} unknown.", check.name),
    };
    emit_progress(app, id, 100, &message, true, false);
    check
}

fn parse_ffmpeg_version(stdout: &str) -> Option<String> {
    let first = stdout.lines().next()?;
    let prefix = "ffmpeg version ";
    let trimmed = first.strip_prefix(prefix)?;
    let version = trimmed.split_whitespace().next()?;
    Some(version.to_string())
}

async fn check_ffmpeg(app: &AppHandle) -> ReadinessCheck {
    let id = "ffmpeg".to_string();
    let platform_supported = current_os() != "unknown";

    if !platform_supported {
        return ReadinessCheck {
            id,
            name: "FFmpeg".to_string(),
            description: "Audio decode and conversion for transcription input.".to_string(),
            required: ">=4.0".to_string(),
            current: None,
            state: ReadinessState::Unknown,
            action_kind: ReadinessActionKind::None,
            severity: ReadinessSeverity::Required,
            manual_command: None,
            detail: Some("Unsupported operating system.".to_string()),
            platform_supported: false,
            available: None,
        };
    }

    emit_progress(app, &id, 5, "Detecting FFmpeg…", false, false);

    if let Some(bin) = detect_ffmpeg_bin().await {
        let version = match Command::new(&bin).arg("-version").output().await {
            Ok(output) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                parse_ffmpeg_version(&stdout)
            }
            _ => None,
        };

        let current = version.clone().unwrap_or_else(|| "unknown".to_string());
        let outdated = version
            .as_deref()
            .and_then(parse_semver_major)
            .map(|major| major < 4)
            .unwrap_or(false);

        if outdated {
            return ReadinessCheck {
                id,
                name: "FFmpeg".to_string(),
                description: "Audio decode and conversion for transcription input.".to_string(),
                required: ">=4.0".to_string(),
                current: Some(current),
                state: ReadinessState::Outdated,
                action_kind: ReadinessActionKind::Update,
                severity: ReadinessSeverity::Required,
                manual_command: Some(manual_command_for("ffmpeg", "update")),
                detail: Some("Installed FFmpeg is older than the recommended minimum.".to_string()),
                platform_supported: true,
                available: None,
            };
        }

        let available =
            stable_update_for(version.as_deref(), "ffmpeg", "ffmpeg", Some("ffmpeg")).await;

        return ReadinessCheck {
            id,
            name: "FFmpeg".to_string(),
            description: "Audio decode and conversion for transcription input.".to_string(),
            required: ">=4.0".to_string(),
            current: Some(current),
            state: ReadinessState::Installed,
            action_kind: ReadinessActionKind::None,
            severity: ReadinessSeverity::Required,
            manual_command: None,
            detail: None,
            platform_supported: true,
            available,
        };
    }

    ReadinessCheck {
        id,
        name: "FFmpeg".to_string(),
        description: "Audio decode and conversion for transcription input.".to_string(),
        required: ">=4.0".to_string(),
        current: None,
        state: ReadinessState::Missing,
        action_kind: ReadinessActionKind::Install,
        severity: ReadinessSeverity::Required,
        manual_command: Some(manual_command_for("ffmpeg", "install")),
        detail: None,
        platform_supported: true,
        available: None,
    }
}

/// Runs `<bin> --version` and returns the parsed whisper.cpp version.
async fn whisper_cpp_installed_version(bin: &str) -> Option<String> {
    let output = Command::new(bin).arg("--version").output().await.ok()?;
    // whisper-cli prints its banner on stderr on some builds.
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    crate::versions::parse_whisper_cpp_version(&text)
}

/// Newest stable release of a package, per this platform's package manager.
///
/// Only stable channels are consulted. On Linux the snap's beta and edge rows
/// frequently carry a higher version than stable, and following them would
/// install a pre-release build behind the user's back.
async fn stable_candidate_for(snap: &str, formula: &str, apt: Option<&str>) -> Option<String> {
    if cfg!(target_os = "macos") {
        let output = Command::new("brew")
            .args(["info", "--json=v2", formula])
            .output()
            .await
            .ok()?;
        return crate::versions::parse_brew_stable_version(&String::from_utf8_lossy(
            &output.stdout,
        ));
    }

    if let Some(package) = apt {
        if let Ok(output) = Command::new("apt-cache")
            .args(["policy", package])
            .output()
            .await
        {
            if let Some(candidate) =
                crate::versions::parse_apt_candidate(&String::from_utf8_lossy(&output.stdout))
            {
                return Some(candidate);
            }
        }
    }

    let output = Command::new("snap")
        .args(["info", snap])
        .output()
        .await
        .ok()?;
    crate::versions::parse_snap_stable_version(&String::from_utf8_lossy(&output.stdout))
}

/// The candidate to advertise, or `None` when it is not a newer stable release.
async fn stable_update_for(
    current: Option<&str>,
    snap: &str,
    formula: &str,
    apt: Option<&str>,
) -> Option<String> {
    let current = current?;
    let candidate = stable_candidate_for(snap, formula, apt).await?;
    crate::versions::stable_update_available(current, &candidate).then_some(candidate)
}

async fn check_whisper_cpp(app: &AppHandle) -> ReadinessCheck {
    let id = "whisper-cpp".to_string();
    emit_progress(app, &id, 5, "Detecting whisper.cpp…", false, false);

    if let Some(bin) = detect_whisper_cli(None).await {
        // Report the version, not the binary path: the path told the user
        // nothing about whether the engine was current.
        let installed = whisper_cpp_installed_version(&bin).await;
        let available =
            stable_update_for(installed.as_deref(), "whisper-cpp", "whisper-cpp", None).await;

        return ReadinessCheck {
            id,
            name: "whisper.cpp".to_string(),
            description: "Primary local transcription engine (fast C++ runtime).".to_string(),
            required: ">=1.5.0".to_string(),
            current: Some(installed.unwrap_or(bin)),
            state: ReadinessState::Installed,
            action_kind: ReadinessActionKind::None,
            severity: ReadinessSeverity::Required,
            manual_command: None,
            detail: None,
            platform_supported: true,
            available,
        };
    }

    ReadinessCheck {
        id,
        name: "whisper.cpp".to_string(),
        description: "Primary local transcription engine (fast C++ runtime).".to_string(),
        required: ">=1.5.0".to_string(),
        current: None,
        state: ReadinessState::Missing,
        action_kind: ReadinessActionKind::Install,
        severity: ReadinessSeverity::Required,
        manual_command: Some(manual_command_for("whisper-cpp", "install")),
        detail: None,
        platform_supported: true,
        available: None,
    }
}

async fn check_python(app: &AppHandle) -> ReadinessCheck {
    let id = "python".to_string();
    emit_progress(app, &id, 5, "Detecting Python…", false, false);

    let candidates = if current_os() == "windows" {
        vec!["python", "py", "python3"]
    } else {
        vec!["python3", "python"]
    };

    for candidate in candidates {
        if command_available(candidate, &["--version"]).await {
            return ReadinessCheck {
                id,
                name: "Python".to_string(),
                description: "Runtime for the OpenAI Whisper fallback engine.".to_string(),
                required: ">=3.10".to_string(),
                current: Some(candidate.to_string()),
                state: ReadinessState::Installed,
                action_kind: ReadinessActionKind::None,
                severity: ReadinessSeverity::Recommended,
                manual_command: None,
                detail: None,
                platform_supported: true,
                available: None,
            };
        }
    }

    ReadinessCheck {
        id,
        name: "Python".to_string(),
        description: "Runtime for the OpenAI Whisper fallback engine.".to_string(),
        required: ">=3.10".to_string(),
        current: None,
        state: ReadinessState::Missing,
        action_kind: ReadinessActionKind::Install,
        severity: ReadinessSeverity::Recommended,
        manual_command: Some(manual_command_for("python", "install")),
        detail: None,
        platform_supported: true,
        available: None,
    }
}

async fn check_openai_whisper(app: &AppHandle) -> ReadinessCheck {
    let id = "openai-whisper".to_string();
    emit_progress(app, &id, 5, "Detecting openai-whisper…", false, false);

    if detect_python_with_whisper().await.is_some() {
        return ReadinessCheck {
            id,
            name: "OpenAI Whisper (Python)".to_string(),
            description: "Fallback engine. Used when whisper.cpp is unavailable.".to_string(),
            required: "latest".to_string(),
            current: Some("system".to_string()),
            state: ReadinessState::Installed,
            action_kind: ReadinessActionKind::None,
            severity: ReadinessSeverity::Recommended,
            manual_command: None,
            detail: None,
            platform_supported: true,
            available: None,
        };
    }

    let venv_dir = runtime_dir(app).ok().map(|d| d.join("python-venv"));
    if let Some(dir) = venv_dir {
        let py = venv_python_path(&dir);
        if py.exists()
            && command_available(&py.to_string_lossy(), &["-m", "whisper", "--help"]).await
        {
            return ReadinessCheck {
                id,
                name: "OpenAI Whisper (Python)".to_string(),
                description: "Fallback engine. Used when whisper.cpp is unavailable.".to_string(),
                required: "latest".to_string(),
                current: Some("app-local venv".to_string()),
                state: ReadinessState::Installed,
                action_kind: ReadinessActionKind::None,
                severity: ReadinessSeverity::Recommended,
                manual_command: None,
                detail: None,
                platform_supported: true,
                available: None,
            };
        }
    }

    ReadinessCheck {
        id,
        name: "OpenAI Whisper (Python)".to_string(),
        description: "Fallback engine. Used when whisper.cpp is unavailable.".to_string(),
        required: "latest".to_string(),
        current: None,
        state: ReadinessState::Missing,
        action_kind: ReadinessActionKind::Install,
        severity: ReadinessSeverity::Recommended,
        manual_command: Some(manual_command_for("openai-whisper", "install")),
        detail: None,
        platform_supported: true,
        available: None,
    }
}

async fn check_models_dir(app: &AppHandle) -> ReadinessCheck {
    let id = "models-dir".to_string();
    emit_progress(app, &id, 5, "Checking models directory…", false, false);

    match runtime_dir(app) {
        Ok(dir) => {
            let models = dir.join("models");
            if models.exists() && models.is_dir() {
                ReadinessCheck {
                    id,
                    name: "Models directory".to_string(),
                    description: "Whisper model weights are downloaded here on first use."
                        .to_string(),
                    required: "writable".to_string(),
                    current: Some(models.to_string_lossy().to_string()),
                    state: ReadinessState::Installed,
                    action_kind: ReadinessActionKind::None,
                    severity: ReadinessSeverity::Required,
                    manual_command: None,
                    detail: None,
                    platform_supported: true,
                    available: None,
                }
            } else {
                ReadinessCheck {
                    id,
                    name: "Models directory".to_string(),
                    description: "Whisper model weights are downloaded here on first use."
                        .to_string(),
                    required: "writable".to_string(),
                    current: None,
                    state: ReadinessState::Missing,
                    action_kind: ReadinessActionKind::Install,
                    severity: ReadinessSeverity::Required,
                    manual_command: Some(manual_command_for("models-dir", "install")),
                    detail: None,
                    platform_supported: true,
                    available: None,
                }
            }
        }
        Err(error) => ReadinessCheck {
            id,
            name: "Models directory".to_string(),
            description: "Whisper model weights are downloaded here on first use.".to_string(),
            required: "writable".to_string(),
            current: None,
            state: ReadinessState::Failed,
            action_kind: ReadinessActionKind::Reinstall,
            severity: ReadinessSeverity::Required,
            manual_command: Some(manual_command_for("models-dir", "install")),
            detail: Some(error.to_string()),
            platform_supported: true,
            available: None,
        },
    }
}

fn parse_semver_major(input: &str) -> Option<u32> {
    let first = input.trim().split('.').next()?;
    first.parse::<u32>().ok()
}

pub fn manual_command_for(id: &str, action: &str) -> String {
    let os = current_os();
    match (id, action) {
        ("ffmpeg", "install") => match os {
            "macos" => "brew install ffmpeg".to_string(),
            "linux" => "sudo apt-get update && sudo apt-get install -y ffmpeg".to_string(),
            "windows" => "winget install -e --id Gyan.FFmpeg".to_string(),
            _ => "Install FFmpeg from https://ffmpeg.org/download.html".to_string(),
        },
        ("ffmpeg", "update") => match os {
            "macos" => "brew upgrade ffmpeg".to_string(),
            "linux" => "sudo apt-get update && sudo apt-get install --only-upgrade -y ffmpeg"
                .to_string(),
            "windows" => "winget upgrade -e --id Gyan.FFmpeg".to_string(),
            _ => "Update FFmpeg to >= 4.0 manually.".to_string(),
        },
        ("whisper-cpp", "install") => match os {
            "macos" => "brew install whisper-cpp".to_string(),
            "linux" => "sudo apt-get update && sudo apt-get install -y snapd && sudo snap install whisper-cpp && sudo snap alias whisper-cpp.cli whisper-cli".to_string(),
            "windows" => "winget install -e --id ggml.whisper-cpp".to_string(),
            _ => "Install whisper.cpp from https://github.com/ggerganov/whisper.cpp".to_string(),
        },
        ("python", "install") => match os {
            "macos" => "brew install python@3.11".to_string(),
            "linux" => "sudo apt-get install -y python3 python3-pip python3-venv".to_string(),
            "windows" => "winget install -e --id Python.Python.3.11".to_string(),
            _ => "Install Python 3.10+ from https://www.python.org/downloads/".to_string(),
        },
        ("openai-whisper", "install") => match os {
            "macos" | "linux" => {
                "python3 -m venv .venv && source .venv/bin/activate && pip install -U openai-whisper"
                    .to_string()
            }
            "windows" => {
                "python -m venv .venv && .venv\\Scripts\\activate && pip install -U openai-whisper"
                    .to_string()
            }
            _ => "Install openai-whisper from https://github.com/openai/whisper".to_string(),
        },
        ("models-dir", "install") => match os {
            "macos" => "mkdir -p \"$HOME/Library/Application Support/com.loudio.desktop/runtime/models\""
                .to_string(),
            "linux" => "mkdir -p \"$HOME/.local/share/com.loudio.desktop/runtime/models\""
                .to_string(),
            "windows" => {
                "mkdir \"%APPDATA%\\com.loudio.desktop\\runtime\\models\"".to_string()
            }
            _ => "Create a writable runtime/models directory in the app data folder.".to_string(),
        },
        _ => format!("No manual command known for {id}/{action}."),
    }
}

fn drift_between(previous: &[ReadinessCheck], current: &[ReadinessCheck]) -> Vec<String> {
    let mut drift = Vec::new();
    for now in current {
        let Some(before) = previous.iter().find(|item| item.id == now.id) else {
            if matches!(
                now.state,
                ReadinessState::Missing | ReadinessState::Failed | ReadinessState::Outdated
            ) {
                drift.push(now.id.clone());
            }
            continue;
        };

        let state_changed = before.state != now.state;
        let action_changed = before.action_kind != now.action_kind;
        let current_changed = before.current != now.current;

        if state_changed
            || action_changed
            || (current_changed
                && matches!(
                    now.state,
                    ReadinessState::Missing | ReadinessState::Failed | ReadinessState::Outdated
                ))
        {
            drift.push(now.id.clone());
        }
    }
    drift
}

pub async fn build_report(app: &AppHandle) -> ReadinessReport {
    let ffmpeg = run_check(app, "ffmpeg", check_ffmpeg(app)).await;
    let whisper_cpp = run_check(app, "whisper-cpp", check_whisper_cpp(app)).await;
    let python = run_check(app, "python", check_python(app)).await;
    let openai_whisper = run_check(app, "openai-whisper", check_openai_whisper(app)).await;
    let models_dir = run_check(app, "models-dir", check_models_dir(app)).await;

    let items = vec![ffmpeg, whisper_cpp, python, openai_whisper, models_dir];

    let snapshot = load_snapshot(app);
    let drift = snapshot
        .as_ref()
        .map(|s| drift_between(&s.items, &items))
        .unwrap_or_default();

    let generated_at = chrono::Utc::now().to_rfc3339();
    let os = current_os().to_string();
    let arch = current_arch().to_string();

    ReadinessReport {
        generated_at,
        os,
        arch,
        items,
        drift,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub(crate) struct SkippedState {
    items: Vec<String>,
}

fn skipped_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app_data_dir(app)?.join("readiness");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("skipped.json"))
}

fn load_skipped(app: &AppHandle) -> SkippedState {
    skipped_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<SkippedState>(&raw).ok())
        .unwrap_or_default()
}

fn save_skipped(app: &AppHandle, state: &SkippedState) -> Result<()> {
    let path = skipped_path(app)?;
    let raw = serde_json::to_string_pretty(state)?;
    std::fs::write(path, raw)?;
    Ok(())
}

pub(crate) fn apply_skipped_state(report: &mut ReadinessReport, skipped: &SkippedState) {
    for item in &mut report.items {
        if skipped.items.contains(&item.id) && matches!(item.state, ReadinessState::Missing) {
            item.state = ReadinessState::Skipped;
            item.action_kind = ReadinessActionKind::None;
        }
    }
}

#[tauri::command]
pub async fn check_system_readiness(
    app: AppHandle,
    force_full: Option<bool>,
) -> Result<ReadinessReport, String> {
    let mut report = build_report(&app).await;
    let skipped = load_skipped(&app);
    apply_skipped_state(&mut report, &skipped);

    if force_full.unwrap_or(false) || report.drift.is_empty() == false {
        // drift is informational only
    }

    if all_required_pass(&report) {
        let snapshot = ReadinessSnapshot {
            items: report.items.clone(),
        };
        let _ = save_snapshot(&app, &snapshot);
    }

    Ok(report)
}

fn all_required_pass(report: &ReadinessReport) -> bool {
    report.items.iter().all(|item| {
        if item.severity != ReadinessSeverity::Required {
            return true;
        }
        matches!(
            item.state,
            ReadinessState::Installed | ReadinessState::Skipped
        )
    })
}

#[tauri::command]
pub async fn install_readiness_item(app: AppHandle, id: String) -> Result<ReadinessCheck, String> {
    emit_progress(&app, &id, 0, "Starting…", false, false);

    let result = match id.as_str() {
        "ffmpeg" => install_ffmpeg(&app).await,
        "whisper-cpp" => install_whisper_cpp(&app).await,
        "python" => install_python(&app).await,
        "openai-whisper" => install_openai_whisper(&app).await,
        "models-dir" => install_models_dir(&app).await,
        other => Err(anyhow!("Unknown readiness item: {other}")),
    };

    match result {
        Ok(check) => {
            emit_progress(&app, &id, 100, "Done.", true, false);
            Ok(check)
        }
        Err(error) => {
            let message = format!("{error:#}");
            emit_progress(&app, &id, 100, &message, true, true);
            Err(message)
        }
    }
}

async fn install_ffmpeg(app: &AppHandle) -> Result<ReadinessCheck> {
    emit_progress(app, "ffmpeg", 20, "Preparing installer…", false, false);
    match current_os() {
        "macos" => {
            let brew = ensure_homebrew_available()
                .await
                .context("Homebrew is required to install FFmpeg on macOS")?;
            emit_progress(
                app,
                "ffmpeg",
                60,
                "Running: brew install ffmpeg",
                false,
                false,
            );
            run_command(&brew, &["install".into(), "ffmpeg".into()])
                .await
                .context("brew install ffmpeg failed")?;
        }
        "linux" => {
            ensure_linux_privilege_app(app, "ffmpeg", "apt-get install -y ffmpeg").await?;
            emit_progress(
                app,
                "ffmpeg",
                60,
                "Running: sudo apt-get install -y ffmpeg",
                false,
                false,
            );
            let sudo_result = run_command(
                "sudo",
                &[
                    "-n".into(),
                    "apt-get".into(),
                    "install".into(),
                    "-y".into(),
                    "ffmpeg".into(),
                ],
            )
            .await;
            if sudo_result.is_err() {
                run_command("apt-get", &["install".into(), "-y".into(), "ffmpeg".into()])
                    .await
                    .context("apt-get install ffmpeg failed")?;
            }
        }
        "windows" => {
            emit_progress(
                app,
                "ffmpeg",
                60,
                "Running: winget install -e --id Gyan.FFmpeg",
                false,
                false,
            );
            run_command(
                "winget",
                &[
                    "install".into(),
                    "-e".into(),
                    "--id".into(),
                    "Gyan.FFmpeg".into(),
                ],
            )
            .await
            .context("winget install ffmpeg failed")?;
        }
        _ => return Err(anyhow!("Unsupported OS for automatic FFmpeg install")),
    }
    Ok(check_ffmpeg(app).await)
}

async fn install_whisper_cpp(app: &AppHandle) -> Result<ReadinessCheck> {
    emit_progress(app, "whisper-cpp", 20, "Preparing installer…", false, false);
    match current_os() {
        "macos" => {
            let brew = ensure_homebrew_available()
                .await
                .context("Homebrew is required to install whisper.cpp on macOS")?;
            emit_progress(
                app,
                "whisper-cpp",
                60,
                "Running: brew install whisper-cpp",
                false,
                false,
            );
            run_command(&brew, &["install".into(), "whisper-cpp".into()])
                .await
                .context("brew install whisper-cpp failed")?;
        }
        "linux" => {
            ensure_linux_privilege_app(
                app,
                "whisper-cpp",
                "apt-get update && sudo apt-get install -y snapd && sudo snap install whisper-cpp && sudo snap alias whisper-cpp.cli whisper-cli",
            )
            .await?;
            emit_progress(
                app,
                "whisper-cpp",
                55,
                "Running: sudo apt-get update",
                false,
                false,
            );
            let sudo_result =
                run_command("sudo", &["-n".into(), "apt-get".into(), "update".into()]).await;
            if sudo_result.is_err() {
                run_command("apt-get", &["update".into()])
                    .await
                    .context("apt-get update failed")?;
            }

            emit_progress(
                app,
                "whisper-cpp",
                65,
                "Running: sudo apt-get install -y snapd",
                false,
                false,
            );
            let sudo_result = run_command(
                "sudo",
                &[
                    "-n".into(),
                    "apt-get".into(),
                    "install".into(),
                    "-y".into(),
                    "snapd".into(),
                ],
            )
            .await;
            if sudo_result.is_err() {
                run_command("apt-get", &["install".into(), "-y".into(), "snapd".into()])
                    .await
                    .context("apt-get install snapd failed")?;
            }

            emit_progress(
                app,
                "whisper-cpp",
                78,
                "Running: sudo snap install whisper-cpp",
                false,
                false,
            );
            let sudo_result = run_command(
                "sudo",
                &[
                    "-n".into(),
                    "snap".into(),
                    "install".into(),
                    "whisper-cpp".into(),
                ],
            )
            .await;
            if sudo_result.is_err() {
                run_command("snap", &["install".into(), "whisper-cpp".into()])
                    .await
                    .context("snap install whisper-cpp failed")?;
            }

            emit_progress(
                app,
                "whisper-cpp",
                88,
                "Running: sudo snap alias whisper-cpp.cli whisper-cli",
                false,
                false,
            );
            let sudo_result = run_command(
                "sudo",
                &[
                    "-n".into(),
                    "snap".into(),
                    "alias".into(),
                    "whisper-cpp.cli".into(),
                    "whisper-cli".into(),
                ],
            )
            .await;
            if sudo_result.is_err() {
                let alias_result = run_command(
                    "snap",
                    &[
                        "alias".into(),
                        "whisper-cpp.cli".into(),
                        "whisper-cli".into(),
                    ],
                )
                .await;

                if alias_result.is_err() && detect_whisper_cli(None).await.is_none() {
                    alias_result.context("snap alias whisper-cpp.cli whisper-cli failed")?;
                }
            }
        }
        "windows" => {
            emit_progress(
                app,
                "whisper-cpp",
                60,
                "Running: winget install -e --id ggml.whisper-cpp",
                false,
                false,
            );
            run_command(
                "winget",
                &[
                    "install".into(),
                    "-e".into(),
                    "--id".into(),
                    "ggml.whisper-cpp".into(),
                ],
            )
            .await
            .context("winget install whisper-cpp failed")?;
        }
        _ => return Err(anyhow!("Unsupported OS for automatic whisper.cpp install")),
    }
    Ok(check_whisper_cpp(app).await)
}

async fn install_python(app: &AppHandle) -> Result<ReadinessCheck> {
    emit_progress(app, "python", 20, "Preparing installer…", false, false);
    match current_os() {
        "macos" => {
            let brew = ensure_homebrew_available()
                .await
                .context("Homebrew is required to install Python on macOS")?;
            emit_progress(
                app,
                "python",
                60,
                "Running: brew install python@3.11",
                false,
                false,
            );
            run_command(&brew, &["install".into(), "python@3.11".into()])
                .await
                .context("brew install python failed")?;
        }
        "linux" => {
            ensure_linux_privilege_app(
                app,
                "python",
                "apt-get install -y python3 python3-pip python3-venv",
            )
            .await?;
            emit_progress(
                app,
                "python",
                60,
                "Running: sudo apt-get install -y python3 python3-pip python3-venv",
                false,
                false,
            );
            let sudo_result = run_command(
                "sudo",
                &[
                    "-n".into(),
                    "apt-get".into(),
                    "install".into(),
                    "-y".into(),
                    "python3".into(),
                    "python3-pip".into(),
                    "python3-venv".into(),
                ],
            )
            .await;
            if sudo_result.is_err() {
                run_command(
                    "apt-get",
                    &[
                        "install".into(),
                        "-y".into(),
                        "python3".into(),
                        "python3-pip".into(),
                        "python3-venv".into(),
                    ],
                )
                .await
                .context("apt-get install python failed")?;
            }
        }
        "windows" => {
            emit_progress(
                app,
                "python",
                60,
                "Running: winget install -e --id Python.Python.3.11",
                false,
                false,
            );
            run_command(
                "winget",
                &[
                    "install".into(),
                    "-e".into(),
                    "--id".into(),
                    "Python.Python.3.11".into(),
                ],
            )
            .await
            .context("winget install python failed")?;
        }
        _ => return Err(anyhow!("Unsupported OS for automatic Python install")),
    }
    Ok(check_python(app).await)
}

async fn install_openai_whisper(app: &AppHandle) -> Result<ReadinessCheck> {
    emit_progress(app, "openai-whisper", 20, "Preparing venv…", false, false);
    ensure_python_whisper_runtime(app)
        .await
        .context("Failed to install openai-whisper")?;
    Ok(check_openai_whisper(app).await)
}

async fn install_models_dir(app: &AppHandle) -> Result<ReadinessCheck> {
    emit_progress(
        app,
        "models-dir",
        50,
        "Creating models directory…",
        false,
        false,
    );
    let dir = runtime_dir(app)?.join("models");
    if !dir.exists() {
        std::fs::create_dir_all(&dir).context("Failed to create models directory")?;
    }
    Ok(check_models_dir(app).await)
}

async fn ensure_linux_privilege_app(app: &AppHandle, id: &str, action: &str) -> Result<()> {
    if command_available("sudo", &["-n", "true"]).await {
        return Ok(());
    }
    emit_progress(
        app,
        id,
        35,
        "Administrator privileges required. Use the manual command shown below.",
        false,
        false,
    );
    Err(anyhow!(
        "Automatic install needs passwordless sudo or root. Run manually: sudo {action}"
    ))
}

#[tauri::command]
pub async fn skip_readiness_item(app: AppHandle, id: String) -> Result<(), String> {
    let mut state = load_skipped(&app);
    if !state.items.contains(&id) {
        state.items.push(id);
    }
    save_skipped(&app, &state).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reset_readiness_skips(app: AppHandle) -> Result<(), String> {
    save_skipped(&app, &SkippedState::default()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_full_license() -> String {
    include_str!("../../LICENSE").to_string()
}

#[tauri::command]
pub fn readiness_manual(id: String, action: String) -> String {
    manual_command_for(&id, &action)
}
