//! A loopback control surface for AI coding agents, in development builds only.
//!
//! An agent iterating on this app's UI is working blind: it can read the source
//! but not the running window, so "does this actually look right, and does the
//! microphone still work after that change?" comes back to a human relaying
//! screenshots and log excerpts by hand. This exposes the running app instead —
//! its live state, its diagnostic log, a screenshot of its window, the ability
//! to drive it, and its test suites.
//!
//! # Why the whole module is `debug_assertions`-gated
//!
//! Everything here is compiled out of release builds. Not disabled at runtime —
//! *absent*. A shipped binary that can be made to start the microphone and read
//! transcripts by any local process that finds a token file is not a trade worth
//! making for a debugging convenience, and a runtime flag is one
//! misconfiguration away from being exactly that. `tauri build` uses the release
//! profile, so nothing below reaches a user.
//!
//! Even in dev the surface is narrowed: bound to 127.0.0.1 so it is unreachable
//! off-machine, on an ephemeral port, behind a bearer token written to a `0600`
//! file, and with UI actions restricted to a whitelist.

#![cfg(debug_assertions)]

use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

/// Where the agent finds the port and token.
const HANDSHAKE_FILE: &str = "agent-bridge.json";

/// Cap on a request body. The bridge takes small JSON commands; anything larger
/// is a mistake or an attempt to exhaust memory.
const MAX_BODY_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct Handshake {
    pub port: u16,
    pub token: String,
    pub pid: u32,
}

/// The frontend's last published snapshot.
///
/// The webview owns UI state, so Rust cannot answer `/state` on its own. The
/// frontend pushes a snapshot whenever something meaningful changes and this
/// holds the most recent one — which also means `/state` never has to interrupt
/// the UI thread to answer.
#[derive(Default)]
pub struct BridgeState {
    snapshot: Mutex<Option<serde_json::Value>>,
}

impl BridgeState {
    pub fn publish(&self, value: serde_json::Value) {
        if let Ok(mut guard) = self.snapshot.lock() {
            *guard = Some(value);
        }
    }

    fn read(&self) -> serde_json::Value {
        self.snapshot
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
            .unwrap_or(serde_json::Value::Null)
    }
}

/// UI actions an agent may trigger.
///
/// A whitelist rather than a passthrough to the Tauri command surface: the
/// bridge should be able to exercise the app, not to reach anything the app
/// happens to expose. Adding an entry here is a deliberate act.
const ALLOWED_ACTIONS: &[&str] = &[
    "start_recording",
    "stop_recording",
    "toggle_compact_mode",
    "set_compact_mode",
    "transcribe_file",
    "clear_transcript",
    "update_settings",
    "select_view",
    "open_readiness",
];

#[derive(Debug, Deserialize)]
struct InvokeRequest {
    action: String,
    #[serde(default)]
    args: serde_json::Value,
}

fn default_window_label() -> String {
    "main".to_string()
}

#[derive(Debug, Deserialize)]
struct ScreenshotRequest {
    #[serde(default = "default_window_label")]
    window: String,
}

#[derive(Debug, Deserialize)]
struct TestsRequest {
    /// "rust" | "types" | "build"
    suite: String,
}

struct Request {
    method: String,
    path: String,
    token: Option<String>,
    body: Vec<u8>,
}

/// Reads one HTTP/1.1 request.
///
/// Hand-rolled rather than pulling in a web framework: this is a
/// development-only listener speaking to one client on loopback, and adding a
/// server stack to the dependency tree of a desktop app — where it would be
/// audited and shipped as part of every build — is a poor trade for the handful
/// of routes below.
async fn read_request(stream: &mut TcpStream) -> Result<Request> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];

    // Headers first, up to the blank line.
    let header_end = loop {
        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
        if buffer.len() > MAX_BODY_BYTES {
            anyhow::bail!("Request headers are too large");
        }
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            anyhow::bail!("Connection closed before the request completed");
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let head = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();

    let mut content_length = 0usize;
    let mut token = None;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        match name.as_str() {
            "content-length" => content_length = value.parse().unwrap_or(0),
            "authorization" => {
                token = value
                    .strip_prefix("Bearer ")
                    .or_else(|| value.strip_prefix("bearer "))
                    .map(|value| value.to_string())
            }
            _ => {}
        }
    }

    if content_length > MAX_BODY_BYTES {
        anyhow::bail!("Request body is too large");
    }

    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }

    Ok(Request {
        method,
        path,
        token,
        body,
    })
}

