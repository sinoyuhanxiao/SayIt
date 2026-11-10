use base64::Engine;
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayPointerPosition { x: f64, y: f64 }

#[tauri::command]
pub fn get_overlay_pointer_state(window: WebviewWindow) -> Result<Option<OverlayPointerPosition>, String> {
    if window.label() != "overlay" { return Err("Only the voice overlay can read its pointer position".into()); }
    #[cfg(windows)]
    {
        use windows::Win32::{Foundation::{HWND, POINT, RECT}, UI::WindowsAndMessaging::{GetCursorPos, GetWindowRect}};
        let hwnd = window.hwnd().map_err(|e| e.to_string()).map(|hwnd| HWND(hwnd.0 as *mut _))?;
        let mut cursor = POINT::default();
        let mut rect = RECT::default();
        unsafe {
            GetCursorPos(&mut cursor).map_err(|e| e.to_string())?;
            GetWindowRect(hwnd, &mut rect).ok().ok_or("Could not read voice overlay bounds")?;
        }
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 0 || height <= 0 || cursor.x < rect.left || cursor.x >= rect.right || cursor.y < rect.top || cursor.y >= rect.bottom {
            return Ok(None);
        }
        return Ok(Some(OverlayPointerPosition {
            x: (cursor.x - rect.left) as f64 / width as f64,
            y: (cursor.y - rect.top) as f64 / height as f64,
        }));
    }
    #[cfg(not(windows))]
    { Ok(None) }
}

#[tauri::command]
pub fn capture_ask_screenshot(app: AppHandle, window: WebviewWindow) -> Result<String, String> {
    if window.label() != "main" {
        return Err("Only the main window can capture a question screenshot".into());
    }

    #[cfg(windows)]
    {
        let hidden = ["overlay", "ask"]
            .into_iter()
            .filter_map(|label| app.get_webview_window(label))
            .filter_map(HiddenWindow::hide)
            .collect::<Vec<_>>();
        std::thread::sleep(std::time::Duration::from_millis(110));
        let result = capture_cursor_monitor_png();
        drop(hidden);
        return result.map(|png| {
            format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
        });
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        Err("Screen capture is currently available in the Windows test build".into())
    }
}

#[cfg(windows)]
struct HiddenWindow {
    hwnd: windows::Win32::Foundation::HWND,
    was_visible: bool,
}

#[cfg(windows)]
impl HiddenWindow {
    fn hide(window: WebviewWindow) -> Option<Self> {
        use windows::Win32::UI::WindowsAndMessaging::{IsWindowVisible, ShowWindow, SW_HIDE};
        let hwnd = window.hwnd().ok().map(|hwnd| windows::Win32::Foundation::HWND(hwnd.0 as *mut _))?;
        unsafe {
            let was_visible = IsWindowVisible(hwnd).as_bool();
            if was_visible {
                let _ = ShowWindow(hwnd, SW_HIDE);
            }
            Some(Self { hwnd, was_visible })
        }
    }
}

#[cfg(windows)]
impl Drop for HiddenWindow {
    fn drop(&mut self) {
        if self.was_visible {
            use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
            unsafe { let _ = ShowWindow(self.hwnd, SW_SHOWNOACTIVATE); }
        }
    }
}

#[cfg(windows)]
fn capture_cursor_monitor_png() -> Result<Vec<u8>, String> {
    use std::{ffi::c_void, io::Cursor};
    use windows::Win32::{
        Foundation::{HWND, RECT},
        Graphics::Gdi::{
            CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
            GetDC, GetDIBits, ReleaseDC, SelectObject, SetStretchBltMode, StretchBlt,
            BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, HBITMAP,
            HGDIOBJ, SRCCOPY, GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        },
        UI::WindowsAndMessaging::GetCursorPos,
    };

    let mut cursor = windows::Win32::Foundation::POINT::default();
    unsafe { GetCursorPos(&mut cursor).map_err(|e| format!("Could not read cursor position: {e}"))?; }
    let monitor = unsafe { MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST) };
    let mut monitor_info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    if !unsafe { GetMonitorInfoW(monitor, &mut monitor_info) }.as_bool() { return Err("Could not read display bounds".into()); }
    let rect: RECT = monitor_info.rcMonitor;
    let source_width = rect.right - rect.left;
    let source_height = rect.bottom - rect.top;
    if source_width <= 0 || source_height <= 0 || source_width.max(source_height) > 16_384 {
        return Err("The current display has unsupported dimensions".into());
    }
    let scale: f64 = (2560.0 / source_width.max(source_height) as f64).min(1.0);
    let width = (source_width as f64 * scale).round().max(1.0) as i32;
    let height = (source_height as f64 * scale).round().max(1.0) as i32;

    let screen_dc = unsafe { GetDC(HWND::default()) };
    if screen_dc.0.is_null() { return Err("Could not access the desktop display".into()); }
    let memory_dc = unsafe { CreateCompatibleDC(screen_dc) };
    if memory_dc.0.is_null() {
        unsafe { let _ = ReleaseDC(HWND::default(), screen_dc); }
        return Err("Could not create a capture surface".into());
    }
    let bitmap: HBITMAP = unsafe { CreateCompatibleBitmap(screen_dc, width, height) };
    if bitmap.0.is_null() {
        unsafe { let _ = DeleteDC(memory_dc); let _ = ReleaseDC(HWND::default(), screen_dc); }
        return Err("Could not allocate the screenshot".into());
    }
    let previous: HGDIOBJ = unsafe { SelectObject(memory_dc, HGDIOBJ(bitmap.0)) };
    let copied = unsafe {
        let _ = SetStretchBltMode(memory_dc, HALFTONE);
        StretchBlt(memory_dc, 0, 0, width, height, screen_dc, rect.left, rect.top, source_width, source_height, SRCCOPY).as_bool()
    };
    if !copied {
        unsafe { let _ = SelectObject(memory_dc, previous); let _ = DeleteObject(HGDIOBJ(bitmap.0)); let _ = DeleteDC(memory_dc); let _ = ReleaseDC(HWND::default(), screen_dc); }
        return Err("Windows could not capture the current display".into());
    }

    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bgra = vec![0u8; width as usize * height as usize * 4];
    let rows = unsafe {
        GetDIBits(screen_dc, bitmap, 0, height as u32, Some(bgra.as_mut_ptr().cast::<c_void>()), &mut info, DIB_RGB_COLORS)
    };
    unsafe {
        let _ = SelectObject(memory_dc, previous);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory_dc);
        let _ = ReleaseDC(HWND::default(), screen_dc);
    }
    if rows != height { return Err("Windows returned an incomplete screenshot".into()); }

    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    for pixel in bgra.chunks_exact(4) {
        rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
    }
    let mut output = Cursor::new(Vec::new());
    {
        let mut encoder = png::Encoder::new(&mut output, width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder.write_header().map_err(|e| format!("Could not encode screenshot: {e}"))?;
        writer.write_image_data(&rgb).map_err(|e| format!("Could not encode screenshot: {e}"))?;
    }
    Ok(output.into_inner())
}
