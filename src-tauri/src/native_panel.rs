use std::hash::{Hash, Hasher};
use std::sync::Arc;

use tauri::{Emitter, Manager};

use crate::state::AppState;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAppViewResult {
    pub(crate) label: String,
    pub(crate) url: String,
    pub(crate) created: bool,
}

#[derive(serde::Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct NativeAppPanelBounds {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) visible: Option<bool>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAppPanelUpdateResult {
    label: String,
    updated: bool,
    visible: bool,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWebTabOpenRequest {
    url: String,
    title: Option<String>,
    return_origins: Vec<String>,
    source_label: Option<String>,
}

const NATIVE_APP_PANEL_HIDDEN_X: f64 = -10_000.0;
const NATIVE_APP_PANEL_HIDDEN_Y: f64 = -10_000.0;
const NATIVE_APP_PANEL_HIDDEN_SIZE: f64 = 1.0;

pub(crate) fn parse_external_web_url(raw_url: &str) -> Result<url::Url, String> {
    let parsed =
        url::Url::parse(raw_url).map_err(|err| format!("Invalid external URL: {}", err))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        scheme => Err(format!("Unsupported external URL protocol: {}", scheme)),
    }
}

pub(crate) fn origin_for_url(url: &url::Url) -> Option<String> {
    if !matches!(url.scheme(), "http" | "https") || url.authority().is_empty() {
        return None;
    }
    Some(format!("{}://{}", url.scheme(), url.authority()))
}

pub(crate) fn is_url_allowed_for_plugin(url: &url::Url, allowed_origins: &[String]) -> bool {
    let Some(origin) = origin_for_url(url) else {
        return false;
    };
    allowed_origins
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(&origin))
}

pub(crate) fn parse_native_app_url(
    plugin_name: &str,
    raw_url: &str,
    allowed_origins: &[String],
) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw_url).map_err(|err| format!("Invalid app URL: {}", err))?;
    if origin_for_url(&parsed).is_none() {
        return Err(format!(
            "Unsupported app URL protocol for plugin '{}': {}",
            plugin_name,
            parsed.scheme()
        ));
    }
    if !is_url_allowed_for_plugin(&parsed, allowed_origins) {
        let origin = origin_for_url(&parsed).unwrap_or_else(|| parsed.as_str().to_string());
        return Err(format!(
            "App URL origin '{}' is not declared in frame_origins for plugin '{}'.",
            origin, plugin_name
        ));
    }
    Ok(parsed)
}

pub(crate) fn emit_external_web_tab_open_request(
    app_handle: &tauri::AppHandle,
    url: &url::Url,
    title: Option<String>,
    return_origins: Vec<String>,
    source_label: Option<String>,
) {
    if !matches!(url.scheme(), "http" | "https") {
        return;
    }
    let payload = ExternalWebTabOpenRequest {
        url: url.to_string(),
        title,
        return_origins,
        source_label,
    };
    if let Err(err) = app_handle.emit("external_web_tab_open_requested", payload) {
        eprintln!("[mcpviews] Failed to request external web tab: {}", err);
    }
}

pub(crate) fn sanitized_window_label_segment(value: &str) -> String {
    let mut segment = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            segment.push(ch.to_ascii_lowercase());
        } else if ch == '-' || ch == '_' {
            segment.push('-');
        } else if ch.is_ascii_whitespace() || ch == '/' || ch == ':' || ch == '.' {
            segment.push('-');
        }
        if segment.len() >= 48 {
            break;
        }
    }
    let segment = segment.trim_matches('-').to_string();
    if segment.is_empty() {
        "app".to_string()
    } else {
        segment
    }
}

pub(crate) fn native_app_window_label(
    plugin_name: &str,
    label: Option<&str>,
    fallback: &str,
) -> String {
    native_app_label("plugin-app", plugin_name, label, fallback)
}

pub(crate) fn native_app_panel_label(
    plugin_name: &str,
    label: Option<&str>,
    fallback: &str,
) -> String {
    native_app_label("plugin-panel", plugin_name, label, fallback)
}

