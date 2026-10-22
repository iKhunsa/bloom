//! The Bloom app launcher: a full-screen, Launchpad-style grid of every
//! installed app that replaces the Start menu on a Win key tap and on the
//! dock's Start button.

use tauri::{AppHandle, Emitter, Manager};

/// `bloom-launcher-enabled` (default on). Off leaves the Start menu to Windows.
pub fn enabled(app: &AppHandle) -> bool {
    crate::utils::get_setting_str(app, "bloom-launcher-enabled")
        .map(|v| v != "false")
        .unwrap_or(true)
}

fn show(app: &AppHandle) {
    let Some(win) = app.get_webview_window("launcher") else {
        return;
    };
    // Cover the whole primary screen; the dock and notch stay above it.
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let _ = win.set_position(*monitor.position());
        let _ = win.set_size(*monitor.size());
    }
    let _ = win.show();
    let _ = win.set_focus();
    if let Ok(hwnd) = win.hwnd() {
        unsafe {
            let _ = windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow(hwnd);
        }
    }
    let _ = app.emit_to("launcher", "launcher-open", ());
}

/// Opens the launcher, or asks it to close (it plays its exit animation and
/// then calls `hide_launcher`) when it is already showing.
#[tauri::command]
pub fn toggle_launcher(app: AppHandle) {
    let visible = app
        .get_webview_window("launcher")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if visible {
        let _ = app.emit_to("launcher", "launcher-close", ());
    } else {
        show(&app);
    }
}

#[tauri::command]
pub fn hide_launcher(app: AppHandle) {
    if let Some(win) = app.get_webview_window("launcher") {
        let _ = win.hide();
    }
}
