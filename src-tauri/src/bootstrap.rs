use tauri::AppHandle;

use crate::{
    binaries::{
        detect_ffmpeg_bin, detect_whisper_cli, ensure_homebrew_available,
        ensure_python_whisper_runtime,
    },
    paths::runtime_dir,
    process::{command_available, emit_runtime_bootstrap_progress, run_command},
    system_readiness::manual_command_for,
};

/// Installs `packages` with apt, preferring passwordless sudo and falling back
/// to a direct call for the (rare) case where Loudio already runs as root.
async fn apt_install(packages: &[&str]) -> anyhow::Result<()> {
    let mut args: Vec<String> = vec!["install".into(), "-y".into()];
    args.extend(packages.iter().map(|p| p.to_string()));

    if command_available("sudo", &["-n", "true"]).await {
        let mut sudo_args: Vec<String> = vec!["-n".into(), "apt-get".into()];
        sudo_args.extend(args.iter().cloned());
        run_command("sudo", &sudo_args).await?;
        return Ok(());
    }

    run_command("apt-get", &args).await?;
    Ok(())
}

#[tauri::command]
pub async fn bootstrap_runtime(app: AppHandle) -> Result<String, String> {
    let mut messages: Vec<String> = Vec::new();

    emit_runtime_bootstrap_progress(&app, 5, "Preparing runtime directories…", false);
    runtime_dir(&app).map_err(|e| e.to_string())?;

    emit_runtime_bootstrap_progress(&app, 20, "Checking FFmpeg availability…", false);
    if let Some(ffmpeg_bin) = detect_ffmpeg_bin().await {
        messages.push(format!("FFmpeg detected at {ffmpeg_bin}."));
        emit_runtime_bootstrap_progress(&app, 35, "FFmpeg detected.", false);
    } else {
        messages.push("FFmpeg missing. Preparing package manager...".into());
        emit_runtime_bootstrap_progress(
            &app,
            35,
            "FFmpeg missing. Preparing package manager…",
            false,
        );

        let installed = if cfg!(target_os = "linux") {
            apt_install(&["ffmpeg"]).await.map_err(|e| e.to_string())
        } else {
            match ensure_homebrew_available().await {
                Ok(brew_bin) => {
                    messages.push(format!("Homebrew ready at {brew_bin}."));
                    run_command(&brew_bin, &["install".into(), "ffmpeg".into()])
                        .await
                        .map(|_| ())
                        .map_err(|e| e.to_string())
                }
                Err(error) => Err(error.to_string()),
            }
        };

        match installed {
            Ok(()) => {
                if let Some(ffmpeg_bin) = detect_ffmpeg_bin().await {
                    messages.push(format!("FFmpeg installed at {ffmpeg_bin}."));
                    emit_runtime_bootstrap_progress(&app, 45, "FFmpeg installed.", false);
                } else {
                    messages.push("FFmpeg install completed but binary is still not discoverable from Loudio runtime.".into());
                    emit_runtime_bootstrap_progress(
                        &app,
                        45,
                        "FFmpeg installed but not discoverable. Configure LOUDIO_FFMPEG_PATH.",
                        false,
                    );
                }
            }
            Err(error) => {
                messages.push(format!(
                    "Could not auto-install FFmpeg: {error}. Install it manually with `{}` and rerun Runtime Bootstrap.",
                    manual_command_for("ffmpeg", "install")
                ));
                emit_runtime_bootstrap_progress(
                    &app,
                    45,
                    "FFmpeg install failed. Manual install required.",
                    false,
                );
            }
        }
    }

    emit_runtime_bootstrap_progress(&app, 55, "Checking whisper.cpp availability…", false);
    let has_whisper_cpp = detect_whisper_cli(None).await.is_some();
    if has_whisper_cpp {
        messages.push("whisper.cpp CLI detected.".into());
        emit_runtime_bootstrap_progress(&app, 65, "whisper.cpp detected.", false);
    } else {
        messages.push("whisper.cpp missing. Preparing package manager...".into());
        emit_runtime_bootstrap_progress(
            &app,
            65,
            "whisper.cpp missing. Preparing package manager…",
            false,
        );

        let installed = if cfg!(target_os = "linux") {
            install_whisper_cpp_linux().await.map_err(|e| e.to_string())
        } else {
            match ensure_homebrew_available().await {
                Ok(brew_bin) => {
                    messages.push(format!("Homebrew ready at {brew_bin}."));
                    run_command(&brew_bin, &["install".into(), "whisper-cpp".into()])
                        .await
                        .map(|_| ())
                        .map_err(|e| e.to_string())
                }
                Err(error) => Err(error.to_string()),
            }
        };

        match installed {
            Ok(()) if detect_whisper_cli(None).await.is_some() => {
                messages.push("whisper.cpp installed.".into());
                emit_runtime_bootstrap_progress(&app, 75, "whisper.cpp installed.", false);
            }
            Ok(()) => {
                messages.push(
                    "whisper.cpp install finished but whisper-cli is still not discoverable."
                        .into(),
                );
                emit_runtime_bootstrap_progress(
                    &app,
                    75,
                    "whisper.cpp installed but not discoverable.",
                    false,
                );
            }
            Err(error) => {
                messages.push(format!(
                    "Could not auto-install whisper.cpp: {error}. Install it manually with `{}`. The Python Whisper profile still works in the meantime.",
                    manual_command_for("whisper-cpp", "install")
                ));
                emit_runtime_bootstrap_progress(
                    &app,
                    75,
                    "whisper.cpp install failed. Python profile can still work.",
                    false,
                );
            }
        }
    }

    emit_runtime_bootstrap_progress(&app, 82, "Checking Python Whisper availability…", false);
    match ensure_python_whisper_runtime(&app).await {
        Ok(python_bin) => {
            if python_bin.contains("python-venv") {
                messages.push("OpenAI Whisper installed in app-local virtual environment.".into());
                emit_runtime_bootstrap_progress(
                    &app,
                    95,
                    "Python Whisper ready (app-local venv).",
                    false,
                );
            } else {
                messages.push("OpenAI Whisper (Python) detected.".into());
                emit_runtime_bootstrap_progress(&app, 95, "Python Whisper detected.", false);
            }
        }
        Err(error) => {
            messages.push(format!(
                "Python Whisper unavailable. Automatic app-local setup failed: {}",
                error
            ));
            emit_runtime_bootstrap_progress(
                &app,
                95,
                "Python Whisper setup failed. whisper.cpp profile remains available.",
                false,
            );
        }
    }

    emit_runtime_bootstrap_progress(&app, 100, "Runtime check complete.", true);
    Ok(messages.join(" "))
}

/// Ubuntu/Debian path for whisper.cpp: the `whisper-cpp` snap, aliased so the
/// binary is discoverable under the `whisper-cli` name the engine looks for.
async fn install_whisper_cpp_linux() -> anyhow::Result<()> {
    let sudo = command_available("sudo", &["-n", "true"]).await;

    let run = |bin: &'static str, args: Vec<String>| async move {
        if sudo {
            let mut sudo_args: Vec<String> = vec!["-n".into(), bin.into()];
            sudo_args.extend(args);
            run_command("sudo", &sudo_args).await.map(|_| ())
        } else {
            run_command(bin, &args).await.map(|_| ())
        }
    };

    if !command_available("snap", &["version"]).await {
        apt_install(&["snapd"]).await?;
    }

    run("snap", vec!["install".into(), "whisper-cpp".into()]).await?;

    // Best-effort: the engine also probes the un-aliased `whisper-cpp.cli`.
    let _ = run(
        "snap",
        vec![
            "alias".into(),
            "whisper-cpp.cli".into(),
            "whisper-cli".into(),
        ],
    )
    .await;

    Ok(())
}
