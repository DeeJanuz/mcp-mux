use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex as TokioMutex;

use mcpviews_shared::{PluginAuth, PluginInfo, PluginManifest, RegistryEntry, RegistrySource};

use crate::apps_popup::{AppsPopupBounds, AppsPopupOpenResult, AppsPopupSelection};
use crate::native_panel::{NativeAppPanelBounds, NativeAppPanelUpdateResult, NativeAppViewResult};
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

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    crate::auth_browser::open_http_url(&url)
}

#[tauri::command]
pub fn open_apps_popup(
    bounds: AppsPopupBounds,
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
) -> Result<AppsPopupOpenResult, String> {
    crate::apps_popup::open_apps_popup(bounds, window, app_handle)
}

#[tauri::command]
pub fn close_apps_popup(app_handle: tauri::AppHandle) -> Result<(), String> {
    crate::apps_popup::close_apps_popup(app_handle)
}

#[tauri::command]
pub fn select_apps_popup_renderer(
    selection: AppsPopupSelection,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    crate::apps_popup::select_apps_popup_renderer(selection, app_handle)
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
    crate::native_panel::open_native_app_view(
        plugin_name,
        url,
        title,
        label,
        state.inner(),
        app_handle,
    )
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
    crate::native_panel::mount_native_app_panel(
        plugin_name,
        url,
        title,
        label,
        bounds,
        state.inner(),
        app_handle,
    )
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
    crate::external_web_panel::mount_external_web_panel(
        url,
        title,
        label,
        session_id,
        return_origins,
        bounds,
        app_handle,
    )
}

#[tauri::command]
pub fn update_native_app_panel_bounds(
    label: String,
    bounds: NativeAppPanelBounds,
    app_handle: tauri::AppHandle,
) -> Result<NativeAppPanelUpdateResult, String> {
    crate::native_panel::update_native_app_panel_bounds(label, bounds, app_handle)
}