pub(crate) fn native_app_label(
    prefix: &str,
    plugin_name: &str,
    label: Option<&str>,
    fallback: &str,
) -> String {
    let label_seed = label
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback);
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    plugin_name.hash(&mut hasher);
    label_seed.hash(&mut hasher);
    let hash = format!("{:x}", hasher.finish());
    let hash_suffix = hash.get(0..8).unwrap_or(&hash);
    format!(
        "{}-{}-{}-{}",
        prefix,
        sanitized_window_label_segment(plugin_name),
        sanitized_window_label_segment(label_seed),
        hash_suffix
    )
}

pub(crate) fn native_app_window_title(title: Option<&str>, plugin_name: &str) -> String {
    title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(96).collect())
        .unwrap_or_else(|| format!("{} App", plugin_name))
}

pub(crate) fn sanitize_native_app_panel_bounds(
    bounds: NativeAppPanelBounds,
) -> Result<NativeAppPanelBounds, String> {
    if !bounds.x.is_finite()
        || !bounds.y.is_finite()
        || !bounds.width.is_finite()
        || !bounds.height.is_finite()
    {
        return Err("Native app panel bounds must be finite numbers.".to_string());
    }

    let x = bounds.x.clamp(-10_000.0, 10_000.0);
    let y = bounds.y.clamp(-10_000.0, 10_000.0);
    let width = bounds.width.clamp(1.0, 10_000.0);
    let height = bounds.height.clamp(1.0, 10_000.0);

    Ok(NativeAppPanelBounds {
        x,
        y,
        width,
        height,
        visible: bounds.visible,
    })
}

pub(crate) fn effective_native_app_panel_bounds(
    bounds: NativeAppPanelBounds,
) -> Result<(NativeAppPanelBounds, bool), String> {
    let bounds = sanitize_native_app_panel_bounds(bounds)?;
    let visible = bounds.visible.unwrap_or(true) && bounds.width >= 2.0 && bounds.height >= 2.0;

    if visible {
        return Ok((bounds, true));
    }

    Ok((
        NativeAppPanelBounds {
            x: NATIVE_APP_PANEL_HIDDEN_X,
            y: NATIVE_APP_PANEL_HIDDEN_Y,
            width: NATIVE_APP_PANEL_HIDDEN_SIZE,
            height: NATIVE_APP_PANEL_HIDDEN_SIZE,
            visible: Some(false),
        },
        false,
    ))
}

pub(crate) fn apply_native_app_panel_bounds<R: tauri::Runtime>(
    webview: &tauri::Webview<R>,
    bounds: NativeAppPanelBounds,
) -> Result<bool, String> {
    let (bounds, visible) = effective_native_app_panel_bounds(bounds)?;

    webview
        .set_bounds(tauri::Rect {
            position: tauri::Position::Logical(tauri::LogicalPosition::new(bounds.x, bounds.y)),
            size: tauri::Size::Logical(tauri::LogicalSize::new(bounds.width, bounds.height)),
        })
        .map_err(|err| format!("Failed to update native app panel bounds: {}", err))?;

    if visible {
        webview
            .show()
            .map_err(|err| format!("Failed to show native app panel: {}", err))?;
    } else {
        webview
            .hide()
            .map_err(|err| format!("Failed to hide native app panel: {}", err))?;
    }

    Ok(visible)
}

