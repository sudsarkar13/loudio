//! The System Readiness window.
//!
//! Readiness used to render as a full-screen overlay inside the main window,
//! which conflated two different things: the studio you work in, and the
//! preflight that decides whether the studio can run at all. Separating them
//! into two OS windows lets the check keep running — and stay readable — while
//! the main window goes on doing whatever it was doing.
//!
//! The window is created on demand rather than declared in `tauri.conf.json`,
//! because most launches never need it.

use anyhow::Result;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Window label. Also the key Tauri dedupes windows by, so re-opening an
/// already-open readiness window focuses it instead of spawning a second one.
pub const READINESS_WINDOW_LABEL: &str = "readiness";

/// Route served at `app/readiness/page.tsx`.
///
/// The trailing slash pairs with `trailingSlash: true` in `next.config.mjs`:
/// the static export writes `out/readiness/index.html`, and the dev server
/// answers `/readiness/` without a redirect.
///
/// Getting this wrong does not fail loudly. Tauri resolves an unknown asset by
/// trying `<path>`, then `<path>.html`, then `<path>/index.html`, and finally
/// plain `index.html` — so a bad route silently renders *the main app* inside
/// the readiness window rather than raising a 404. That is the failure this
/// constant and its test exist to prevent.
const READINESS_ROUTE: &str = "readiness/";

/// Emitted whenever readiness state changes, so the main window can re-gate
/// itself without polling.
pub const READINESS_CHANGED_EVENT: &str = "readiness://changed";

/// Emitted when the readiness window closes, however it closed — the footer
/// button, the titlebar, or the window manager.
pub const READINESS_CLOSED_EVENT: &str = "readiness://closed";

const DEFAULT_WIDTH: f64 = 940.0;
const DEFAULT_HEIGHT: f64 = 760.0;
const MIN_WIDTH: f64 = 720.0;
const MIN_HEIGHT: f64 = 560.0;

/// Opens the readiness window, or focuses it if it is already open.
///
/// Focusing rather than rebuilding is deliberate: a rebuild would discard an
/// install that is midway through running.
pub fn open(app: &AppHandle) -> Result<()> {
    if let Some(existing) = app.get_webview_window(READINESS_WINDOW_LABEL) {
        // An open window may still be minimised or behind the main window.
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        READINESS_WINDOW_LABEL,
        WebviewUrl::App(READINESS_ROUTE.into()),
    )
    .title("System Readiness")
    .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
    .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
    .resizable(true)
    .center()
    .build()?;

    // Tell the main window when this one goes away, so it can re-check rather
    // than trusting whatever it last heard. Closing the window is a legitimate
    // way to dismiss readiness, and the main window has to notice.
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = handle.emit(READINESS_CLOSED_EVENT, ());
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn open_readiness_window(app: AppHandle) -> Result<(), String> {
    open(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn close_readiness_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(READINESS_WINDOW_LABEL) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Broadcasts a readiness change to every window.
///
/// Called by the readiness window after an install, skip or acknowledgement.
/// The payload is deliberately empty: the main window re-runs its own check
/// rather than trusting a report marshalled across a window boundary, so the
/// two can never disagree about what is installed.
#[tauri::command]
pub async fn notify_readiness_changed(app: AppHandle) -> Result<(), String> {
    app.emit(READINESS_CHANGED_EVENT, ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_has_a_trailing_slash_so_dev_and_export_agree() {
        // Pinned because the failure mode is silent: Tauri's asset fallback
        // ends at `index.html`, so a wrong route loads the main studio inside
        // the readiness window instead of erroring.
        assert!(
            READINESS_ROUTE.ends_with('/'),
            "readiness route must end in '/' to match the static export layout",
        );
        assert!(
            !READINESS_ROUTE.starts_with('/'),
            "WebviewUrl::App takes a relative path",
        );
    }

    #[test]
    fn window_is_never_built_smaller_than_its_minimum() {
        assert!(DEFAULT_WIDTH >= MIN_WIDTH);
        assert!(DEFAULT_HEIGHT >= MIN_HEIGHT);
    }

    #[test]
    fn event_names_are_namespaced() {
        // Shared with the frontend listeners; a rename on one side only is a
        // silent failure, so pin them.
        assert_eq!(READINESS_CHANGED_EVENT, "readiness://changed");
        assert_eq!(READINESS_CLOSED_EVENT, "readiness://closed");
        assert_eq!(READINESS_WINDOW_LABEL, "readiness");
    }
}
