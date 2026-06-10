use tauri::{Emitter, Manager};

use crate::native_panel::{
    apply_native_app_panel_bounds, native_app_label, native_app_window_title,
    parse_external_web_url, NativeAppPanelBounds, NativeAppViewResult,
};

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWebPanelCloseRequest {
    label: String,
    session_id: Option<String>,
    url: Option<String>,
}

pub(crate) fn normalize_return_origins(raw_origins: Option<Vec<String>>) -> Vec<String> {
    let mut origins = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw_origin in raw_origins.unwrap_or_default() {
        let trimmed = raw_origin.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed = url::Url::parse(trimmed).ok();
        let origin = parsed
            .as_ref()
            .and_then(crate::native_panel::origin_for_url)
            .or_else(|| {
                if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                    Some(trimmed.trim_end_matches('/').to_string())
                } else {
                    None
                }
            });
        let Some(origin) = origin else {
            continue;
        };
        let key = origin.to_ascii_lowercase();
        if seen.insert(key) {
            origins.push(origin);
        }
    }
    origins
}

pub(crate) fn is_stripe_web_url(url: &url::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    host == "stripe.com" || host.ends_with(".stripe.com")
}

pub(crate) fn external_web_panel_label(
    label: Option<&str>,
    session_id: Option<&str>,
    fallback: &str,
) -> String {
    let label_seed = label
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| session_id.map(str::trim).filter(|value| !value.is_empty()))
        .unwrap_or(fallback);
    native_app_label("external-panel", "web", Some(label_seed), fallback)
}

pub(crate) fn emit_external_web_panel_close_request(
    app_handle: &tauri::AppHandle,
    label: String,
    session_id: Option<String>,
    url: Option<String>,
) {
    let payload = ExternalWebPanelCloseRequest {
        label,
        session_id,
        url,
    };
    if let Err(err) = app_handle.emit("external_web_panel_close_requested", payload) {
        eprintln!(
            "[mcpviews] Failed to request external web panel close: {}",
            err
        );
    }
}

pub(crate) fn external_web_panel_init_script(
    label: &str,
    session_id: Option<&str>,
    return_origins: &[String],
    arm_any_non_stripe_return: bool,
) -> String {
    let label_json = serde_json::to_string(label).unwrap_or_else(|_| "\"\"".to_string());
    let session_id_json =
        serde_json::to_string(&session_id.unwrap_or("")).unwrap_or_else(|_| "\"\"".to_string());
    let return_origins_json =
        serde_json::to_string(return_origins).unwrap_or_else(|_| "[]".to_string());
    let arm_any_non_stripe_return = if arm_any_non_stripe_return {
        "true"
    } else {
        "false"
    };

    format!(
        r#"(function() {{
  var label = {label_json};
  var sessionId = {session_id_json};
  var returnOrigins = {return_origins_json};
  var armAnyNonStripeReturn = {arm_any_non_stripe_return};
  var armed = false;
  function isStripeHost(host) {{
    host = String(host || '').toLowerCase();
    return host === 'stripe.com' || host.endsWith('.stripe.com');
  }}
  function currentOrigin() {{
    try {{ return window.location.origin || ''; }} catch (_error) {{ return ''; }}
  }}
  function shouldArmCloseSentinel() {{
    var origin = currentOrigin();
    if (origin && returnOrigins.indexOf(origin) !== -1) return true;
    if (!armAnyNonStripeReturn) return false;
    try {{ return !isStripeHost(window.location.hostname); }} catch (_error) {{ return false; }}
  }}
  function closePanel() {{
    var closeUrl = 'mcpviews-external-tab://close/' + encodeURIComponent(label || 'external');
    if (sessionId) closeUrl += '?sessionId=' + encodeURIComponent(sessionId);
    try {{ window.location.href = closeUrl; }} catch (_error) {{}}
  }}
  function armBackClose() {{
    if (armed || !shouldArmCloseSentinel()) return;
    armed = true;
    try {{
      var state = history.state && typeof history.state === 'object' ? Object.assign({{}}, history.state) : {{}};
      state.__mcpviewsExternalReturnPage = true;
      history.replaceState(state, document.title, window.location.href);
      history.pushState({{ __mcpviewsExternalReturnSentinel: true }}, document.title, window.location.href);
    }} catch (_error) {{}}
  }}
  window.addEventListener('popstate', function () {{
    if (shouldArmCloseSentinel()) closePanel();
  }});
  document.addEventListener('keydown', function (event) {{
    if (!shouldArmCloseSentinel()) return;
    var key = event.key || '';
    if (key === 'BrowserBack' || (key === 'ArrowLeft' && (event.metaKey || event.ctrlKey || event.altKey))) {{
      event.preventDefault();
      closePanel();
    }}
  }}, true);
  window.addEventListener('pageshow', armBackClose);
  window.addEventListener('load', armBackClose);
  setTimeout(armBackClose, 0);
}})();"#
    )
}