pub(crate) fn open_native_app_view(
    plugin_name: String,
    url: String,
    title: Option<String>,
    label: Option<String>,
    state: &Arc<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<NativeAppViewResult, String> {
    let plugin_name = plugin_name.trim();
    if plugin_name.is_empty() {
        return Err("Plugin name is required.".to_string());
    }

    let allowed_origins = state.plugin_frame_origins_for(plugin_name);
    if allowed_origins.is_empty() {
        return Err(format!(
            "Plugin '{}' has no frame_origins app allowlist.",
            plugin_name
        ));
    }

    let parsed = parse_native_app_url(plugin_name, &url, &allowed_origins)?;
    let window_label = native_app_window_label(plugin_name, label.as_deref(), parsed.as_str());
    let window_title = native_app_window_title(title.as_deref(), plugin_name);

    if let Some(window) = app_handle.get_webview_window(&window_label) {
        window
            .navigate(parsed.clone())
            .map_err(|err| format!("Failed to navigate native app view: {}", err))?;
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(NativeAppViewResult {
            label: window_label,
            url: parsed.to_string(),
            created: false,
        });
    }

    let navigation_allowed_origins = allowed_origins.clone();
    let navigation_plugin_name = plugin_name.to_string();
    let navigation_app_handle = app_handle.clone();
    let navigation_source_label = window_label.clone();
    tauri::WebviewWindowBuilder::new(
        &app_handle,
        &window_label,
        tauri::WebviewUrl::External(parsed.clone()),
    )
    .title(window_title)
    .inner_size(1280.0, 900.0)
    .resizable(true)
    .theme(Some(tauri::Theme::Light))
    .on_download(crate::file_download::download_handler(
        "native-app-window",
        app_handle.clone(),
    ))
    .on_navigation(move |navigation_url| {
        let allowed = is_url_allowed_for_plugin(navigation_url, &navigation_allowed_origins);
        if !allowed {
            emit_external_web_tab_open_request(
                &navigation_app_handle,
                navigation_url,
                None,
                navigation_allowed_origins.clone(),
                Some(navigation_source_label.clone()),
            );
            eprintln!(
                "[mcpviews] Blocked native plugin app navigation for {}: {}",
                navigation_plugin_name, navigation_url
            );
        }
        allowed
    })
    .build()
    .map_err(|err| format!("Failed to open native app view: {}", err))?;

    Ok(NativeAppViewResult {
        label: window_label,
        url: parsed.to_string(),
        created: true,
    })
}

pub(crate) fn mount_native_app_panel(
    plugin_name: String,
    url: String,
    title: Option<String>,
    label: Option<String>,
    bounds: NativeAppPanelBounds,
    state: &Arc<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<NativeAppViewResult, String> {
    let plugin_name = plugin_name.trim();
    if plugin_name.is_empty() {
        return Err("Plugin name is required.".to_string());
    }

    let allowed_origins = state.plugin_frame_origins_for(plugin_name);
    if allowed_origins.is_empty() {
        return Err(format!(
            "Plugin '{}' has no frame_origins app allowlist.",
            plugin_name
        ));
    }

    let parsed = parse_native_app_url(plugin_name, &url, &allowed_origins)?;
    let panel_label = native_app_panel_label(plugin_name, label.as_deref(), parsed.as_str());

    if let Some(webview) = app_handle.get_webview(&panel_label) {
        webview
            .navigate(parsed.clone())
            .map_err(|err| format!("Failed to navigate native app panel: {}", err))?;
        apply_native_app_panel_bounds(&webview, bounds)?;
        return Ok(NativeAppViewResult {
            label: panel_label,
            url: parsed.to_string(),
            created: false,
        });
    }

    let main_window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "Main MCPViews window is not available.".to_string())?;

    let navigation_allowed_origins = allowed_origins.clone();
    let navigation_plugin_name = plugin_name.to_string();
    let navigation_app_handle = app_handle.clone();
    let navigation_source_label = panel_label.clone();
    let webview_builder = tauri::webview::WebviewBuilder::new(
        &panel_label,
        tauri::WebviewUrl::External(parsed.clone()),
    )
    .accept_first_mouse(true)
    .on_download(crate::file_download::download_handler(
        "native-app-panel",
        app_handle.clone(),
    ))
    .on_navigation(move |navigation_url| {
        let allowed = is_url_allowed_for_plugin(navigation_url, &navigation_allowed_origins);
        if !allowed {
            emit_external_web_tab_open_request(
                &navigation_app_handle,
                navigation_url,
                None,
                navigation_allowed_origins.clone(),
                Some(navigation_source_label.clone()),
            );
            eprintln!(
                "[mcpviews] Blocked native plugin app panel navigation for {}: {}",
                navigation_plugin_name, navigation_url
            );
        }
        allowed
    });

    let bounds = sanitize_native_app_panel_bounds(bounds)?;
    let webview = main_window
        .as_ref()
        .window()
        .add_child(
            webview_builder,
            tauri::LogicalPosition::new(bounds.x, bounds.y),
            tauri::LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|err| {
            format!(
                "Failed to mount native app panel '{}': {}",
                native_app_window_title(title.as_deref(), plugin_name),
                err
            )
        })?;
    apply_native_app_panel_bounds(&webview, bounds)?;

    Ok(NativeAppViewResult {
        label: panel_label,
        url: parsed.to_string(),
        created: true,
    })
}

pub(crate) fn update_native_app_panel_bounds(
    label: String,
    bounds: NativeAppPanelBounds,
    app_handle: tauri::AppHandle,
) -> Result<NativeAppPanelUpdateResult, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("Native app panel label is required.".to_string());
    }
    let Some(webview) = app_handle.get_webview(label) else {
        return Ok(NativeAppPanelUpdateResult {
            label: label.to_string(),
            updated: false,
            visible: false,
        });
    };

    let visible = apply_native_app_panel_bounds(&webview, bounds)?;
    Ok(NativeAppPanelUpdateResult {
        label: label.to_string(),
        updated: true,
        visible,
    })
}

