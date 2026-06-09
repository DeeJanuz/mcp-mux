use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex as TokioMutex;

use mcpviews_shared::{PluginAuth, PluginInfo, PluginManifest, RegistryEntry, RegistrySource};

use crate::renderer_scanner::RendererInfo;

use crate::http_server::AsyncAppState;
use crate::review::ReviewDecision;
use crate::session::{sanitize_renderer_meta, PreviewSession};
use crate::state::{AppState, CURRENT_PERSONA_STUDIO_PLUGIN, LEGACY_PERSONA_STUDIO_PLUGIN};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedFileBytes {
    content_base64: String,
    content_type: Option<String>,
    content_disposition: Option<String>,
}

#[derive(serde::Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(serde::Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: Option<String>,
    prerelease: bool,
    draft: bool,
    published_at: Option<String>,
    assets: Vec<GithubReleaseAsset>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPrereleaseInfo {
    name: String,
    version: String,
    tag: String,
    download_url: String,
    release_url: Option<String>,
    installed_version: Option<String>,
    installed_prerelease: bool,
    stable_version: Option<String>,
    update_available: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAppViewResult {
    label: String,
    url: String,
    created: bool,
}

#[derive(serde::Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct NativeAppPanelBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: Option<bool>,
}

const NATIVE_APP_PANEL_HIDDEN_X: f64 = -10_000.0;
const NATIVE_APP_PANEL_HIDDEN_Y: f64 = -10_000.0;
const NATIVE_APP_PANEL_HIDDEN_SIZE: f64 = 1.0;

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

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWebPanelCloseRequest {
    label: String,
    session_id: Option<String>,
    url: Option<String>,
}

#[tauri::command]
pub fn get_sessions(state: State<Arc<AppState>>) -> Vec<PreviewSession> {
    let sessions = state.sessions.lock().unwrap();
    sessions.get_all()
}

async fn post_backend_review_callback(
    client: reqwest::Client,
    callback: serde_json::Value,
    decision: &ReviewDecision,
) -> Result<(), String> {
    let Some(url) = callback.get("url").and_then(|value| value.as_str()) else {
        return Ok(());
    };
    let Some(token) = callback.get("token").and_then(|value| value.as_str()) else {
        return Err("Backend review callback is missing a token.".to_string());
    };
    let response = client
        .post(url)
        .bearer_auth(token)
        .json(decision)
        .send()
        .await
        .map_err(|err| format!("Failed to submit backend review callback: {}", err))?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Backend review callback returned HTTP {}: {}",
            status, body
        ));
    }
    Ok(())
}

fn build_review_decision(
    session_id: String,
    decision: String,
    operation_decisions: Option<HashMap<String, String>>,
    comments: Option<HashMap<String, String>>,
    modifications: Option<HashMap<String, String>>,
    additions: Option<serde_json::Value>,
    suggestion_decisions: Option<HashMap<String, serde_json::Value>>,
    table_decisions: Option<HashMap<String, serde_json::Value>>,
) -> ReviewDecision {
    let overall_decision =
        if operation_decisions.is_some() && decision != "accept" && decision != "reject" {
            "partial".to_string()
        } else {
            decision.clone()
        };

    ReviewDecision {
        session_id,
        status: "decision_received".to_string(),
        decision: Some(overall_decision),
        operation_decisions,
        comments,
        modifications,
        additions,
        suggestion_decisions,
        table_decisions,
    }
}

fn resolve_local_review_decision(
    state: &Arc<AppState>,
    session_id: &str,
    review_decision: ReviewDecision,
) -> Option<serde_json::Value> {
    let backend_callback = {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.get_mut(session_id).map(|session| {
            let callback = session
                .backend_callback
                .clone()
                .or_else(|| session.meta.get("backendCallback").cloned())
                .or_else(|| session.meta.get("backend_callback").cloned());
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            session.meta = sanitize_renderer_meta(session.meta.clone());
            session.decided_at = Some(now);
            session.decision = review_decision.decision.clone();
            session.operation_decisions = review_decision.operation_decisions.clone();
            session.comments = review_decision.comments.clone();
            session.modifications = review_decision.modifications.clone();
            session.additions = review_decision.additions.clone();
            session.suggestion_decisions = review_decision.suggestion_decisions.clone();
            session.table_decisions = review_decision.table_decisions.clone();
            callback
        })
    }
    .flatten();

    let mut reviews = state.reviews.lock().unwrap();
    reviews.resolve(session_id, review_decision);

    backend_callback
}

#[tauri::command]
pub async fn submit_decision(
    session_id: String,
    decision: String,
    operation_decisions: Option<HashMap<String, String>>,
    comments: Option<HashMap<String, String>>,
    modifications: Option<HashMap<String, String>>,
    additions: Option<serde_json::Value>,
    suggestion_decisions: Option<HashMap<String, serde_json::Value>>,
    table_decisions: Option<HashMap<String, serde_json::Value>>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let review_decision = build_review_decision(
        session_id.clone(),
        decision.clone(),
        operation_decisions.clone(),
        comments,
        modifications,
        additions,
        suggestion_decisions,
        table_decisions,
    );
    let backend_callback =
        resolve_local_review_decision(state.inner(), &session_id, review_decision.clone());

    if let Some(callback) = backend_callback {
        post_backend_review_callback(state.http_client.clone(), callback, &review_decision).await?;
    }

    Ok(())
}

#[tauri::command]
pub fn dismiss_session(session_id: String, state: State<Arc<AppState>>) -> Result<(), String> {
    // Remove session
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.delete(&session_id);
    }

    // Dismiss any pending review
    {
        let mut reviews = state.reviews.lock().unwrap();
        reviews.dismiss(&session_id);
    }

    Ok(())
}

#[tauri::command]
pub fn get_health() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "status": "ok"
    })
}

#[tauri::command]
pub async fn check_app_update(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<crate::app_update::AppUpdateInfo>, String> {
    crate::app_update::check_for_update(&state.http_client, env!("CARGO_PKG_VERSION")).await
}

#[tauri::command]
pub async fn install_app_update(
    update_json_url: String,
    app_handle: tauri::AppHandle,
) -> Result<crate::app_update::InstallAppUpdateResult, String> {
    crate::app_update::install_and_relaunch(app_handle, update_json_url).await
}

fn open_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(url).spawn();

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(url).spawn();

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    let result: Result<std::process::Child, std::io::Error> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "Unsupported platform",
    ));

    result.map_err(|e| format!("Failed to open browser: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => open_system_browser(parsed.as_str()),
        scheme => Err(format!("Unsupported URL protocol: {}", scheme)),
    }
}

fn parse_external_web_url(raw_url: &str) -> Result<url::Url, String> {
    let parsed =
        url::Url::parse(raw_url).map_err(|err| format!("Invalid external URL: {}", err))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        scheme => Err(format!("Unsupported external URL protocol: {}", scheme)),
    }
}

fn origin_for_url(url: &url::Url) -> Option<String> {
    if !matches!(url.scheme(), "http" | "https") || url.authority().is_empty() {
        return None;
    }
    Some(format!("{}://{}", url.scheme(), url.authority()))
}

fn is_url_allowed_for_plugin(url: &url::Url, allowed_origins: &[String]) -> bool {
    let Some(origin) = origin_for_url(url) else {
        return false;
    };
    allowed_origins
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(&origin))
}