async fn respond(stream: &mut TcpStream, status: u16, body: &serde_json::Value) -> Result<()> {
    let payload = serde_json::to_vec(body)?;
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };

    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );

    stream.write_all(head.as_bytes()).await?;
    stream.write_all(&payload).await?;
    stream.flush().await?;
    Ok(())
}

/// Compares two tokens without leaking their common prefix through timing.
///
/// The bridge is loopback-only, so this is defence in depth rather than a
/// response to a specific threat — but a byte-by-byte `==` on a secret is the
/// kind of thing worth never writing in the first place.
fn tokens_match(expected: &str, provided: &str) -> bool {
    if expected.len() != provided.len() {
        return false;
    }
    expected
        .bytes()
        .zip(provided.bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

/// Splits "/logs?limit=200" into its path and a named query value.
fn query_value(path: &str, key: &str) -> Option<String> {
    let (_, query) = path.split_once('?')?;
    query.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        (name == key).then(|| value.to_string())
    })
}

fn route_of(path: &str) -> &str {
    path.split('?').next().unwrap_or(path)
}

pub fn handshake_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    Ok(crate::paths::app_data_dir(app)?.join(HANDSHAKE_FILE))
}

/// Writes the port and token where an agent can find them, readable only by
/// this user.
fn write_handshake(app: &tauri::AppHandle, handshake: &Handshake) -> Result<()> {
    let path = handshake_path(app)?;
    std::fs::write(&path, serde_json::to_vec_pretty(handshake)?)
        .with_context(|| format!("Failed to write {}", path.display()))?;

    // 0600: the token is a capability. Anything readable by other users on the
    // machine would hand them the same control the agent has.
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
        .with_context(|| format!("Failed to restrict permissions on {}", path.display()))?;

    Ok(())
}

pub fn remove_handshake(app: &tauri::AppHandle) {
    if let Ok(path) = handshake_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

/// Starts the bridge and returns once it is listening.
pub async fn start(app: tauri::AppHandle) -> Result<Handshake> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .context("Failed to bind the agent bridge to loopback")?;
    let port = listener.local_addr()?.port();
    let token = uuid::Uuid::new_v4().to_string();

    let handshake = Handshake {
        port,
        token: token.clone(),
        pid: std::process::id(),
    };
    write_handshake(&app, &handshake)?;

    let state = app.state::<Arc<BridgeState>>().inner().clone();

    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                continue;
            };
            let app = app.clone();
            let token = token.clone();
            let state = state.clone();
            tokio::spawn(async move {
                if let Err(error) = handle_connection(&mut stream, &app, &token, &state).await {
                    let _ = respond(
                        &mut stream,
                        500,
                        &serde_json::json!({ "error": format!("{error:#}") }),
                    )
                    .await;
                }
            });
        }
    });

    Ok(handshake)
}

async fn handle_connection(
    stream: &mut TcpStream,
    app: &tauri::AppHandle,
    token: &str,
    state: &Arc<BridgeState>,
) -> Result<()> {
    let request = read_request(stream).await?;

    let authorised = request
        .token
        .as_deref()
        .is_some_and(|provided| tokens_match(token, provided));

    if !authorised {
        return respond(
            stream,
            401,
            &serde_json::json!({ "error": "Missing or invalid bearer token" }),
        )
        .await;
    }

    let route = route_of(&request.path).to_string();
    let (status, body) = dispatch(app, state, &request, &route).await;
    respond(stream, status, &body).await
}

