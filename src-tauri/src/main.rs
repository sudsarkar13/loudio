#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod binaries;
mod bootstrap;
mod commands;
mod install_flavor;
mod legacy_migration;
mod models;
mod paths;
mod process;
mod recordings;
mod system_readiness;
mod transcription;
mod versions;
mod vocabulary;

#[cfg(target_os = "linux")]
fn allow_linux_microphone_requests(webview_window: &tauri::WebviewWindow) -> tauri::Result<()> {
    webview_window.with_webview(|webview| {
        use webkit2gtk::{
            glib::{object::ObjectExt, prelude::*, value::ToValue},
            PermissionRequest, PermissionRequestExt, UserMediaPermissionRequest,
            UserMediaPermissionRequestExt, WebViewExt,
        };

        let app_origin = "http://localhost:3000";
        let webview = webview.inner();
        webview.connect_local("permission-request", false, move |values| {
            let request = values
                .get(1)
                .and_then(|value| value.get::<PermissionRequest>().ok());
            let Some(request) = request else {
                return Some(false.to_value());
            };

            if let Ok(media_request) = request.clone().downcast::<UserMediaPermissionRequest>() {
                let uri = values
                    .first()
                    .and_then(|value| value.get::<webkit2gtk::WebView>().ok())
                    .and_then(|webview| webview.uri())
                    .unwrap_or_default();
                let is_app_page = uri.starts_with("tauri://localhost")
                    || uri.starts_with("https://tauri.localhost")
                    || uri.starts_with(app_origin);

                if is_app_page
                    && media_request.is_for_audio_device()
                    && !media_request.is_for_video_device()
                {
                    request.allow();
                    return Some(true.to_value());
                }
            }

            Some(false.to_value())
        });
    })
}

fn main() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Runs before the webview exists, which is the point. The frontend
            // persists its default settings as soon as it mounts, so anything
            // that migrates settings has to be finished before that first save
            // lands — otherwise the defaults are already on disk and a renamed
            // install looks like a first run.
            if let Some(source) = crate::legacy_migration::adopt_legacy_settings(app.handle()) {
                eprintln!(
                    "Adopted settings from a previous install: {}",
                    source.display()
                );
            }

            // Before anything calls runtime_dir(), which would create the empty
            // scaffolding this looks for the absence of.
            if let Some(source) = crate::legacy_migration::adopt_legacy_runtime(app.handle()) {
                eprintln!(
                    "Moved the runtime directory from a previous install: {}",
                    source.display()
                );
            }

            #[cfg(target_os = "linux")]
            if let Some(webview_window) = app.get_webview_window("main") {
                allow_linux_microphone_requests(&webview_window)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_runtime_profiles,
            install_flavor::get_install_info,
            commands::load_settings,
            commands::save_settings,
            bootstrap::bootstrap_runtime,
            system_readiness::check_system_readiness,
            system_readiness::install_readiness_item,
            system_readiness::update_readiness_item,
            system_readiness::skip_readiness_item,
            system_readiness::reset_readiness_skips,
            system_readiness::read_full_license,
            system_readiness::readiness_manual,
            commands::transcribe_audio,
            commands::transcribe_microphone_audio,
            commands::list_microphone_recordings,
            commands::recordings_disk_usage,
            commands::delete_microphone_recording,
            commands::list_legacy_recording_dirs,
            commands::migrate_legacy_recordings,
            commands::current_recordings_output_dir,
            commands::reveal_recordings_output_dir,
            commands::set_window_menu_visible,
            commands::suggest_corrections,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