pub(crate) fn mount_external_web_panel(
    url: String,
    title: Option<String>,
    label: Option<String>,
    session_id: Option<String>,
    return_origins: Option<Vec<String>>,
    bounds: NativeAppPanelBounds,
    app_handle: tauri::AppHandle,
) -> Result<NativeAppViewResult, String> {
    let parsed = parse_external_web_url(&url)?;
    let normalized_return_origins = normalize_return_origins(return_origins);
    let panel_label =
        external_web_panel_label(label.as_deref(), session_id.as_deref(), parsed.as_str());

    if let Some(webview) = app_handle.get_webview(&panel_label) {
        webview
            .navigate(parsed.clone())
            .map_err(|err| format!("Failed to navigate external web panel: {}", err))?;
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

    let navigation_app_handle = app_handle.clone();
    let navigation_label = panel_label.clone();
    let navigation_session_id = session_id.clone();
    let init_script = external_web_panel_init_script(
        &panel_label,
        session_id.as_deref(),
        &normalized_return_origins,
        is_stripe_web_url(&parsed),
    );

    let webview_builder = tauri::webview::WebviewBuilder::new(
        &panel_label,
        tauri::WebviewUrl::External(parsed.clone()),
    )
    .accept_first_mouse(true)
    .initialization_script(init_script)
    .on_navigation(move |navigation_url| match navigation_url.scheme() {
        "http" | "https" => true,
        "mcpviews-external-tab" => {
            emit_external_web_panel_close_request(
                &navigation_app_handle,
                navigation_label.clone(),
                navigation_session_id.clone(),
                Some(navigation_url.to_string()),
            );
            false
        }
        scheme => {
            eprintln!(
                "[mcpviews] Blocked external web panel navigation with unsupported scheme '{}': {}",
                scheme, navigation_url
            );
            false
        }
    });

    let bounds = crate::native_panel::sanitize_native_app_panel_bounds(bounds)?;
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
                "Failed to mount external web panel '{}': {}",
                native_app_window_title(title.as_deref(), "External"),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_return_origins_deduplicates_and_strips_paths() {
        let origins = normalize_return_origins(Some(vec![
            "https://app.ludflow.com/settings/organization".to_string(),
            "https://app.ludflow.com".to_string(),
            "not a url".to_string(),
            "https://app.decidr.com/billing".to_string(),
        ]));

        assert_eq!(
            origins,
            vec![
                "https://app.ludflow.com".to_string(),
                "https://app.decidr.com".to_string()
            ]
        );
    }

    #[test]
    fn test_external_web_panel_init_script_contains_close_sentinel() {
        let script = external_web_panel_init_script(
            "external-panel-test",
            Some("session-123"),
            &["https://app.ludflow.com".to_string()],
            true,
        );

        assert!(script.contains("mcpviews-external-tab://close/"));
        assert!(script.contains("session-123"));
        assert!(script.contains("https://app.ludflow.com"));
        assert!(script.contains("armAnyNonStripeReturn = true"));
    }
}