async fn dispatch(
    app: &tauri::AppHandle,
    state: &Arc<BridgeState>,
    request: &Request,
    route: &str,
) -> (u16, serde_json::Value) {
    match (request.method.as_str(), route) {
        ("GET", "/health") => (
            200,
            serde_json::json!({
                "ok": true,
                "app": "loudio",
                "version": env!("CARGO_PKG_VERSION"),
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "pid": std::process::id(),
            }),
        ),

        ("GET", "/state") => (200, serde_json::json!({ "state": state.read() })),

        ("GET", "/logs") => {
            let limit = query_value(&request.path, "limit")
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(64 * 1024);
            match crate::diagnostics::read_diagnostics_log(app.clone(), Some(limit)) {
                Ok(text) => (200, serde_json::json!({ "log": text })),
                Err(error) => (500, serde_json::json!({ "error": error })),
            }
        }

        ("POST", "/screenshot") => {
            // Defaults to the main window; `{"window": "readiness"}` targets
            // another. Readiness is its own OS window now, so an agent
            // reviewing it needs to be able to say which one it means.
            let label = serde_json::from_slice::<ScreenshotRequest>(&request.body)
                .map(|body| body.window)
                .unwrap_or_else(|_| default_window_label());
            match capture_window(app, &label).await {
                Ok(path) => (200, serde_json::json!({ "path": path, "window": label })),
                Err(error) => (500, serde_json::json!({ "error": format!("{error:#}") })),
            }
        }

        ("POST", "/invoke") => match serde_json::from_slice::<InvokeRequest>(&request.body) {
            Ok(invoke) => {
                if !ALLOWED_ACTIONS.contains(&invoke.action.as_str()) {
                    return (
                        400,
                        serde_json::json!({
                            "error": format!("Action '{}' is not allowed", invoke.action),
                            "allowed": ALLOWED_ACTIONS,
                        }),
                    );
                }
                // Delivered as an event: the webview owns the UI, so the bridge
                // asks it to act rather than reaching into its state.
                let _ = app.emit(
                    "agent-bridge:invoke",
                    serde_json::json!({ "action": invoke.action, "args": invoke.args }),
                );
                (200, serde_json::json!({ "dispatched": invoke.action }))
            }
            Err(error) => (
                400,
                serde_json::json!({ "error": format!("Invalid invoke payload: {error}") }),
            ),
        },

        ("POST", "/tests") => match serde_json::from_slice::<TestsRequest>(&request.body) {
            Ok(tests) => match run_suite(&tests.suite).await {
                Ok(value) => (200, value),
                Err(error) => (500, serde_json::json!({ "error": format!("{error:#}") })),
            },
            Err(error) => (
                400,
                serde_json::json!({ "error": format!("Invalid tests payload: {error}") }),
            ),
        },

        _ => (
            404,
            serde_json::json!({
                "error": "Unknown route",
                "routes": [
                    "GET /health",
                    "GET /state",
                    "GET /logs",
                    "POST /screenshot",
                    "POST /invoke",
                    "POST /tests"
                ],
            }),
        ),
    }
}

/// The main window's bounds as `x,y,w,h` in logical points, for
/// `screencapture -R`.
///
/// Returns `None` when the window cannot be measured, in which case the caller
/// falls back to a full-screen grab rather than failing the capture outright.
#[cfg(target_os = "macos")]
fn window_region(app: &tauri::AppHandle, label: &str) -> Option<String> {
    let window = app.get_webview_window(label)?;
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.outer_size().ok()?.to_logical::<f64>(scale);

    Some(format!(
        "{},{},{},{}",
        position.x.round(),
        position.y.round(),
        size.width.round(),
        size.height.round()
    ))
}

