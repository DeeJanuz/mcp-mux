use tauri::{Emitter, Manager};

#[derive(serde::Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct AppsPopupBounds {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppsPopupOpenResult {
    opened: bool,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppsPopupSelection {
    renderer_name: String,
    renderer_label: String,
}

const APPS_POPUP_LABEL: &str = "apps-popup";
const APPS_POPUP_MIN_WIDTH: f64 = 180.0;
const APPS_POPUP_MAX_WIDTH: f64 = 360.0;
const APPS_POPUP_MIN_HEIGHT: f64 = 80.0;
const APPS_POPUP_MAX_HEIGHT: f64 = 480.0;

pub(crate) fn should_use_native_apps_popup() -> bool {
    !cfg!(target_os = "windows")
}

pub(crate) fn sanitize_apps_popup_bounds(
    bounds: AppsPopupBounds,
) -> Result<AppsPopupBounds, String> {
    if !bounds.x.is_finite()
        || !bounds.y.is_finite()
        || !bounds.width.is_finite()
        || !bounds.height.is_finite()
    {
        return Err("Apps popup bounds must be finite numbers.".to_string());
    }

    Ok(AppsPopupBounds {
        x: bounds.x.clamp(-10_000.0, 10_000.0),
        y: bounds.y.clamp(-10_000.0, 10_000.0),
        width: bounds
            .width
            .clamp(APPS_POPUP_MIN_WIDTH, APPS_POPUP_MAX_WIDTH),
        height: bounds
            .height
            .clamp(APPS_POPUP_MIN_HEIGHT, APPS_POPUP_MAX_HEIGHT),
    })
}

fn apps_popup_screen_bounds<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    bounds: AppsPopupBounds,
) -> Result<AppsPopupBounds, String> {
    let bounds = sanitize_apps_popup_bounds(bounds)?;
    let scale_factor = window
        .scale_factor()
        .map_err(|err| format!("Failed to read MCPViews scale factor: {}", err))?;
    let origin = window
        .inner_position()
        .or_else(|_| window.outer_position())
        .map_err(|err| format!("Failed to read MCPViews window position: {}", err))?
        .to_logical::<f64>(scale_factor);

    Ok(AppsPopupBounds {
        x: origin.x + bounds.x,
        y: origin.y + bounds.y,
        width: bounds.width,
        height: bounds.height,
    })
}

pub(crate) fn close_apps_popup_window(app_handle: &tauri::AppHandle) -> Result<bool, String> {
    let Some(window) = app_handle.get_webview_window(APPS_POPUP_LABEL) else {
        return Ok(false);
    };
    window
        .close()
        .map_err(|err| format!("Failed to close apps popup: {}", err))?;
    Ok(true)
}

pub(crate) fn open_apps_popup(
    bounds: AppsPopupBounds,
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
) -> Result<AppsPopupOpenResult, String> {
    if !should_use_native_apps_popup() {
        return Ok(AppsPopupOpenResult { opened: false });
    }

    let bounds = apps_popup_screen_bounds(&window, bounds)?;
    if let Some(popup) = app_handle.get_webview_window(APPS_POPUP_LABEL) {
        popup
            .set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                bounds.x, bounds.y,
            )))
            .map_err(|err| format!("Failed to move apps popup: {}", err))?;
        popup
            .set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                bounds.width,
                bounds.height,
            )))
            .map_err(|err| format!("Failed to resize apps popup: {}", err))?;
        let _ = popup.show();
        let _ = popup.set_focus();
        return Ok(AppsPopupOpenResult { opened: true });
    }

    let builder = tauri::WebviewWindowBuilder::new(
        &app_handle,
        APPS_POPUP_LABEL,
        tauri::WebviewUrl::App("apps-popup.html".into()),
    )
    .title("Apps")
    .inner_size(bounds.width, bounds.height)
    .position(bounds.x, bounds.y)
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .shadow(true)
    .focused(true)
    .visible(true)
    .theme(Some(tauri::Theme::Light))
    .use_https_scheme(true)
    .parent(&window)
    .map_err(|err| format!("Failed to attach apps popup to MCPViews window: {}", err))?;

    let popup = builder
        .build()
        .map_err(|err| format!("Failed to open apps popup: {}", err))?;
    let close_handle = app_handle.clone();
    popup.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Focused(false)) {
            let _ = close_apps_popup_window(&close_handle);
        }
    });

    Ok(AppsPopupOpenResult { opened: true })
}

pub(crate) fn close_apps_popup(app_handle: tauri::AppHandle) -> Result<(), String> {
    close_apps_popup_window(&app_handle)?;
    Ok(())
}

pub(crate) fn select_apps_popup_renderer(
    selection: AppsPopupSelection,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if selection.renderer_name.trim().is_empty() {
        return Err("Apps popup renderer name is required.".to_string());
    }
    app_handle
        .emit_to("main", "apps-popup-select", &selection)
        .map_err(|err| format!("Failed to send apps popup selection: {}", err))?;
    close_apps_popup_window(&app_handle)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_apps_popup_bounds_clamps_dimensions() {
        let bounds = sanitize_apps_popup_bounds(AppsPopupBounds {
            x: -20_000.0,
            y: 20_000.0,
            width: 1.0,
            height: 10_000.0,
        })
        .unwrap();

        assert_eq!(bounds.x, -10_000.0);
        assert_eq!(bounds.y, 10_000.0);
        assert_eq!(bounds.width, APPS_POPUP_MIN_WIDTH);
        assert_eq!(bounds.height, APPS_POPUP_MAX_HEIGHT);
    }

    #[test]
    fn test_sanitize_apps_popup_bounds_rejects_non_finite_values() {
        let error = sanitize_apps_popup_bounds(AppsPopupBounds {
            x: 0.0,
            y: f64::INFINITY,
            width: 260.0,
            height: 360.0,
        })
        .expect_err("unexpectedly allowed non-finite apps popup bounds");

        assert!(error.contains("finite numbers"));
    }

    #[test]
    fn test_windows_uses_dom_apps_popup_fallback() {
        assert_eq!(should_use_native_apps_popup(), !cfg!(target_os = "windows"));
    }
}