fn parse_native_app_url(
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

fn normalize_return_origins(raw_origins: Option<Vec<String>>) -> Vec<String> {
    let mut origins = Vec::new();
    let mut seen = HashSet::new();
    for raw_origin in raw_origins.unwrap_or_default() {
        let trimmed = raw_origin.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed = url::Url::parse(trimmed).ok();
        let origin = parsed.as_ref().and_then(origin_for_url).or_else(|| {
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

fn is_stripe_web_url(url: &url::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    host == "stripe.com" || host.ends_with(".stripe.com")
}

fn emit_external_web_tab_open_request(
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

fn emit_external_web_panel_close_request(
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

fn sanitized_window_label_segment(value: &str) -> String {
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

fn native_app_window_label(plugin_name: &str, label: Option<&str>, fallback: &str) -> String {
    native_app_label("plugin-app", plugin_name, label, fallback)
}

fn native_app_panel_label(plugin_name: &str, label: Option<&str>, fallback: &str) -> String {
    native_app_label("plugin-panel", plugin_name, label, fallback)
}

fn external_web_panel_label(
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

fn native_app_label(
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

fn native_app_window_title(title: Option<&str>, plugin_name: &str) -> String {
    title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(96).collect())
        .unwrap_or_else(|| format!("{} App", plugin_name))
}

fn external_web_panel_init_script(
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

fn sanitize_native_app_panel_bounds(
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

fn apply_native_app_panel_bounds<R: tauri::Runtime>(
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

fn effective_native_app_panel_bounds(
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

#[tauri::command]
pub fn open_native_app_view(
    plugin_name: String,
    url: String,
    title: Option<String>,
    label: Option<String>,
    state: State<'_, Arc<AppState>>,
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

#[tauri::command]
pub fn mount_native_app_panel(
    plugin_name: String,
    url: String,
    title: Option<String>,
    label: Option<String>,
    bounds: NativeAppPanelBounds,
    state: State<'_, Arc<AppState>>,
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

#[tauri::command]
pub fn mount_external_web_panel(
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

#[tauri::command]
pub fn update_native_app_panel_bounds(
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

#[tauri::command]
pub fn close_native_app_panel(
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

#[tauri::command]
pub fn list_plugins(state: State<'_, Arc<AppState>>) -> Vec<PluginInfo> {
    let registry = state.plugin_registry.lock().unwrap();
    let cached = state.latest_registry.lock().unwrap();
    registry.list_plugins_with_updates(&cached)
}

#[tauri::command]
pub fn install_plugin(
    manifest_json: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let manifest: PluginManifest =
        serde_json::from_str(&manifest_json).map_err(|e| format!("Invalid manifest: {}", e))?;
    let mut registry = state.plugin_registry.lock().unwrap();
    registry.add_plugin(manifest)?;
    drop(registry);
    state.notify_tools_changed();
    Ok(())
}

#[tauri::command]
pub fn uninstall_plugin(name: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let mut registry = state.plugin_registry.lock().unwrap();
    registry.remove_plugin(&name)?;
    drop(registry);
    // Clean up any stored auth tokens for this plugin
    let _ = mcpviews_shared::token_store::remove_token(&mcpviews_shared::auth_dir(), &name);
    state.notify_tools_changed();
    Ok(())
}

#[tauri::command]
pub fn install_plugin_from_file(
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    let manifest: PluginManifest =
        serde_json::from_str(&content).map_err(|e| format!("Invalid manifest: {}", e))?;
    let mut registry = state.plugin_registry.lock().unwrap();
    registry.add_plugin(manifest)?;
    drop(registry);
    state.notify_tools_changed();
    Ok(())
}

#[tauri::command]
pub async fn fetch_registry(
    registry_url: Option<String>,
    force_refresh: Option<bool>,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<RegistryEntry>, String> {
    let client = state.http_client.clone();
    let force_refresh = force_refresh.unwrap_or(false);
    let entries = if let Some(url) = registry_url {
        // Specific URL provided (e.g. from legacy settings)
        crate::registry::fetch_registry_with_force(&client, &url, force_refresh).await?
    } else {
        // Use all configured sources
        let sources = mcpviews_shared::registry::get_registry_sources();
        mcpviews_shared::registry::fetch_all_registries_with_force(&client, &sources, force_refresh)
            .await?
    };

    // Cache the latest registry entries
    {
        let mut cached = state.latest_registry.lock().unwrap();
        *cached = entries.clone();
    }

    Ok(entries)
}

#[tauri::command]
pub fn get_registry_sources() -> Vec<RegistrySource> {
    mcpviews_shared::registry::get_registry_sources()
}

#[tauri::command]
pub fn add_registry_source(name: String, url: String) -> Result<(), String> {
    let mut sources = mcpviews_shared::registry::get_registry_sources();
    if sources.iter().any(|s| s.url == url) {
        return Err("A source with this URL already exists".to_string());
    }
    sources.push(RegistrySource {
        name,
        url,
        enabled: true,
    });
    mcpviews_shared::registry::save_registry_sources(&sources)
}

#[tauri::command]
pub fn remove_registry_source(url: String) -> Result<(), String> {
    let mut sources = mcpviews_shared::registry::get_registry_sources();
    sources.retain(|s| s.url != url);
    mcpviews_shared::registry::save_registry_sources(&sources)
}

#[tauri::command]
pub fn toggle_registry_source(url: String) -> Result<(), String> {
    let mut sources = mcpviews_shared::registry::get_registry_sources();
    if let Some(source) = sources.iter_mut().find(|s| s.url == url) {
        source.enabled = !source.enabled;
    }
    mcpviews_shared::registry::save_registry_sources(&sources)
}

#[tauri::command]
pub async fn start_plugin_auth(
    plugin_name: String,
    org_id: Option<String>,
    auth_flow: Option<String>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let auth = {
        let registry = state.plugin_registry.lock().unwrap();
        registry.resolve_plugin_auth(&plugin_name)?
    };

    let client = state.http_client.clone();

    match &auth {
        PluginAuth::OAuth {
            client_id,
            auth_url,
            token_url,
            scopes,
            ..
        } => {
            let requested_flow = auth_flow
                .as_deref()
                .unwrap_or(if auth.supports_email_code() {
                    "email_code"
                } else {
                    "browser"
                });
            if requested_flow != "browser" {
                if auth.supports_email_code() {
                    let async_state = Arc::new(TokioMutex::new(AsyncAppState {
                        inner: state.inner().clone(),
                        app_handle,
                    }));
                    let session_id = crate::mcp_registry_tools::open_plugin_email_code_session(
                        &plugin_name,
                        org_id.as_deref(),
                        &async_state,
                    )
                    .await?;
                    return Ok(format!(
                        "Opened email-code authentication for '{}' in MCPViews session '{}'.",
                        plugin_name, session_id
                    ));
                }
                return Err(format!(
                    "Plugin '{}' does not declare email-code authentication. Retry with authFlow='browser' for the OAuth fallback.",
                    plugin_name
                ));
            }
            crate::auth::start_oauth_flow(
                &plugin_name,
                client_id.as_deref(),
                auth_url,
                token_url,
                scopes,
                &client,
                org_id.as_deref(),
            )
            .await
        }
        PluginAuth::Bearer { token_env } => std::env::var(token_env).map_err(|_| {
            format!(
                "Environment variable '{}' is not set. Set it and restart.",
                token_env
            )
        }),
        PluginAuth::ApiKey { key_env, .. } => {
            if let Some(env_var) = key_env {
                std::env::var(env_var).map_err(|_| {
                    format!(
                        "Environment variable '{}' is not set. Set it and restart.",
                        env_var
                    )
                })
            } else {
                Err("No key_env configured for this plugin".to_string())
            }
        }
    }
}

#[tauri::command]
pub async fn send_plugin_email_code(
    plugin_name: String,
    email: String,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    crate::plugin_email_auth::send_email_code(&plugin_name, &email, state.inner()).await
}

#[tauri::command]
pub async fn verify_plugin_email_code(
    plugin_name: String,
    email: String,
    code: String,
    organization_id: Option<String>,
    organization_name: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    crate::plugin_email_auth::verify_email_code(
        &plugin_name,
        &email,
        &code,
        organization_id.as_deref(),
        organization_name.as_deref(),
        state.inner(),
    )
    .await
}

#[tauri::command]
pub async fn get_plugin_auth_header(
    plugin_name: String,
    org_id: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let auth = {
        let registry = state.plugin_registry.lock().unwrap();
        registry.resolve_plugin_auth(&plugin_name)?
    };

    if let PluginAuth::OAuth {
        client_id,
        token_url,
        ..
    } = &auth
    {
        let oauth_info = crate::plugin::OAuthRefreshInfo {
            plugin_name: plugin_name.clone(),
            token_url: token_url.clone(),
            client_id: client_id.clone(),
            org_id: org_id.clone(),
        };
        if crate::plugin::oauth_token_needs_preemptive_refresh(&oauth_info) {
            let client = state.http_client.clone();
            if let Some(header) = crate::plugin::try_refresh_oauth(&oauth_info, &client).await {
                return Ok(header);
            }
        }
    }

    // Try resolving from stored token (env var fallback for Bearer/ApiKey, stored file for OAuth)
    let header = if let Some(ref oid) = org_id {
        auth.resolve_header_for_org(&plugin_name, oid)
    } else {
        auth.resolve_header(&plugin_name)
    };
    if let Some(header) = header {
        return Ok(header);
    }

    // If OAuth with expired token, attempt refresh
    if let PluginAuth::OAuth {
        client_id,
        token_url,
        ..
    } = &auth
    {
        let client = state.http_client.clone();
        let oauth_info = crate::plugin::OAuthRefreshInfo {
            plugin_name: plugin_name.clone(),
            token_url: token_url.clone(),
            client_id: client_id.clone(),
            org_id: org_id.clone(),
        };
        if let Some(header) = crate::plugin::try_refresh_oauth(&oauth_info, &client).await {
            return Ok(header);
        }
    }

    Err(format!("No token available for plugin '{}'", plugin_name))
}

#[tauri::command]
pub fn store_plugin_token(
    plugin_name: String,
    token: String,
    org_id: Option<String>,
) -> Result<(), String> {
    if let Some(ref oid) = org_id {
        let stored = mcpviews_shared::token_store::StoredToken {
            access_token: token,
            refresh_token: None,
            expires_at: None,
        };
        mcpviews_shared::token_store::store_token_for_org(
            &mcpviews_shared::auth_dir(),
            &plugin_name,
            oid,
            &stored,
        )
    } else {
        crate::auth::store_api_key(&plugin_name, &token)
    }
}

#[tauri::command]
pub async fn install_plugin_from_registry(
    entry_json: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let entry: RegistryEntry =
        serde_json::from_str(&entry_json).map_err(|e| format!("Invalid registry entry: {}", e))?;

    state.install_or_update_from_entry(&entry).await?;

    state.notify_tools_changed();
    let _ = app_handle.emit("reload_renderers", ());

    Ok(())
}

#[tauri::command]
pub fn install_plugin_from_zip(
    path: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let zip_path = std::path::Path::new(&path);
    let plugins_dir = mcpviews_shared::plugins_dir();
    let manifest = mcpviews_shared::package::install_from_local_zip(zip_path, &plugins_dir)?;

    let mut registry = state.plugin_registry.lock().unwrap();
    // Remove if already exists (for reinstall/update)
    // Only clear in-memory state — zip extraction already placed files on disk
    if registry.manifests.iter().any(|m| m.name == manifest.name) {
        let _ = registry.remove_plugin_in_memory(&manifest.name);
    }
    registry.add_plugin(manifest)?;
    drop(registry);

    state.notify_tools_changed();
    let _ = app_handle.emit("reload_renderers", ());

    Ok(())
}

#[tauri::command]
pub async fn reinstall_plugin(
    name: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let entry = {
        let cached = state.latest_registry.lock().unwrap();
        cached.iter().find(|e| e.name == name).cloned()
    };

    if let Some(entry) = entry {
        state.install_or_update_from_entry(&entry).await?;
    } else {
        // For non-registry plugins, just reload from existing manifest
        let registry = state.plugin_registry.lock().unwrap();
        if !registry.manifests.iter().any(|m| m.name == name) {
            return Err(format!("Plugin '{}' not found", name));
        }
        drop(registry);
        // Plugin exists but not in registry - just notify to refresh
    }

    state.notify_tools_changed();
    let _ = app_handle.emit("reload_renderers", ());
    Ok(())
}

#[tauri::command]
pub fn clear_plugin_auth(name: String, org_id: Option<String>) -> Result<(), String> {
    if let Some(ref oid) = org_id {
        mcpviews_shared::token_store::remove_org_token(&mcpviews_shared::auth_dir(), &name, oid)
    } else {
        mcpviews_shared::token_store::remove_token(&mcpviews_shared::auth_dir(), &name)
    }
}

#[tauri::command]
pub fn list_plugin_orgs(plugin_name: String) -> Vec<String> {
    mcpviews_shared::token_store::list_orgs(&mcpviews_shared::auth_dir(), &plugin_name)
}

#[tauri::command]
pub fn list_plugin_org_auth(plugin_name: String) -> Vec<serde_json::Value> {
    let auth_dir = mcpviews_shared::auth_dir();
    mcpviews_shared::token_store::list_orgs(&auth_dir, &plugin_name)
        .into_iter()
        .map(|org_id| {
            let status = mcpviews_shared::token_store::token_status_for_org(
                &auth_dir,
                &plugin_name,
                &org_id,
            );
            serde_json::json!({
                "org_id": org_id,
                "status": status.as_str(),
                "refreshable": status.refreshable()
            })
        })
        .collect()
}

#[tauri::command]
pub fn get_first_party_ai_config() -> serde_json::Value {
    crate::first_party_ai::config_summary()
}

#[tauri::command]
pub async fn start_first_party_ai_auth(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    crate::first_party_ai::start_auth(state.inner()).await
}

#[tauri::command]
pub async fn get_first_party_ai_auth_header(
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    crate::first_party_ai::get_auth_header(state.inner()).await
}

#[tauri::command]
pub async fn get_first_party_ai_session(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    crate::first_party_ai::get_session(state.inner()).await
}

#[tauri::command]
pub async fn send_first_party_ai_magic_link(
    email: String,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    crate::first_party_ai::send_magic_link(state.inner(), &email).await
}

#[tauri::command]
pub async fn send_first_party_ai_email_code(
    email: String,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    crate::first_party_ai::send_email_code(state.inner(), &email).await
}

#[tauri::command]
pub async fn verify_first_party_ai_email_code(
    email: String,
    code: String,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    crate::first_party_ai::verify_email_code(state.inner(), &email, &code).await
}

#[tauri::command]
pub async fn verify_first_party_ai_magic_link(
    verification_url_or_token: String,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    crate::first_party_ai::verify_magic_link(state.inner(), &verification_url_or_token).await
}

#[tauri::command]
pub async fn clear_first_party_ai_auth(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    crate::first_party_ai::clear_auth(state.inner()).await
}

#[tauri::command]
pub async fn first_party_ai_request(
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    query: Option<HashMap<String, String>>,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    crate::first_party_ai::proxy_request(state.inner(), &method, &path, body, query).await
}

#[tauri::command]
pub async fn first_party_ai_relay_request(
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    query: Option<HashMap<String, String>>,
    relay_token: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    crate::desktop_relay::relay_request(state.inner(), &method, &path, body, query, relay_token)
        .await
}

#[tauri::command]
pub async fn fetch_signed_file_bytes(
    url: String,
    state: State<'_, Arc<AppState>>,
) -> Result<SignedFileBytes, String> {
    use base64::Engine;

    let parsed = reqwest::Url::parse(url.trim())
        .map_err(|err| format!("Invalid signed file URL: {}", err))?;
    crate::first_party_ai::validate_signed_file_download_url(&parsed)?;

    let response = state
        .http_client
        .get(parsed)
        .send()
        .await
        .map_err(|err| format!("Signed file download failed: {}", err.without_url()))?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let content_disposition = response
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());

    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("Failed to read signed file download: {}", err.without_url()))?;
    if !status.is_success() {
        let detail = String::from_utf8_lossy(&bytes);
        let trimmed = detail.trim();
        let summary = if trimmed.chars().count() > 500 {
            format!("{}...", trimmed.chars().take(500).collect::<String>())
        } else {
            trimmed.to_string()
        };
        return Err(format!(
            "Signed file download returned HTTP {}: {}",
            status.as_u16(),
            summary
        ));
    }

    Ok(SignedFileBytes {
        content_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        content_type,
        content_disposition,
    })
}

#[tauri::command]
pub async fn probe_local_runtime_host(
    url: String,
    token: Option<String>,
    timeout_ms: Option<u64>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    crate::first_party_ai::probe_local_runtime_host(
        state.inner(),
        &url,
        token.as_deref(),
        timeout_ms,
    )
    .await
}

#[tauri::command]
pub async fn list_local_mcp_tools(
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<serde_json::Value>, String> {
    let async_state = Arc::new(TokioMutex::new(AsyncAppState {
        inner: state.inner().clone(),
        app_handle,
    }));
    Ok(crate::mcp_tools::list_tools(&async_state).await)
}

#[tauri::command]
pub async fn get_local_mcp_catalog(
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let async_state = Arc::new(TokioMutex::new(AsyncAppState {
        inner: state.inner().clone(),
        app_handle,
    }));
    Ok(crate::mcp_tools::build_hosted_discovery_catalog(&async_state).await)
}

#[tauri::command]
pub async fn call_local_mcp_tool(
    name: String,
    arguments: serde_json::Value,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let async_state = Arc::new(TokioMutex::new(AsyncAppState {
        inner: state.inner().clone(),
        app_handle,
    }));
    crate::mcp_tools::call_tool(&name, arguments, &async_state).await
}

#[tauri::command]
pub async fn register_first_party_ai_desktop_relay(
    body: Option<serde_json::Value>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    crate::desktop_relay::register_desktop_relay(state.inner(), &app_handle, body).await
}

#[tauri::command]
pub async fn refresh_first_party_ai_desktop_relay(
    body: Option<serde_json::Value>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    crate::desktop_relay::refresh_desktop_relay(state.inner(), &app_handle, body).await
}

#[tauri::command]
pub async fn start_first_party_ai_companion_stream(
    thread_id: String,
    companion_key: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    crate::first_party_ai::start_companion_stream(
        state.inner().clone(),
        app_handle,
        thread_id,
        companion_key,
    )
    .await
}

#[tauri::command]
pub fn stop_first_party_ai_companion_stream(
    thread_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    crate::first_party_ai::stop_companion_stream(state.inner(), &thread_id);
    Ok(())
}

#[tauri::command]
pub async fn start_first_party_ai_desktop_relay_stream(
    stream_id: String,
    path: Option<String>,
    query: Option<HashMap<String, String>>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    crate::desktop_relay::start_desktop_relay_stream(
        state.inner().clone(),
        app_handle,
        stream_id,
        path,
        query,
    )
    .await
}

#[tauri::command]
pub async fn start_first_party_ai_realtime_relay_stream(
    stream_id: String,
    relay_session_id: String,
    stream_url: String,
    response_url: String,
    token: String,
    token_expires_at: i64,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    crate::desktop_relay::start_realtime_relay_stream(
        state.inner().clone(),
        app_handle,
        stream_id,
        relay_session_id,
        stream_url,
        response_url,
        token,
        token_expires_at,
    )
    .await
}

#[tauri::command]
pub fn stop_first_party_ai_desktop_relay_stream(
    stream_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    crate::desktop_relay::stop_desktop_relay_stream(state.inner(), &stream_id);
    Ok(())
}

#[tauri::command]
pub async fn start_first_party_ai_desktop_presence_heartbeat(
    heartbeat_id: String,
    path: Option<String>,
    interval_secs: u64,
    body: Option<serde_json::Value>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    crate::desktop_relay::start_desktop_presence_heartbeat(
        state.inner().clone(),
        app_handle,
        heartbeat_id,
        path,
        interval_secs,
        body,
    )
    .await
}

#[tauri::command]
pub fn stop_first_party_ai_desktop_presence_heartbeat(
    heartbeat_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    crate::desktop_relay::stop_desktop_presence_heartbeat(state.inner(), &heartbeat_id);
    Ok(())
}

#[tauri::command]
pub fn get_settings() -> Result<mcpviews_shared::settings::Settings, String> {
    Ok(mcpviews_shared::settings::Settings::load())
}

#[tauri::command]
pub fn save_settings(settings: mcpviews_shared::settings::Settings) -> Result<(), String> {
    settings.save()
}

#[tauri::command]
pub fn get_plugin_renderers() -> Vec<RendererInfo> {
    crate::renderer_scanner::scan_plugin_renderers()
}

#[tauri::command]
pub async fn update_plugin(
    name: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let entry = {
        let cached = state.latest_registry.lock().unwrap();
        cached.iter().find(|e| e.name == name).cloned()
    }
    .ok_or_else(|| format!("Plugin '{}' not found in registry", name))?;

    // Version guard: only update if the registry version is actually newer
    {
        let registry = state.plugin_registry.lock().unwrap();
        if let Some(installed) = registry.manifests.iter().find(|m| m.name == name) {
            if mcpviews_shared::newer_version(&installed.version, &entry.version).is_none() {
                return Err(format!(
                    "Plugin '{}' is already up to date (version {})",
                    name, installed.version
                ));
            }
        }
    }

    state.install_or_update_from_entry(&entry).await?;

    state.notify_tools_changed();
    let _ = app_handle.emit("reload_renderers", ());

    Ok(())
}

#[tauri::command]
pub async fn check_plugin_prerelease(
    name: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<PluginPrereleaseInfo>, String> {
    let entry = registry_entry_for_plugin(&name, &state)
        .ok_or_else(|| format!("Plugin '{}' not found in registry", name))?;
    let Some(repo) = github_repo_slug(&entry) else {
        return Ok(None);
    };

    let Some(release) = latest_release_for_repo(&state.http_client, &repo, true).await? else {
        return Ok(None);
    };
    let Some(asset) = release_asset_for_plugin(&release, &entry.name) else {
        return Ok(None);
    };
    let version = release_version(&release);
    let stable_version = latest_release_for_repo(&state.http_client, &repo, false)
        .await?
        .map(|release| release_version(&release));
    let installed_version = {
        let registry = state.plugin_registry.lock().unwrap();
        registry
            .manifests
            .iter()
            .find(|m| m.name == entry.name)
            .map(|m| m.version.clone())
    };
    let installed_prerelease = installed_version
        .as_deref()
        .map(is_prerelease_version)
        .unwrap_or(false);
    let update_available = prerelease_update_available(installed_version.as_deref(), &version);

    Ok(Some(PluginPrereleaseInfo {
        name: entry.name,
        version,
        tag: release.tag_name.clone(),
        download_url: asset.browser_download_url.clone(),
        release_url: release.html_url.clone(),
        installed_version,
        installed_prerelease,
        stable_version,
        update_available,
    }))
}

#[tauri::command]
pub async fn install_plugin_prerelease(
    name: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let info = check_plugin_prerelease(name.clone(), state.clone()).await?;
    let info = info.ok_or_else(|| format!("No prerelease package found for '{}'", name))?;
    let entry = registry_entry_for_plugin(&name, &state)
        .ok_or_else(|| format!("Plugin '{}' not found in registry", name))?;
    let mut prerelease_entry = entry.clone();
    prerelease_entry.version = info.version;
    prerelease_entry.download_url = Some(info.download_url.clone());
    prerelease_entry.manifest.version = prerelease_entry.version.clone();
    prerelease_entry.manifest.download_url = Some(info.download_url);

    state
        .install_or_update_from_entry(&prerelease_entry)
        .await?;
    state.notify_tools_changed();
    let _ = app_handle.emit("reload_renderers", ());
    Ok(())
}

#[tauri::command]
pub async fn rollback_plugin_to_stable(
    name: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let entry = registry_entry_for_plugin(&name, &state)
        .ok_or_else(|| format!("Plugin '{}' not found in registry", name))?;
    let repo = github_repo_slug(&entry)
        .ok_or_else(|| format!("Plugin '{}' does not have a GitHub release source", name))?;
    let release = latest_release_for_repo(&state.http_client, &repo, false)
        .await?
        .ok_or_else(|| format!("No stable release found for '{}'", name))?;
    let asset = release_asset_for_plugin(&release, &entry.name)
        .ok_or_else(|| format!("No stable release package found for '{}'", name))?;
    let stable_version = release_version(&release);

    let mut stable_entry = entry.clone();
    stable_entry.version = stable_version.clone();
    stable_entry.download_url = Some(asset.browser_download_url.clone());
    stable_entry.manifest.version = stable_version;
    stable_entry.manifest.download_url = stable_entry.download_url.clone();

    state.install_or_update_from_entry(&stable_entry).await?;
    state.notify_tools_changed();
    let _ = app_handle.emit("reload_renderers", ());
    Ok(())
}

fn registry_entry_for_plugin(name: &str, state: &Arc<AppState>) -> Option<RegistryEntry> {
    let cached = state.latest_registry.lock().unwrap();
    cached.iter().find(|e| e.name == name).cloned()
}

fn github_repo_slug(entry: &RegistryEntry) -> Option<String> {
    [
        entry.manifest_url.as_deref(),
        entry.homepage.as_deref(),
        entry.download_url.as_deref(),
        entry.manifest.download_url.as_deref(),
    ]
    .into_iter()
    .flatten()
    .find_map(github_repo_slug_from_url)
}

fn github_repo_slug_from_url(raw: &str) -> Option<String> {
    let url = url::Url::parse(raw).ok()?;
    let segments: Vec<_> = url.path_segments()?.collect();
    match url.host_str()? {
        "github.com" if segments.len() >= 2 => {
            Some(format!("{}/{}", segments[0], trim_git_suffix(segments[1])))
        }
        "raw.githubusercontent.com" if segments.len() >= 2 => {
            Some(format!("{}/{}", segments[0], trim_git_suffix(segments[1])))
        }
        "api.github.com" if segments.len() >= 4 && segments[0] == "repos" => {
            Some(format!("{}/{}", segments[1], trim_git_suffix(segments[2])))
        }
        _ => None,
    }
}

fn trim_git_suffix(repo: &str) -> String {
    repo.strip_suffix(".git").unwrap_or(repo).to_string()
}

async fn latest_release_for_repo(
    client: &reqwest::Client,
    repo: &str,
    prerelease: bool,
) -> Result<Option<GithubRelease>, String> {
    let url = format!("https://api.github.com/repos/{}/releases", repo);
    let releases: Vec<GithubRelease> = client
        .get(url)
        .header(reqwest::header::USER_AGENT, "MCPViews Plugin Manager")
        .send()
        .await
        .map_err(|e| format!("Failed to query GitHub releases: {}", e))?
        .error_for_status()
        .map_err(|e| format!("GitHub releases request failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub releases: {}", e))?;

    Ok(releases
        .into_iter()
        .filter(|release| release.prerelease == prerelease && !release.draft)
        .max_by(compare_releases))
}

fn compare_releases(left: &GithubRelease, right: &GithubRelease) -> std::cmp::Ordering {
    match (
        semver::Version::parse(&release_version(left)),
        semver::Version::parse(&release_version(right)),
    ) {
        (Ok(left_version), Ok(right_version)) => left_version.cmp(&right_version),
        _ => left.published_at.cmp(&right.published_at),
    }
}

fn release_version(release: &GithubRelease) -> String {
    release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name)
        .to_string()
}

fn is_prerelease_version(version: &str) -> bool {
    version.contains('-')
}

fn prerelease_update_available(installed_version: Option<&str>, prerelease_version: &str) -> bool {
    installed_version
        .map(|version| mcpviews_shared::newer_version(version, prerelease_version).is_some())
        .unwrap_or(true)
}

fn release_asset_for_plugin<'a>(
    release: &'a GithubRelease,
    plugin_name: &str,
) -> Option<&'a GithubReleaseAsset> {
    let normalized_plugin = plugin_name.replace('_', "-").to_ascii_lowercase();
    release
        .assets
        .iter()
        .filter(|asset| asset.name.ends_with(".zip"))
        .max_by_key(|asset| {
            let name = asset.name.to_ascii_lowercase();
            if name.contains(&normalized_plugin) {
                2
            } else if name.contains("plugin") {
                1
            } else {
                0
            }
        })
}

#[tauri::command]
pub async fn save_file(
    app_handle: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();

    app_handle
        .dialog()
        .file()
        .set_file_name(&filename)
        .add_filter("CSV", &["csv"])
        .add_filter("All Files", &["*"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    let path = rx
        .await
        .map_err(|_| "Save dialog cancelled unexpectedly".to_string())?;

    match path {
        Some(file_path) => {
            let p = file_path
                .as_path()
                .ok_or_else(|| "Save dialog returned a non-local path".to_string())?;
            std::fs::write(p, &content).map_err(|e| format!("Failed to write file: {}", e))?;
            Ok(true)
        }
        None => Ok(false), // user cancelled
    }
}

#[tauri::command]
pub async fn save_binary_file(
    app_handle: tauri::AppHandle,
    filename: String,
    content_base64: String,
) -> Result<bool, String> {
    use base64::Engine;
    use tauri_plugin_dialog::DialogExt;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content_base64.as_bytes())
        .map_err(|e| format!("Failed to decode file content: {}", e))?;
    let (tx, rx) = tokio::sync::oneshot::channel();

    app_handle
        .dialog()
        .file()
        .set_file_name(&filename)
        .add_filter("All Files", &["*"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    let path = rx
        .await
        .map_err(|_| "Save dialog cancelled unexpectedly".to_string())?;

    match path {
        Some(file_path) => {
            let p = file_path
                .as_path()
                .ok_or_else(|| "Save dialog returned a non-local path".to_string())?;
            std::fs::write(p, &bytes).map_err(|e| format!("Failed to write file: {}", e))?;
            Ok(true)
        }
        None => Ok(false),
    }
}

#[tauri::command]
pub fn get_standalone_renderers(state: State<'_, Arc<AppState>>) -> Vec<serde_json::Value> {
    let registry = state.plugin_registry.lock().unwrap();
    collect_standalone_renderers(&registry.manifests)
}

pub fn collect_standalone_renderers(
    manifests: &[mcpviews_shared::PluginManifest],
) -> Vec<serde_json::Value> {
    let current_persona_studio_installed = manifests
        .iter()
        .any(|manifest| manifest.name == CURRENT_PERSONA_STUDIO_PLUGIN);
    let mut results: Vec<serde_json::Value> = Vec::new();
    let mut plugin_positions: HashMap<String, usize> = HashMap::new();
    let mut plugin_label_is_explicit: HashMap<String, bool> = HashMap::new();
    let mut renderer_names_by_plugin: HashMap<String, HashSet<String>> = HashMap::new();

    for manifest in manifests {
        if current_persona_studio_installed && manifest.name == LEGACY_PERSONA_STUDIO_PLUGIN {
            continue;
        }

        let plugin_group = manifest
            .standalone_group
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&manifest.name)
            .to_string();
        let explicit_plugin_label = manifest
            .standalone_group_label
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let plugin_label = explicit_plugin_label
            .clone()
            .unwrap_or_else(|| humanize_standalone_plugin_label(&plugin_group));
        let plugin_label_explicit = explicit_plugin_label.is_some();

        let standalone_renderers: Vec<serde_json::Value> = manifest
            .renderer_definitions
            .iter()
            .filter(|def| def.standalone)
            .filter(|def| {
                renderer_names_by_plugin
                    .entry(plugin_group.clone())
                    .or_default()
                    .insert(def.name.clone())
            })
            .map(|def| {
                serde_json::json!({
                    "name": def.name,
                    "label": def.standalone_label.as_deref().unwrap_or(&def.name),
                    "description": def.description,
                    "data_hint": def.data_hint,
                })
            })
            .collect();

        if !standalone_renderers.is_empty() {
            let position = match plugin_positions.get(&plugin_group) {
                Some(position) => {
                    if plugin_label_explicit
                        && !plugin_label_is_explicit
                            .get(&plugin_group)
                            .copied()
                            .unwrap_or(false)
                    {
                        results[*position]["label"] = serde_json::json!(plugin_label);
                        plugin_label_is_explicit.insert(plugin_group.clone(), true);
                    }
                    *position
                }
                None => {
                    results.push(serde_json::json!({
                        "plugin": plugin_group.as_str(),
                        "label": plugin_label.as_str(),
                        "renderers": [],
                    }));
                    let position = results.len() - 1;
                    plugin_positions.insert(plugin_group.clone(), position);
                    plugin_label_is_explicit.insert(plugin_group.clone(), plugin_label_explicit);
                    position
                }
            };
            if let Some(renderers) = results[position]["renderers"].as_array_mut() {
                renderers.extend(standalone_renderers);
            }
        }
    }
    results
}

fn humanize_standalone_plugin_label(plugin: &str) -> String {
    match plugin {
        "decidr" => "DecidR".to_string(),
        "ludflow" => "Ludflow".to_string(),
        "tribex_ai" => "TribeX AI".to_string(),
        "tribe-x-persona-studio" => "Persona Studio".to_string(),
        value => value
            .split(['-', '_'])
            .filter(|part| !part.is_empty())
            .map(|part| {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => String::new(),
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
    }
}

/// Collect invocable renderer definitions (those with invoke_schema) from plugin manifests.
pub fn collect_invocable_renderers(
    manifests: &[mcpviews_shared::PluginManifest],
) -> Vec<serde_json::Value> {
    let mut results = Vec::new();
    for manifest in manifests {
        for def in &manifest.renderer_definitions {
            if def.invoke_schema.is_some() {
                results.push(serde_json::json!({
                    "name": def.name,
                    "description": def.description,
                    "display_mode": def.display_mode,
                    "invoke_schema": def.invoke_schema,
                    "url_patterns": def.url_patterns,
                    "plugin": manifest.name,
                }));
            }
        }
    }
    results
}

/// Return renderer definitions that have invoke_schema set (i.e., are invocable).
/// Used by the frontend invocation registry to know which renderers can be invoked.
#[tauri::command]
pub fn get_renderer_registry(state: State<'_, Arc<AppState>>) -> Vec<serde_json::Value> {
    let registry = state.plugin_registry.lock().unwrap();
    collect_invocable_renderers(&registry.manifests)
}

#[tauri::command]
pub fn set_plugin_update_policy(
    plugin_name: String,
    policy: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let store = state.plugin_store();
    let prefs = mcpviews_shared::PluginPreferences {
        update_policy: policy,
        update_policy_version: None,
        update_policy_source: "ui".to_string(),
    };
    store.save_preferences(&plugin_name, &prefs)
}

#[tauri::command]
pub fn get_plugin_update_policy(
    plugin_name: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let store = state.plugin_store();
    let prefs = store.load_preferences(&plugin_name);
    Ok(prefs.update_policy)
}

/// Parse a theme string into a Tauri theme option.
/// Returns Some(Dark) for "dark", Some(Light) for "light", None for anything else (system default).
pub(crate) fn parse_theme(theme: &str) -> Option<tauri::Theme> {
    match theme {
        "dark" => Some(tauri::Theme::Dark),
        "light" => Some(tauri::Theme::Light),
        _ => None,
    }
}

#[tauri::command]
pub fn set_native_theme(theme: String, window: tauri::Window) -> Result<(), String> {
    let native_theme = parse_theme(&theme);
    window.set_theme(native_theme).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::{test_app_state, test_manifest};

    fn test_registry_entry(name: &str) -> RegistryEntry {
        RegistryEntry {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            description: "Test plugin".to_string(),
            author: None,
            homepage: None,
            manifest: test_manifest(name),
            tags: vec![],
            download_url: None,
            manifest_url: None,
        }
    }

    #[test]
    fn test_get_health() {
        let health = get_health();
        assert_eq!(health["status"], "ok");
        assert!(health["version"].is_string());
    }

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
        assert_eq!(bounds.visible, Some(false));
    }

    #[test]
    fn test_github_repo_slug_from_manifest_url() {
        assert_eq!(
            github_repo_slug_from_url(
                "https://raw.githubusercontent.com/DeeJanuz/mcpviews-tribex-crm-plugin/master/manifest.json"
            ),
            Some("DeeJanuz/mcpviews-tribex-crm-plugin".to_string())
        );
    }

    #[test]
    fn test_github_repo_slug_from_release_asset_url() {
        assert_eq!(
            github_repo_slug_from_url(
                "https://github.com/DeeJanuz/decidr-plugin/releases/download/0.1.4/decidr.zip"
            ),
            Some("DeeJanuz/decidr-plugin".to_string())
        );
    }

    #[test]
    fn test_release_asset_prefers_plugin_named_zip() {
        let release = GithubRelease {
            tag_name: "v1.2.3-beta.1".to_string(),
            html_url: Some(
                "https://github.com/example/repo/releases/tag/v1.2.3-beta.1".to_string(),
            ),
            prerelease: true,
            draft: false,
            published_at: None,
            assets: vec![
                GithubReleaseAsset {
                    name: "source.zip".to_string(),
                    browser_download_url: "https://example.test/source.zip".to_string(),
                },
                GithubReleaseAsset {
                    name: "tribex-crm.zip".to_string(),
                    browser_download_url: "https://example.test/tribex-crm.zip".to_string(),
                },
            ],
        };

        let asset = release_asset_for_plugin(&release, "tribex-crm").unwrap();
        assert_eq!(asset.name, "tribex-crm.zip");
    }

    #[test]
    fn test_prerelease_update_available_for_uninstalled_plugin() {
        assert!(prerelease_update_available(None, "1.2.3-rc.1"));
    }

    #[test]
    fn test_prerelease_update_available_for_older_beta() {
        assert!(prerelease_update_available(
            Some("1.2.3-rc.1"),
            "1.2.3-rc.2"
        ));
    }

    #[test]
    fn test_prerelease_update_not_available_for_current_beta() {
        assert!(!prerelease_update_available(
            Some("1.2.3-rc.2"),
            "1.2.3-rc.2"
        ));
    }

    #[test]
    fn test_prerelease_update_not_available_when_stable_is_newer() {
        assert!(!prerelease_update_available(Some("1.2.3"), "1.2.3-rc.3"));
    }

    #[test]
    fn resolve_local_review_decision_records_before_backend_callback_delivery() {
        let (state, _dir) = test_app_state();
        let session_id = "review-session-1";
        let callback = serde_json::json!({
            "url": "https://example.test/reviews/1",
            "token": "secret-token"
        });

        {
            let mut sessions = state.sessions.lock().unwrap();
            sessions.set(PreviewSession {
                session_id: session_id.to_string(),
                tool_name: "structured_data".to_string(),
                tool_args: serde_json::json!({}),
                content_type: "structured_data".to_string(),
                data: serde_json::json!({ "tables": [] }),
                meta: serde_json::json!({
                    "reviewRequired": true,
                    "backendCallback": callback
                }),
                backend_callback: Some(callback.clone()),
                review_required: true,
                timeout_secs: Some(120),
                created_at: 1,
                decided_at: None,
                decision: None,
                operation_decisions: None,
                comments: None,
                modifications: None,
                additions: None,
                suggestion_decisions: None,
                table_decisions: None,
            });
        }
        let receiver = {
            let mut reviews = state.reviews.lock().unwrap();
            reviews.add_pending(session_id.to_string())
        };

        let mut operation_decisions = HashMap::new();
        operation_decisions.insert("row-1".to_string(), "accept".to_string());
        let mut comments = HashMap::new();
        comments.insert("row-1".to_string(), "ship it".to_string());
        let mut modifications = HashMap::new();
        modifications.insert("row-1.details".to_string(), "updated".to_string());
        let additions = serde_json::json!({ "user_edits": { "row-1.details": "updated" } });
        let mut suggestion_decisions = HashMap::new();
        suggestion_decisions.insert("s1".to_string(), serde_json::json!({ "status": "accept" }));
        let mut table_decisions = HashMap::new();
        table_decisions.insert(
            "t1".to_string(),
            serde_json::json!({ "decisions": { "row-1": "accept" } }),
        );

        let review_decision = build_review_decision(
            session_id.to_string(),
            "partial".to_string(),
            Some(operation_decisions.clone()),
            Some(comments.clone()),
            Some(modifications.clone()),
            Some(additions.clone()),
            Some(suggestion_decisions.clone()),
            Some(table_decisions.clone()),
        );

        let extracted_callback = resolve_local_review_decision(&state, session_id, review_decision);

        assert_eq!(extracted_callback, Some(callback));

        let sessions = state.sessions.lock().unwrap();
        let session = sessions.get(session_id).unwrap();
        assert_eq!(session.decision.as_deref(), Some("partial"));
        assert_eq!(
            session.operation_decisions,
            Some(operation_decisions.clone())
        );
        assert_eq!(session.comments, Some(comments.clone()));
        assert_eq!(session.modifications, Some(modifications.clone()));
        assert_eq!(session.additions, Some(additions.clone()));
        assert_eq!(
            session.suggestion_decisions,
            Some(suggestion_decisions.clone())
        );
        assert_eq!(session.table_decisions, Some(table_decisions.clone()));
        assert!(session.decided_at.is_some());
        assert!(session.meta.get("backendCallback").is_none());

        let resolved = receiver.borrow().clone().unwrap();
        assert_eq!(resolved.decision.as_deref(), Some("partial"));
        assert_eq!(resolved.operation_decisions, Some(operation_decisions));
        assert_eq!(resolved.comments, Some(comments));
        assert_eq!(resolved.modifications, Some(modifications));
        assert_eq!(resolved.additions, Some(additions));
        assert_eq!(resolved.suggestion_decisions, Some(suggestion_decisions));
        assert_eq!(resolved.table_decisions, Some(table_decisions));
    }

    #[test]
    fn test_get_registry_sources() {
        let sources = get_registry_sources();
        let _ = sources.len();
    }

    #[tokio::test]
    async fn test_install_from_entry_manifest_only() {
        let (state, _dir) = test_app_state();
        let entry = test_registry_entry("test-plugin");

        state.install_or_update_from_entry(&entry).await.unwrap();

        let registry = state.plugin_registry.lock().unwrap();
        assert_eq!(registry.manifests.len(), 1);
        assert_eq!(registry.manifests[0].name, "test-plugin");
    }

    #[tokio::test]
    async fn test_install_from_entry_replaces_existing() {
        let (state, _dir) = test_app_state();
        let entry = test_registry_entry("dup-plugin");

        state.install_or_update_from_entry(&entry).await.unwrap();
        state.install_or_update_from_entry(&entry).await.unwrap();

        let registry = state.plugin_registry.lock().unwrap();
        let count = registry
            .manifests
            .iter()
            .filter(|m| m.name == "dup-plugin")
            .count();
        assert_eq!(count, 1, "Should not have duplicate entries");
    }

    #[test]
    fn test_install_plugin_logic() {
        let (state, _dir) = test_app_state();
        let manifest = test_manifest("logic-test");
        let manifest_json = serde_json::to_string(&manifest).unwrap();

        let parsed: PluginManifest = serde_json::from_str(&manifest_json).unwrap();
        let mut registry = state.plugin_registry.lock().unwrap();
        registry.add_plugin(parsed).unwrap();
        drop(registry);

        let registry = state.plugin_registry.lock().unwrap();
        assert_eq!(registry.manifests.len(), 1);
        assert_eq!(registry.manifests[0].name, "logic-test");
    }

    #[test]
    fn test_uninstall_plugin_logic() {
        let (state, _dir) = test_app_state();

        {
            let mut registry = state.plugin_registry.lock().unwrap();
            registry.add_plugin(test_manifest("removeme")).unwrap();
            assert_eq!(registry.manifests.len(), 1);
        }

        {
            let mut registry = state.plugin_registry.lock().unwrap();
            registry.remove_plugin("removeme").unwrap();
        }

        let registry = state.plugin_registry.lock().unwrap();
        assert!(registry.manifests.is_empty(), "Plugin should be removed");
    }

    #[test]
    fn test_list_plugins_empty() {
        let (state, _dir) = test_app_state();
        let registry = state.plugin_registry.lock().unwrap();
        let cached = state.latest_registry.lock().unwrap();
        let plugins = registry.list_plugins_with_updates(&cached);
        assert!(plugins.is_empty());
    }

    #[test]
    fn test_collect_standalone_renderers_suppresses_legacy_persona_studio() {
        let mut legacy = test_manifest(LEGACY_PERSONA_STUDIO_PLUGIN);
        legacy
            .renderer_definitions
            .push(mcpviews_shared::RendererDef {
                name: "persona_lab".to_string(),
                description: "Legacy Persona Studio".to_string(),
                scope: "universal".to_string(),
                tools: vec![],
                data_hint: None,
                rule: None,
                display_mode: None,
                invoke_schema: None,
                url_patterns: vec![],
                standalone: true,
                standalone_label: Some("Persona Studio Legacy".to_string()),
            });
        let mut current = test_manifest(CURRENT_PERSONA_STUDIO_PLUGIN);
        current
            .renderer_definitions
            .push(mcpviews_shared::RendererDef {
                name: "persona_lab".to_string(),
                description: "Persona Studio".to_string(),
                scope: "universal".to_string(),
                tools: vec![],
                data_hint: None,
                rule: None,
                display_mode: None,
                invoke_schema: None,
                url_patterns: vec![],
                standalone: true,
                standalone_label: Some("Persona Studio".to_string()),
            });

        let results = collect_standalone_renderers(&[legacy, current]);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["plugin"], CURRENT_PERSONA_STUDIO_PLUGIN);
        assert_eq!(results[0]["renderers"][0]["name"], "persona_lab");
    }

    #[test]
    fn test_collect_standalone_renderers_dedupes_duplicate_plugin_manifests() {
        let mut first = test_manifest("ludflow");
        first
            .renderer_definitions
            .push(mcpviews_shared::RendererDef {
                name: "ludflow_app".to_string(),
                description: "Ludflow App".to_string(),
                scope: "universal".to_string(),
                tools: vec![],
                data_hint: None,
                rule: None,
                display_mode: None,
                invoke_schema: None,
                url_patterns: vec![],
                standalone: true,
                standalone_label: Some("Ludflow".to_string()),
            });

        let mut duplicate = test_manifest("ludflow");
        duplicate
            .renderer_definitions
            .push(mcpviews_shared::RendererDef {
                name: "ludflow_app".to_string(),
                description: "Duplicate Ludflow App".to_string(),
                scope: "universal".to_string(),
                tools: vec![],
                data_hint: None,
                rule: None,
                display_mode: None,
                invoke_schema: None,
                url_patterns: vec![],
                standalone: true,
                standalone_label: Some("Duplicate Ludflow".to_string()),
            });
        duplicate
            .renderer_definitions
            .push(mcpviews_shared::RendererDef {
                name: "ludflow_data_governance".to_string(),
                description: "Data Governance".to_string(),
                scope: "universal".to_string(),
                tools: vec![],
                data_hint: None,
                rule: None,
                display_mode: None,
                invoke_schema: None,
                url_patterns: vec![],
                standalone: true,
                standalone_label: Some("Data Governance".to_string()),
            });

        let results = collect_standalone_renderers(&[first, duplicate]);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["plugin"], "ludflow");
        let renderers = results[0]["renderers"].as_array().unwrap();
        assert_eq!(renderers.len(), 2);
        assert_eq!(renderers[0]["name"], "ludflow_app");
        assert_eq!(renderers[1]["name"], "ludflow_data_governance");
    }

    #[test]
    fn test_collect_standalone_renderers_groups_decidr_setup_under_decidr() {
        let mut decidr = test_manifest("decidr");
        decidr
            .renderer_definitions
            .push(mcpviews_shared::RendererDef {
                name: "decidr_timeline".to_string(),
                description: "Timeline".to_string(),
                scope: "universal".to_string(),
                tools: vec![],
                data_hint: None,
                rule: None,
                display_mode: None,
                invoke_schema: None,
                url_patterns: vec![],
                standalone: true,
                standalone_label: Some("Timeline".to_string()),
            });

        let mut setup = test_manifest("decidr-setup");
        setup.standalone_group = Some("decidr".to_string());
        setup.standalone_group_label = Some("DecidR".to_string());
        setup
            .renderer_definitions
            .push(mcpviews_shared::RendererDef {
                name: "decidr_onboarding".to_string(),
                description: "DecidR Setup".to_string(),
                scope: "universal".to_string(),
                tools: vec![],
                data_hint: None,
                rule: None,
                display_mode: None,
                invoke_schema: None,
                url_patterns: vec![],
                standalone: true,
                standalone_label: Some("DecidR Setup".to_string()),
            });

        let results = collect_standalone_renderers(&[decidr, setup]);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["plugin"], "decidr");
        assert_eq!(results[0]["label"], "DecidR");
        let renderers = results[0]["renderers"].as_array().unwrap();
        assert_eq!(renderers.len(), 2);
        assert_eq!(renderers[0]["name"], "decidr_timeline");
        assert_eq!(renderers[1]["name"], "decidr_onboarding");
    }

    #[tokio::test]
    async fn test_reinstall_plugin_from_registry() {
        let (state, _dir) = test_app_state();
        let entry = test_registry_entry("reinstall-me");

        // First install
        state.install_or_update_from_entry(&entry).await.unwrap();

        // Cache the registry entry (simulating fetch_registry)
        {
            let mut cached = state.latest_registry.lock().unwrap();
            cached.push(entry.clone());
        }

        // Reinstall logic (same as the command does, minus Tauri State wrapper)
        let found_entry = {
            let cached = state.latest_registry.lock().unwrap();
            cached.iter().find(|e| e.name == "reinstall-me").cloned()
        };
        assert!(found_entry.is_some());
        state
            .install_or_update_from_entry(&found_entry.unwrap())
            .await
            .unwrap();

        let registry = state.plugin_registry.lock().unwrap();
        let count = registry
            .manifests
            .iter()
            .filter(|m| m.name == "reinstall-me")
            .count();
        assert_eq!(count, 1, "Should have exactly one instance after reinstall");
    }

    #[tokio::test]
    async fn test_reinstall_plugin_not_in_registry() {
        let (state, _dir) = test_app_state();

        // Install a plugin directly (not via registry)
        let manifest = test_manifest("local-only");
        {
            let mut registry = state.plugin_registry.lock().unwrap();
            registry.add_plugin(manifest).unwrap();
        }

        // Registry cache is empty, so reinstall should not find it
        let found_entry = {
            let cached = state.latest_registry.lock().unwrap();
            cached.iter().find(|e| e.name == "local-only").cloned()
        };
        assert!(
            found_entry.is_none(),
            "Should not find local-only plugin in registry"
        );
    }

    #[test]
    fn test_get_renderer_registry_logic() {
        let (state, _dir) = test_app_state();

        // Add a plugin with an invocable renderer
        let mut manifest = test_manifest("test-invocable");
        manifest
            .renderer_definitions
            .push(mcpviews_shared::RendererDef {
                name: "decision_detail".to_string(),
                description: "Decision detail".to_string(),
                scope: "universal".to_string(),
                tools: vec![],
                data_hint: None,
                rule: None,
                display_mode: Some(mcpviews_shared::DisplayMode::Drawer),
                invoke_schema: Some("{ id: string }".to_string()),
                url_patterns: vec!["/decisions/*".to_string()],
                standalone: false,
                standalone_label: None,
            });

        // Also add a non-invocable renderer (no invoke_schema)
        manifest
            .renderer_definitions
            .push(mcpviews_shared::RendererDef {
                name: "basic_view".to_string(),
                description: "Basic view".to_string(),
                scope: "tool".to_string(),
                tools: vec!["some_tool".to_string()],
                data_hint: None,
                rule: None,
                display_mode: None,
                invoke_schema: None,
                url_patterns: vec![],
                standalone: false,
                standalone_label: None,
            });

        {
            let mut registry = state.plugin_registry.lock().unwrap();
            registry.add_plugin(manifest).unwrap();
        }

        let registry = state.plugin_registry.lock().unwrap();
        let results = collect_invocable_renderers(&registry.manifests);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["name"], "decision_detail");
        assert_eq!(results[0]["display_mode"], "drawer");
        assert_eq!(results[0]["plugin"], "test-invocable");
    }

    #[tokio::test]
    async fn test_version_guard_prevents_downgrade() {
        let (state, _dir) = test_app_state();

        // Install a plugin at version 2.0.0
        let mut manifest = test_manifest("guarded-plugin");
        manifest.version = "2.0.0".to_string();
        state.install_plugin_from_manifest(manifest, false).unwrap();

        // Create a registry entry at version 1.0.0 (older)
        let entry = test_registry_entry("guarded-plugin");
        {
            let mut cached = state.latest_registry.lock().unwrap();
            cached.push(entry);
        }

        // Simulate the version guard logic from update_plugin
        let result = {
            let cached = state.latest_registry.lock().unwrap();
            let entry = cached.iter().find(|e| e.name == "guarded-plugin").unwrap();
            let registry = state.plugin_registry.lock().unwrap();
            let installed = registry
                .manifests
                .iter()
                .find(|m| m.name == "guarded-plugin")
                .unwrap();
            let installed_ver = semver::Version::parse(&installed.version).ok();
            let available_ver = semver::Version::parse(&entry.version).ok();
            if let (Some(iv), Some(av)) = (installed_ver, available_ver) {
                if av <= iv {
                    Err(format!(
                        "Plugin '{}' is already up to date (version {})",
                        "guarded-plugin", installed.version
                    ))
                } else {
                    Ok(())
                }
            } else {
                Ok(())
            }
        };

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already up to date"));
    }

    // --- M-023: Tests for get_plugin_auth_header logic ---
    // The Tauri command `get_plugin_auth_header` wraps `resolve_plugin_auth` + `resolve_header`.
    // We test the underlying logic since the Tauri State wrapper can't be constructed in unit tests.

    #[test]
    fn test_auth_header_no_plugin_found() {
        let (state, _dir) = test_app_state();
        let registry = state.plugin_registry.lock().unwrap();
        let result = registry.resolve_plugin_auth("nonexistent-plugin");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_auth_header_plugin_no_auth_configured() {
        let (state, _dir) = test_app_state();
        // Add a plugin with no auth config (mcp is None)
        {
            let mut registry = state.plugin_registry.lock().unwrap();
            registry
                .add_plugin(test_manifest("no-auth-plugin"))
                .unwrap();
        }
        let registry = state.plugin_registry.lock().unwrap();
        let result = registry.resolve_plugin_auth("no-auth-plugin");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no auth config"));
    }

    #[test]
    fn test_auth_header_plugin_with_bearer_stored_token() {
        let (state, dir) = test_app_state();

        // Create a plugin manifest with Bearer auth
        let mut manifest = test_manifest("bearer-plugin");
        manifest.mcp = Some(mcpviews_shared::PluginMcpConfig {
            url: "https://example.com".to_string(),
            auth: Some(PluginAuth::Bearer {
                token_env: "TEST_BEARER_TOKEN_UNUSED".to_string(),
            }),
            tool_prefix: "bearer".to_string(),
        });
        {
            let mut registry = state.plugin_registry.lock().unwrap();
            registry.add_plugin(manifest).unwrap();
        }

        // Store a token on disk in the temp auth dir
        let auth_dir = dir.path().join("auth");
        std::fs::create_dir_all(&auth_dir).unwrap();
        let token = mcpviews_shared::token_store::StoredToken {
            access_token: "test-secret-token".to_string(),
            refresh_token: None,
            expires_at: None,
        };
        mcpviews_shared::token_store::store_token(&auth_dir, "bearer-plugin", &token).unwrap();

        let registry = state.plugin_registry.lock().unwrap();
        let auth = registry.resolve_plugin_auth("bearer-plugin").unwrap();

        // resolve_header_with_auth_dir lets us point at the temp dir
        let header = auth.resolve_header_with_auth_dir("bearer-plugin", &auth_dir);
        assert!(header.is_some());
        assert_eq!(header.unwrap(), "Bearer test-secret-token");
    }

    #[test]
    fn test_auth_header_bearer_no_token_returns_none() {
        let (state, dir) = test_app_state();

        let mut manifest = test_manifest("bearer-no-token");
        manifest.mcp = Some(mcpviews_shared::PluginMcpConfig {
            url: "https://example.com".to_string(),
            auth: Some(PluginAuth::Bearer {
                token_env: "MCPVIEWS_TEST_NONEXISTENT_ENV_VAR".to_string(),
            }),
            tool_prefix: "bearer".to_string(),
        });
        {
            let mut registry = state.plugin_registry.lock().unwrap();
            registry.add_plugin(manifest).unwrap();
        }

        let registry = state.plugin_registry.lock().unwrap();
        let auth = registry.resolve_plugin_auth("bearer-no-token").unwrap();

        // No stored token, no env var → resolve_header returns None
        let auth_dir = dir.path().join("auth");
        let header = auth.resolve_header_with_auth_dir("bearer-no-token", &auth_dir);
        assert!(header.is_none());
    }

    #[test]
    fn test_auth_header_apikey_no_token_returns_none() {
        let (state, dir) = test_app_state();

        let mut manifest = test_manifest("apikey-plugin");
        manifest.mcp = Some(mcpviews_shared::PluginMcpConfig {
            url: "https://example.com".to_string(),
            auth: Some(PluginAuth::ApiKey {
                header_name: "X-API-Key".to_string(),
                key_env: Some("MCPVIEWS_TEST_NONEXISTENT_API_KEY".to_string()),
            }),
            tool_prefix: "apikey".to_string(),
        });
        {
            let mut registry = state.plugin_registry.lock().unwrap();
            registry.add_plugin(manifest).unwrap();
        }

        let registry = state.plugin_registry.lock().unwrap();
        let auth = registry.resolve_plugin_auth("apikey-plugin").unwrap();

        let auth_dir = dir.path().join("auth");
        let header = auth.resolve_header_with_auth_dir("apikey-plugin", &auth_dir);
        assert!(header.is_none());
    }

    #[test]
    fn test_parse_theme_dark() {
        let result = parse_theme("dark");
        assert_eq!(result, Some(tauri::Theme::Dark));
    }

    #[test]
    fn test_parse_theme_light() {
        let result = parse_theme("light");
        assert_eq!(result, Some(tauri::Theme::Light));
    }

    #[test]
    fn test_parse_theme_unrecognized_returns_none() {
        assert_eq!(parse_theme("auto"), None);
        assert_eq!(parse_theme(""), None);
        assert_eq!(parse_theme("Dark"), None);
        assert_eq!(parse_theme("system"), None);
    }
}