/// Captures the app window to a PNG and returns its path.
///
/// Shelling out to the platform's own tool rather than adding a capture crate:
/// this is dev-only code, the app already shells out to ffmpeg and whisper, and
/// a dependency added here would still be audited as part of the project.
async fn capture_window(app: &tauri::AppHandle, label: &str) -> Result<String> {
    let dir = crate::paths::app_data_dir(app)?.join("agent-screenshots");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.png", uuid::Uuid::new_v4()));
    let target = path.to_string_lossy().to_string();

    // Raised and focused first. The capture below takes a *screen region*, not a
    // window, so anything overlapping those coordinates — an editor, a terminal —
    // is what would land in the file instead of the app. The short settle lets
    // the compositor finish the raise before the shutter.
    let Some(window) = app.get_webview_window(label) else {
        anyhow::bail!("No window labelled '{label}' is open");
    };
    {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }

    #[cfg(target_os = "macos")]
    {
        // Cropped to the window rather than the whole display. A full-screen
        // grab of a developer's machine is mostly editor and terminal, which
        // buries the thing being reviewed and leaks whatever else is on screen.
        //
        // `-R` takes logical points, while Tauri reports physical pixels, so the
        // scale factor has to be divided out or the region lands at twice the
        // offset on a Retina display.
        let region = window_region(app, label);
        let mut args = vec!["-x".to_string(), "-o".to_string()];
        if let Some(region) = region {
            args.push("-R".to_string());
            args.push(region);
        }
        args.push(target.clone());

        crate::process::run_command("screencapture", &args)
            .await
            .context(
                "screencapture failed. Grant Screen Recording permission in \
                 System Settings → Privacy & Security.",
            )?;
    }

    #[cfg(target_os = "linux")]
    {
        // Wayland and X11 need different tools, and which is present varies by
        // distribution, so try in order rather than assuming one.
        let candidates: [(&str, Vec<String>); 4] = [
            ("grim", vec![target.clone()]),
            ("gnome-screenshot", vec!["-f".to_string(), target.clone()]),
            (
                "spectacle",
                vec![
                    "-b".to_string(),
                    "-n".to_string(),
                    "-o".to_string(),
                    target.clone(),
                ],
            ),
            (
                "import",
                vec!["-window".to_string(), "root".to_string(), target.clone()],
            ),
        ];

        let mut captured = false;
        for (bin, args) in candidates {
            if crate::process::run_command(bin, &args).await.is_ok() {
                captured = true;
                break;
            }
        }
        if !captured {
            anyhow::bail!(
                "No screenshot tool found. Install grim (Wayland) or \
                 gnome-screenshot / imagemagick (X11)."
            );
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        anyhow::bail!("Screenshots are not supported on this platform yet.");
    }

    #[allow(unreachable_code)]
    Ok(target)
}

/// Runs one of the project's checks and returns its output.
async fn run_suite(suite: &str) -> Result<serde_json::Value> {
    // The crate lives in src-tauri; the JS checks run from the repo root.
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .unwrap_or(manifest_dir)
        .to_string_lossy()
        .to_string();

    let (bin, args, cwd) = match suite {
        "rust" => (
            "cargo",
            vec!["test".to_string()],
            manifest_dir.to_string_lossy().to_string(),
        ),
        "types" => (
            "npx",
            vec!["tsc".to_string(), "--noEmit".to_string()],
            repo_root,
        ),
        "build" => (
            "npx",
            vec!["next".to_string(), "build".to_string()],
            repo_root,
        ),
        other => anyhow::bail!("Unknown suite '{other}'. Use rust, types or build."),
    };

    let output = tokio::process::Command::new(bin)
        .args(&args)
        .current_dir(&cwd)
        .output()
        .await
        .with_context(|| format!("Failed to run {bin}"))?;

    Ok(serde_json::json!({
        "suite": suite,
        "ok": output.status.success(),
        "exitCode": output.status.code(),
        "stdout": String::from_utf8_lossy(&output.stdout),
        "stderr": String::from_utf8_lossy(&output.stderr),
    }))
}

#[cfg(test)]
mod tests {
    use super::{query_value, route_of, tokens_match, ALLOWED_ACTIONS};

    #[test]
    fn token_comparison_rejects_mismatches_and_length_differences() {
        assert!(tokens_match("abc123", "abc123"));
        assert!(!tokens_match("abc123", "abc124"));
        assert!(!tokens_match("abc123", "abc"));
        assert!(!tokens_match("", "x"));
    }

    #[test]
    fn an_empty_token_only_matches_an_empty_token() {
        assert!(tokens_match("", ""));
    }

    #[test]
    fn separates_the_route_from_its_query() {
        assert_eq!(route_of("/logs?limit=10"), "/logs");
        assert_eq!(route_of("/health"), "/health");
    }

    #[test]
    fn reads_named_query_values() {
        assert_eq!(query_value("/logs?limit=10", "limit"), Some("10".into()));
        assert_eq!(query_value("/logs?a=1&limit=99", "limit"), Some("99".into()));
        assert_eq!(query_value("/logs", "limit"), None);
        assert_eq!(query_value("/logs?limit=10", "missing"), None);
    }

    /// The whitelist is the boundary on what an agent can make the app do, so a
    /// careless addition should be visible in a diff of this test too.
    #[test]
    fn the_action_whitelist_holds_only_ui_operations() {
        assert!(ALLOWED_ACTIONS.contains(&"start_recording"));
        assert!(ALLOWED_ACTIONS.contains(&"toggle_compact_mode"));
        // Nothing that reaches outside the UI.
        assert!(!ALLOWED_ACTIONS.contains(&"delete_microphone_recording"));
        assert!(!ALLOWED_ACTIONS.contains(&"save_settings"));
        assert_eq!(ALLOWED_ACTIONS.len(), 9);
    }
}
