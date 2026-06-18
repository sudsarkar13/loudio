#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod binaries;
mod bootstrap;
mod commands;
mod models;
mod paths;
mod process;
mod recordings;
mod system_readiness;
mod transcription;

fn main() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_runtime_profiles,
            commands::load_settings,
            commands::save_settings,
            bootstrap::bootstrap_runtime,
            system_readiness::check_system_readiness,
            system_readiness::install_readiness_item,
            system_readiness::skip_readiness_item,
            system_readiness::reset_readiness_skips,
            system_readiness::read_full_license,
            system_readiness::readiness_manual_command,
            commands::transcribe_audio,
            commands::transcribe_microphone_audio,
            commands::list_microphone_recordings_command,
            commands::delete_microphone_recording_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
