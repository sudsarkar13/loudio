use tauri::AppHandle;

use crate::{
    binaries::{
        detect_ffmpeg_bin, detect_whisper_cli, ensure_homebrew_available,
        ensure_python_whisper_runtime,
    },
    paths::runtime_dir,
    process::{emit_runtime_bootstrap_progress, run_command},
};

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

        match ensure_homebrew_available().await {
            Ok(brew_bin) => {
                messages.push(format!("Homebrew ready at {brew_bin}."));
                if run_command(&brew_bin, &["install".into(), "ffmpeg".into()])
                    .await
                    .is_ok()
                {
                    if let Some(ffmpeg_bin) = detect_ffmpeg_bin().await {
                        messages.push(format!("FFmpeg installed via Homebrew at {ffmpeg_bin}."));
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
                } else {
                    messages.push("Failed to auto-install FFmpeg with Homebrew. Install manually with `brew install ffmpeg` or set LOUDIO_FFMPEG_PATH.".into());
                    emit_runtime_bootstrap_progress(
                        &app,
                        45,
                        "FFmpeg install failed. Manual install required.",
                        false,
                    );
                }
            }
            Err(error) => {
                messages.push(format!(
                    "Homebrew unavailable: {error}. Install Homebrew from https://brew.sh and rerun Runtime Bootstrap."
                ));
                emit_runtime_bootstrap_progress(
                    &app,
                    45,
                    "Homebrew unavailable. Install Homebrew manually and retry.",
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

        match ensure_homebrew_available().await {
            Ok(brew_bin) => {
                messages.push(format!("Homebrew ready at {brew_bin}."));
                if run_command(&brew_bin, &["install".into(), "whisper-cpp".into()])
                    .await
                    .is_ok()
                {
                    messages.push("whisper.cpp installed via Homebrew.".into());
                    emit_runtime_bootstrap_progress(&app, 75, "whisper.cpp installed.", false);
                } else {
                    messages.push("Failed to auto-install whisper.cpp. You can still run Python Whisper profile.".into());
                    emit_runtime_bootstrap_progress(
                        &app,
                        75,
                        "whisper.cpp install failed. Python profile can still work.",
                        false,
                    );
                }
            }
            Err(error) => {
                messages.push(format!(
                    "Homebrew unavailable: {error}. whisper.cpp can be installed manually later with Homebrew once available."
                ));
                emit_runtime_bootstrap_progress(
                    &app,
                    75,
                    "Homebrew unavailable. whisper.cpp auto-install skipped.",
                    false,
                );
            }
        }
    }

    emit_runtime_bootstrap_progress(&app, 82, "Checking Python Whisper availability…", false);
    match ensure_python_whisper_runtime(&app).await {
        Ok(python_bin) => {
            if python_bin.contains("python-venv") {
                messages.push(
                    "OpenAI Whisper installed in app-local virtual environment.".into(),
                );
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
