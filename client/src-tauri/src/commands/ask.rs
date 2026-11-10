use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const LABEL: &str = "ask";

#[tauri::command]
pub fn set_ask_recording(window: WebviewWindow, run_id: u64, active: bool) -> Result<(), String> {
    if window.label() != "main" { return Err("Only main can arm question recording".into()); }
    crate::keyboard::set_ask_recording(run_id, active);
    Ok(())
}

// The Windows panel is shown through ShowWindow to preserve keyboard focus.
// Tao still considers it hidden, so its hide() can skip the native operation.
fn hide_ask_window(panel: &WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
        let hwnd = panel.hwnd().map_err(|e| e.to_string())?;
        let _ = ShowWindow(
            windows::Win32::Foundation::HWND(hwnd.0 as *mut _),
            SW_HIDE,
        );
        Ok(())
    }
    #[cfg(not(windows))]
    panel.hide().map_err(|e| e.to_string())
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskTurn {
    question: String,
    answer: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskSnapshot {
    revision: u64,
    run_id: u64,
    status: String,
    question: String,
    answer: String,
    selected_text: String,
    context_warning: String,
    error: String,
    locale: String,
    #[serde(default)]
    screenshot_data_url: Option<String>,
    #[serde(default)]
    turns: Vec<AskTurn>,
}

#[derive(Default)]
pub struct AskWindowState(Mutex<AskSnapshot>);

/// Keep a snapshot for late-mounting renderers. No question or selected text is persisted.
#[tauri::command]
pub async fn sync_ask_window(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AskWindowState>,
    snapshot: AskSnapshot,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only main can update voice questions".into());
    }
    {
        let mut current = state.0.lock().map_err(|e| e.to_string())?;
        if snapshot.revision <= current.revision {
            return Ok(());
        }
        *current = snapshot.clone();
    }
    if snapshot.status == "listening" || snapshot.status == "cancelled" {
        if let Some(panel) = app.get_webview_window(LABEL) {
            hide_ask_window(&panel)?;
            panel
                .emit("ask-state", &snapshot)
                .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let panel = match app.get_webview_window(LABEL) {
        Some(panel) => panel,
        None => {
            let panel = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("ask.html".into()))
                .title("SayIt — Ask AI")
                .inner_size(560.0, 520.0)
                .min_inner_size(380.0, 300.0)
                .always_on_top(true)
                .focused(false)
                .visible(false)
                .center()
                .build()
                .map_err(|e| e.to_string())?;
            let handle = app.clone();
            panel.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Some(panel) = handle.get_webview_window(LABEL) {
                        let _ = hide_ask_window(&panel);
                    }
                    let state = handle.state::<AskWindowState>();
                    if let Ok(snapshot) = state.0.lock() {
                        let _ = handle.emit_to(
                            "main",
                            "ask-action",
                            serde_json::json!({
                                "action": "cancel", "runId": snapshot.run_id,
                            }),
                        );
                    };
                }
            });
            panel
        }
    };
    panel
        .emit("ask-state", &snapshot)
        .map_err(|e| e.to_string())?;
    // Opening an answer must not steal keystrokes from the app the user is working in.
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
        let hwnd = panel.hwnd().map_err(|e| e.to_string())?;
        let _ = ShowWindow(
            windows::Win32::Foundation::HWND(hwnd.0 as *mut _),
            SW_SHOWNOACTIVATE,
        );
    }
    #[cfg(not(windows))]
    panel.show().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_ask_snapshot(
    window: WebviewWindow,
    state: State<'_, AskWindowState>,
) -> Result<AskSnapshot, String> {
    if window.label() != LABEL {
        return Err("Only the question window can read its session".into());
    }
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub fn ask_window_action(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AskWindowState>,
    run_id: u64,
    action: String,
    question: Option<String>,
) -> Result<(), String> {
    if window.label() != LABEL || !matches!(action.as_str(), "cancel" | "new" | "followup" | "removeScreenshot") {
        return Err("Invalid question window action".into());
    }
    if state.0.lock().map_err(|e| e.to_string())?.run_id != run_id {
        return Ok(());
    }
    if action == "followup" {
        let text = question.as_deref().unwrap_or("").trim();
        if text.is_empty() || text.chars().count() > 4000 {
            return Err("Question must contain 1 to 4000 characters".into());
        }
    } else if action == "cancel" || action == "new" {
        hide_ask_window(&window)?;
    }
    app.emit_to(
        "main",
        "ask-action",
        serde_json::json!({ "action": action, "runId": run_id, "question": question }),
    )
    .map_err(|e| e.to_string())
}
