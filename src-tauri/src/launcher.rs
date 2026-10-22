//! The Bloom app launcher: a full-screen, Launchpad-style grid of every
//! installed app that replaces the Start menu on a Win key tap and on the
//! dock's Start button.

use serde::Serialize;
use std::sync::Mutex;
use std::time::SystemTime;
use tauri::{AppHandle, Emitter, Manager};

/// `bloom-launcher-enabled` (default on). Off leaves the Start menu to Windows.
pub fn enabled(app: &AppHandle) -> bool {
    crate::utils::get_setting_str(app, "bloom-launcher-enabled")
        .map(|v| v != "false")
        .unwrap_or(true)
}

/// Makes the launcher a tool window. Bloom treats a full-screen foreground
/// window as a game and hides the dock and notch; tool windows are ignored by
/// that check, so the dock and notch stay visible over the launcher.
pub fn setup(app: &AppHandle) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
    };
    let Some(win) = app.get_webview_window("launcher") else {
        return;
    };
    if let Ok(hwnd) = win.hwnd() {
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW.0 as isize);
        }
    }
}

/// Safety net for the Win tap: if the Start menu still managed to open, close
/// it again so only the launcher's own open/close shows.
fn dismiss_start_menu_soon() {
    tauri::async_runtime::spawn_blocking(|| {
        use windows::Win32::UI::Input::KeyboardAndMouse::VK_ESCAPE;
        std::thread::sleep(std::time::Duration::from_millis(220));
        if crate::commands::is_start_menu_open() {
            crate::commands::send_key_tap(VK_ESCAPE, 0);
        }
    });
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
    dismiss_start_menu_soon();
}

/// While the launcher has focus the Win key reaches the launcher itself rather
/// than the global hook. It calls this when Win goes down, so a tap of an unused
/// key joins the press and Windows doesn't treat the release as a Start tap.
#[tauri::command]
pub fn mask_win_key() {
    crate::services::send_start_menu_mask();
}

#[tauri::command]
pub fn hide_launcher(app: AppHandle) {
    if let Some(win) = app.get_webview_window("launcher") {
        let _ = win.hide();
    }
}

/// Decoded wallpaper of the last read: file, modified time and a data URL.
static WALLPAPER: Mutex<Option<(String, SystemTime, String)>> = Mutex::new(None);

fn wallpaper_sync() -> Option<String> {
    use base64::Engine;
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_GETDESKWALLPAPER, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    };

    let mut buf = [0u16; 520];
    let current = unsafe {
        let _ = SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            buf.len() as u32,
            Some(buf.as_mut_ptr() as *mut _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..len])
    };
    // A slideshow or a changing wallpaper leaves the current picture here.
    let transcoded = std::env::var("APPDATA")
        .ok()
        .map(|appdata| format!("{appdata}\\Microsoft\\Windows\\Themes\\TranscodedWallpaper"));
    let path = [Some(current), transcoded]
        .into_iter()
        .flatten()
        .find(|p| !p.is_empty() && std::path::Path::new(p).is_file())?;
    let modified = std::fs::metadata(&path).and_then(|m| m.modified()).ok()?;

    if let Ok(cache) = WALLPAPER.lock() {
        if let Some((cached_path, cached_time, data)) = cache.as_ref() {
            if *cached_path == path && *cached_time == modified {
                return Some(data.clone());
            }
        }
    }

    let image = image::ImageReader::open(&path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()?;
    // It gets blurred, so a small copy is plenty.
    let small = image.thumbnail(1280, 800).to_rgb8();
    let mut jpeg = Vec::new();
    small
        .write_to(
            &mut std::io::Cursor::new(&mut jpeg),
            image::ImageFormat::Jpeg,
        )
        .ok()?;
    let data = format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&jpeg)
    );
    if let Ok(mut cache) = WALLPAPER.lock() {
        *cache = Some((path, modified, data.clone()));
    }
    Some(data)
}