#[tauri::command]
pub fn close_native_app_panel(
    label: String,
    app_handle: tauri::AppHandle,
) -> Result<NativeAppPanelUpdateResult, String> {
    crate::native_panel::close_native_app_panel(label, app_handle)
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

const FILE_PREVIEW_CACHE_DIR: &str = "file-preview";

fn normalized_file_preview_mime(mime_type: Option<&str>) -> String {
    mime_type
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

fn file_preview_extension_for_mime(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "application/rtf" | "text/rtf" => Some("rtf"),
        "application/msword" => Some("doc"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => Some("docx"),
        "application/vnd.ms-excel" => Some("xls"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Some("xlsx"),
        "application/vnd.ms-powerpoint" => Some("ppt"),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => Some("pptx"),
        "application/vnd.oasis.opendocument.text" => Some("odt"),
        "application/vnd.oasis.opendocument.spreadsheet" => Some("ods"),
        "application/vnd.oasis.opendocument.presentation" => Some("odp"),
        "application/vnd.apple.pages" | "application/x-iwork-pages-sffpages" => Some("pages"),
        "application/vnd.apple.numbers" | "application/x-iwork-numbers-sffnumbers" => {
            Some("numbers")
        }
        "application/vnd.apple.keynote" | "application/x-iwork-keynote-sffkey" => Some("key"),
        _ => None,
    }
}

fn normalized_file_preview_extension(filename: &str) -> Option<String> {
    let normalized = filename.replace('\\', "/");
    let basename = normalized.rsplit('/').next().unwrap_or("").trim();
    let extension = basename.rsplit_once('.')?.1.trim().to_ascii_lowercase();
    if extension.is_empty()
        || extension.len() > 16
        || !extension.chars().all(|ch| ch.is_ascii_alphanumeric())
    {
        return None;
    }
    Some(extension)
}

fn is_allowed_file_preview_extension(extension: &str) -> bool {
    matches!(
        extension,
        "doc"
            | "docx"
            | "xls"
            | "xlsx"
            | "ppt"
            | "pptx"
            | "rtf"
            | "odt"
            | "ods"
            | "odp"
            | "pages"
            | "numbers"
            | "key"
    )
}

fn file_preview_allowed_extension(
    filename: &str,
    mime_type: Option<&str>,
) -> Result<String, String> {
    let mime = normalized_file_preview_mime(mime_type);
    if let Some(extension) = file_preview_extension_for_mime(&mime) {
        return Ok(extension.to_string());
    }

    let file_extension = normalized_file_preview_extension(filename);
    let Some(extension) = file_extension.as_deref() else {
        return Err(
            "File preview requires a supported filename extension or MIME type.".to_string(),
        );
    };
    if !is_allowed_file_preview_extension(extension) {
        return Err(format!("Unsupported file preview extension: {}", extension));
    }

    if mime.is_empty() || mime == "application/octet-stream" || mime == "binary/octet-stream" {
        return Ok(extension.to_string());
    }

    Err(format!("Unsupported file preview MIME type: {}", mime))
}

fn sanitized_file_preview_filename(filename: &str, extension: &str) -> String {
    let normalized = filename.replace('\\', "/");
    let basename = normalized.rsplit('/').next().unwrap_or("").trim();
    let mut clean = String::new();
    for ch in basename.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '-' | '_' | '.') {
            clean.push(ch);
        } else if ch.is_control() || !ch.is_ascii() {
            clean.push('_');
        } else {
            clean.push('_');
        }
    }
    let clean = clean.trim_matches(|ch| matches!(ch, ' ' | '.' | '-' | '_'));
    let suffix = format!(".{}", extension);
    let lower = clean.to_ascii_lowercase();
    let stem = if lower.ends_with(&suffix) {
        &clean[..clean.len().saturating_sub(suffix.len())]
    } else if let Some((left, right)) = clean.rsplit_once('.') {
        if !left.is_empty()
            && !right.is_empty()
            && right.len() <= 16
            && right.chars().all(|ch| ch.is_ascii_alphanumeric())
        {
            left
        } else {
            clean
        }
    } else {
        clean
    };
    let stem = stem.trim_matches(|ch| matches!(ch, ' ' | '.' | '-' | '_'));
    let stem = if stem.is_empty() { "preview" } else { stem };
    let limited_stem: String = stem.chars().take(80).collect();
    format!("{}.{}", limited_stem, extension)
}

fn file_preview_dir(cache_dir: &Path) -> PathBuf {
    cache_dir.join(FILE_PREVIEW_CACHE_DIR)
}

fn file_preview_temp_path_for_cache(
    cache_dir: &Path,
    filename: &str,
    mime_type: Option<&str>,
) -> Result<PathBuf, String> {
    let extension = file_preview_allowed_extension(filename, mime_type)?;
    let safe_filename = sanitized_file_preview_filename(filename, &extension);
    let dir = file_preview_dir(cache_dir);
    let path = dir.join(format!("{}-{}", uuid::Uuid::new_v4(), safe_filename));
    if !path.starts_with(&dir) {
        return Err("File preview path escaped the app cache directory.".to_string());
    }
    Ok(path)
}

fn file_preview_command_for_platform(
    path: &Path,
    platform: crate::auth_browser::BrowserPlatform,
) -> Result<crate::auth_browser::BrowserCommand, String> {
    let path_arg = path
        .to_str()
        .ok_or_else(|| "File preview path is not valid UTF-8.".to_string())?
        .to_string();
    match platform {
        crate::auth_browser::BrowserPlatform::Linux => Ok(crate::auth_browser::BrowserCommand {
            program: "xdg-open",
            args: vec![path_arg],
        }),
        crate::auth_browser::BrowserPlatform::MacOs => Ok(crate::auth_browser::BrowserCommand {
            program: "open",
            args: vec![path_arg],
        }),
        crate::auth_browser::BrowserPlatform::Windows => Ok(crate::auth_browser::BrowserCommand {
            program: "rundll32",
            args: vec!["url.dll,FileProtocolHandler".to_string(), path_arg],
        }),
        crate::auth_browser::BrowserPlatform::Unsupported => {
            Err("Unsupported platform".to_string())
        }
    }
}

fn open_file_preview_path(path: &Path) -> Result<(), String> {
    let command = file_preview_command_for_platform(path, crate::auth_browser::current_platform())?;
    Command::new(command.program)
        .args(command.args)
        .spawn()
        .map_err(|e| format!("Failed to open file preview: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn open_file_preview(
    app_handle: tauri::AppHandle,
    filename: String,
    mime_type: Option<String>,
    data_base64: String,
) -> Result<bool, String> {
    use base64::Engine;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("Failed to decode file preview bytes: {}", e))?;
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to resolve app cache directory: {}", e))?;
    let preview_dir = file_preview_dir(&cache_dir);
    let preview_path =
        file_preview_temp_path_for_cache(&cache_dir, &filename, mime_type.as_deref())?;
    std::fs::create_dir_all(&preview_dir)
        .map_err(|e| format!("Failed to create file preview directory: {}", e))?;
    let canonical_dir = preview_dir
        .canonicalize()
        .map_err(|e| format!("Failed to verify file preview directory: {}", e))?;
    let parent = preview_path
        .parent()
        .ok_or_else(|| "File preview path is missing a parent directory.".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Failed to verify file preview parent directory: {}", e))?;
    if !canonical_parent.starts_with(&canonical_dir) {
        return Err("File preview path escaped the app cache directory.".to_string());
    }
    std::fs::write(&preview_path, bytes)
        .map_err(|e| format!("Failed to write file preview: {}", e))?;
    open_file_preview_path(&preview_path)?;
    Ok(true)
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
    results.sort_by(|a, b| {
        let a_plugin = a["plugin"].as_str().unwrap_or_default();
        let b_plugin = b["plugin"].as_str().unwrap_or_default();
        standalone_group_rank(a_plugin)
            .cmp(&standalone_group_rank(b_plugin))
            .then_with(|| a_plugin.cmp(b_plugin))
    });
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

fn standalone_group_rank(plugin: &str) -> usize {
    match plugin {
        "decidr" => 10,
        "ludflow" => 20,
        "decidr-staging" => 30,
        "ludflow-staging" => 40,
        "tribe-x-persona-studio" => 50,
        _ => 100,
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
    let mut prefs = store.load_preferences(&plugin_name);
    prefs.update_policy = policy;
    prefs.update_policy_version = None;
    prefs.update_policy_source = "ui".to_string();
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
    fn file_preview_sanitizes_filename_path_traversal() {
        let filename = sanitized_file_preview_filename("../../secret/../report.docx", "docx");

        assert_eq!(filename, "report.docx");
        assert!(!filename.contains('/'));
        assert!(!filename.contains('\\'));
        assert!(!filename.contains(".."));
    }

    #[test]
    fn file_preview_mime_allowlist_accepts_office_type() {
        let extension = file_preview_allowed_extension(
            "unsafe.exe",
            Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        )
        .expect("expected docx MIME to be previewable");

        assert_eq!(extension, "docx");
    }

    #[test]
    fn file_preview_mime_allowlist_rejects_unsupported_binary() {
        let error = file_preview_allowed_extension("payload.bin", Some("application/octet-stream"))
            .expect_err("unexpectedly accepted unsupported binary");

        assert!(error.contains("Unsupported file preview extension"));
    }

    #[test]
    fn file_preview_rejects_conflicting_unsafe_mime() {
        let error = file_preview_allowed_extension("report.docx", Some("application/x-msdownload"))
            .expect_err("unexpectedly accepted unsafe MIME");

        assert!(error.contains("Unsupported file preview MIME type"));
    }

    #[test]
    fn file_preview_uses_mime_extension_when_filename_is_unsafe() {
        let dir = tempfile::tempdir().unwrap();
        let path = file_preview_temp_path_for_cache(
            dir.path(),
            "../invoice.exe",
            Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        )
        .expect("expected safe preview path");
        let filename = path.file_name().unwrap().to_string_lossy();

        assert!(path.starts_with(dir.path().join(FILE_PREVIEW_CACHE_DIR)));
        assert!(filename.ends_with("invoice.docx"));
        assert!(!filename.ends_with(".exe"));
    }

    #[test]
    fn file_preview_temp_path_stays_inside_cache_dir() {
        let dir = tempfile::tempdir().unwrap();
        let path = file_preview_temp_path_for_cache(
            dir.path(),
            "../../escape.xlsx",
            Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        )
        .expect("expected safe preview path");
        let preview_dir = dir.path().join(FILE_PREVIEW_CACHE_DIR);

        assert!(path.starts_with(&preview_dir));
        assert_eq!(path.parent(), Some(preview_dir.as_path()));
    }

    #[test]
    fn file_preview_windows_command_preserves_path_as_single_argument() {
        let path = Path::new(r"C:\Users\Test User\AppData\Local\MCPViews\file-preview\report.docx");
        let command =
            file_preview_command_for_platform(path, crate::auth_browser::BrowserPlatform::Windows)
                .expect("expected Windows file preview command");

        assert_eq!(command.program, "rundll32");
        assert_eq!(
            command.args,
            vec![
                "url.dll,FileProtocolHandler".to_string(),
                path.to_string_lossy().to_string()
            ]
        );
    }

    #[test]
    fn test_get_health() {
        let health = get_health();
        assert_eq!(health["status"], "ok");
        assert!(health["version"].is_string());
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

    #[test]
    fn test_collect_standalone_renderers_orders_prod_before_staging() {
        fn with_renderer(
            mut manifest: mcpviews_shared::PluginManifest,
            renderer_name: &str,
        ) -> mcpviews_shared::PluginManifest {
            manifest
                .renderer_definitions
                .push(mcpviews_shared::RendererDef {
                    name: renderer_name.to_string(),
                    description: renderer_name.to_string(),
                    scope: "universal".to_string(),
                    tools: vec![],
                    data_hint: None,
                    rule: None,
                    display_mode: None,
                    invoke_schema: None,
                    url_patterns: vec![],
                    standalone: true,
                    standalone_label: Some(renderer_name.to_string()),
                });
            manifest
        }

        let mut decidr_staging =
            with_renderer(test_manifest("decidr-staging"), "decidr_staging_dashboard");
        decidr_staging.standalone_group_label = Some("DecidR Staging".to_string());
        let mut ludflow_staging =
            with_renderer(test_manifest("ludflow-staging"), "ludflow_staging_app");
        ludflow_staging.standalone_group_label = Some("Ludflow Staging".to_string());

        let results = collect_standalone_renderers(&[
            decidr_staging,
            ludflow_staging,
            with_renderer(test_manifest("ludflow"), "ludflow_app"),
            with_renderer(test_manifest("decidr"), "decidr_dashboard"),
        ]);

        let plugins: Vec<&str> = results
            .iter()
            .map(|entry| entry["plugin"].as_str().unwrap())
            .collect();
        assert_eq!(
            plugins,
            vec!["decidr", "ludflow", "decidr-staging", "ludflow-staging"]
        );
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