pub(crate) fn close_native_app_panel(
    label: String,
    app_handle: tauri::AppHandle,
) -> Result<NativeAppPanelUpdateResult, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("Native app panel label is required.".to_string());
    }
    let Some(webview) = app_handle.get_webview(label) else {
        return Ok(NativeAppPanelUpdateResult {
            label: label.to_string(),
            updated: false,
            visible: false,
        });
    };

    webview
        .close()
        .map_err(|err| format!("Failed to close native app panel: {}", err))?;
    Ok(NativeAppPanelUpdateResult {
        label: label.to_string(),
        updated: true,
        visible: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_native_app_url_allows_declared_origin() {
        let origins = vec!["https://staging.app.ludflow.com".to_string()];
        let parsed = parse_native_app_url(
            "ludflow",
            "https://staging.app.ludflow.com/mcpviews/embed/start?token=test",
            &origins,
        )
        .unwrap();
        assert_eq!(
            origin_for_url(&parsed).as_deref(),
            Some("https://staging.app.ludflow.com")
        );
    }

    #[test]
    fn test_parse_native_app_url_rejects_undeclared_origin() {
        let origins = vec!["https://staging.app.ludflow.com".to_string()];
        let error = parse_native_app_url("ludflow", "https://example.com/", &origins)
            .expect_err("unexpectedly allowed undeclared origin");
        assert!(error.contains("not declared in frame_origins"));
    }

    #[test]
    fn test_parse_native_app_url_rejects_non_http_scheme() {
        let origins = vec!["https://staging.app.ludflow.com".to_string()];
        let error = parse_native_app_url("ludflow", "javascript:alert(1)", &origins)
            .expect_err("unexpectedly allowed javascript URL");
        assert!(error.contains("Unsupported app URL protocol"));
    }

    #[test]
    fn test_parse_external_web_url_allows_http_urls() {
        let parsed = parse_external_web_url("https://billing.stripe.com/session/test").unwrap();
        assert_eq!(parsed.scheme(), "https");
        assert_eq!(parsed.host_str(), Some("billing.stripe.com"));
    }

    #[test]
    fn test_parse_external_web_url_rejects_non_http_scheme() {
        let error = parse_external_web_url("javascript:alert(1)")
            .expect_err("unexpectedly allowed javascript URL");
        assert!(error.contains("Unsupported external URL protocol"));
    }

    #[test]
    fn test_native_app_window_label_is_stable_and_sanitized() {
        let first = native_app_window_label("ludflow", Some("Data Governance"), "/ignored");
        let second = native_app_window_label("ludflow", Some("Data Governance"), "/other");
        assert_eq!(first, second);
        assert!(first.starts_with("plugin-app-ludflow-data-governance-"));
    }

    #[test]
    fn test_native_app_panel_label_is_distinct_from_window_label() {
        let window = native_app_window_label("ludflow", Some("Documents"), "/ignored");
        let panel = native_app_panel_label("ludflow", Some("Documents"), "/ignored");

        assert_ne!(window, panel);
        assert!(panel.starts_with("plugin-panel-ludflow-documents-"));
    }

    #[test]
    fn test_sanitize_native_app_panel_bounds_clamps_dimensions() {
        let bounds = sanitize_native_app_panel_bounds(NativeAppPanelBounds {
            x: -20_000.0,
            y: 20_000.0,
            width: 0.0,
            height: 25_000.0,
            visible: Some(true),
        })
        .unwrap();

        assert_eq!(bounds.x, -10_000.0);
        assert_eq!(bounds.y, 10_000.0);
        assert_eq!(bounds.width, 1.0);
        assert_eq!(bounds.height, 10_000.0);
        assert_eq!(bounds.visible, Some(true));
    }

    #[test]
    fn test_sanitize_native_app_panel_bounds_rejects_non_finite_values() {
        let error = sanitize_native_app_panel_bounds(NativeAppPanelBounds {
            x: f64::NAN,
            y: 0.0,
            width: 100.0,
            height: 100.0,
            visible: Some(true),
        })
        .expect_err("unexpectedly allowed non-finite bounds");

        assert!(error.contains("finite numbers"));
    }

    #[test]
    fn test_effective_native_app_panel_bounds_preserves_visible_bounds() {
        let (bounds, visible) = effective_native_app_panel_bounds(NativeAppPanelBounds {
            x: 12.0,
            y: 24.0,
            width: 320.0,
            height: 240.0,
            visible: Some(true),
        })
        .unwrap();

        assert!(visible);
        assert_eq!(bounds.x, 12.0);
        assert_eq!(bounds.y, 24.0);
        assert_eq!(bounds.width, 320.0);
        assert_eq!(bounds.height, 240.0);
        assert_eq!(bounds.visible, Some(true));
    }

    #[test]
    fn test_effective_native_app_panel_bounds_moves_hidden_bounds_offscreen() {
        let (bounds, visible) = effective_native_app_panel_bounds(NativeAppPanelBounds {
            x: 12.0,
            y: 24.0,
            width: 320.0,
            height: 240.0,
            visible: Some(false),
        })
        .unwrap();

        assert!(!visible);
        assert_eq!(bounds.x, NATIVE_APP_PANEL_HIDDEN_X);
        assert_eq!(bounds.y, NATIVE_APP_PANEL_HIDDEN_Y);
        assert_eq!(bounds.width, NATIVE_APP_PANEL_HIDDEN_SIZE);
        assert_eq!(bounds.height, NATIVE_APP_PANEL_HIDDEN_SIZE);
        assert_eq!(bounds.visible, Some(false));
    }

    #[test]
    fn test_effective_native_app_panel_bounds_moves_tiny_bounds_offscreen() {
        let (bounds, visible) = effective_native_app_panel_bounds(NativeAppPanelBounds {
            x: 12.0,
            y: 24.0,
            width: 1.0,
            height: 240.0,
            visible: Some(true),
        })
        .unwrap();

        assert!(!visible);
        assert_eq!(bounds.x, NATIVE_APP_PANEL_HIDDEN_X);
        assert_eq!(bounds.y, NATIVE_APP_PANEL_HIDDEN_Y);
        assert_eq!(bounds.width, NATIVE_APP_PANEL_HIDDEN_SIZE);
        assert_eq!(bounds.height, NATIVE_APP_PANEL_HIDDEN_SIZE);
    }
}