/// The desktop wallpaper as a small image, for the launcher's blurred backdrop.
#[tauri::command]
pub async fn get_launcher_wallpaper() -> Option<String> {
    tauri::async_runtime::spawn_blocking(wallpaper_sync)
        .await
        .ok()
        .flatten()
}

/// One entry of Windows' record of the programs the user has run.
#[derive(Serialize)]
pub struct UsageEntry {
    /// An app id or an executable path, as Windows recorded it.
    pub key: String,
    pub count: u32,
    /// Unix seconds of the last launch.
    pub last_run: i64,
}

fn rot13(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            'a'..='z' => (((c as u8 - b'a' + 13) % 26) + b'a') as char,
            'A'..='Z' => (((c as u8 - b'A' + 13) % 26) + b'A') as char,
            other => other,
        })
        .collect()
}

fn usage_sync() -> Vec<UsageEntry> {
    use windows::core::{w, PCWSTR, PWSTR};
    use windows::Win32::Foundation::ERROR_NO_MORE_ITEMS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegEnumValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
    };

    let mut entries = Vec::new();
    unsafe {
        let mut root = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\UserAssist"),
            None,
            KEY_READ,
            &mut root,
        )
        .is_err()
        {
            return entries;
        }
        // One subkey per kind of launch (programs, shortcuts), each with a Count.
        let mut index = 0;
        loop {
            let mut name = [0u16; 128];
            let mut len = name.len() as u32;
            if RegEnumKeyExW(
                root,
                index,
                Some(PWSTR(name.as_mut_ptr())),
                &mut len,
                None,
                None,
                None,
                None,
            )
            .is_err()
            {
                break;
            }
            index += 1;
            let mut path: Vec<u16> = name[..len as usize].to_vec();
            path.extend("\\Count".encode_utf16());
            path.push(0);
            let mut count_key = HKEY::default();
            if RegOpenKeyExW(root, PCWSTR(path.as_ptr()), None, KEY_READ, &mut count_key).is_err() {
                continue;
            }
            let mut value_index = 0;
            loop {
                let mut value_name = [0u16; 1024];
                let mut name_len = value_name.len() as u32;
                let mut data = [0u8; 80];
                let mut data_len = data.len() as u32;
                let status = RegEnumValueW(
                    count_key,
                    value_index,
                    Some(PWSTR(value_name.as_mut_ptr())),
                    &mut name_len,
                    None,
                    None,
                    Some(data.as_mut_ptr()),
                    Some(&mut data_len),
                );
                if status == ERROR_NO_MORE_ITEMS {
                    break;
                }
                value_index += 1;
                // Entries bigger than the buffer (the session record) aren't apps.
                if status.is_err() {
                    continue;
                }
                // Windows 7 and later: 72 bytes with the run count at 4 and the
                // last run (a FILETIME) at 60.
                if data_len < 68 {
                    continue;
                }
                let key = rot13(&String::from_utf16_lossy(&value_name[..name_len as usize]));
                if key.starts_with("UEME_") {
                    continue;
                }
                let count = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
                let filetime = u64::from_le_bytes(data[60..68].try_into().unwrap_or([0; 8]));
                let last_run = (filetime / 10_000_000) as i64 - 11_644_473_600;
                entries.push(UsageEntry {
                    key,
                    count,
                    last_run,
                });
            }
            let _ = RegCloseKey(count_key);
        }
        let _ = RegCloseKey(root);
    }
    entries
}

/// Programs the user has launched, from Windows' UserAssist record. The launcher
/// uses it to show the apps that are actually used.
#[tauri::command]
pub async fn get_launcher_usage() -> Vec<UsageEntry> {
    tauri::async_runtime::spawn_blocking(usage_sync)
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rot13_decodes_user_assist_names() {
        assert_eq!(rot13("Pyncr.rkr"), "Clape.exe");
        assert_eq!(
            rot13(&rot13("Microsoft.WindowsNotepad_8wekyb3d8bbwe!App")),
            "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App"
        );
    }
}
