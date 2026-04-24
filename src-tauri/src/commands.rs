use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;
use tauri::{Emitter, State};

use mcpviews_shared::{PluginAuth, PluginInfo, PluginManifest, RegistryEntry, RegistrySource};

use crate::renderer_scanner::RendererInfo;

use crate::http_server::AsyncAppState;
use crate::review::ReviewDecision;
use crate::session::{sanitize_renderer_meta, PreviewSession};
use crate::state::AppState;

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
    decision: &str,
    operation_decisions: Option<HashMap<String, String>>,
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
            session.decision = Some(decision.to_string());
            session.operation_decisions = operation_decisions;
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
    let backend_callback = resolve_local_review_decision(
        state.inner(),
        &session_id,
        &decision,
        operation_decisions,
        review_decision.clone(),
    );

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
    let manifest: PluginManifest = serde_json::from_str(&manifest_json)
        .map_err(|e| format!("Invalid manifest: {}", e))?;
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
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let manifest: PluginManifest = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid manifest: {}", e))?;
    let mut registry = state.plugin_registry.lock().unwrap();
    registry.add_plugin(manifest)?;
    drop(registry);
    state.notify_tools_changed();
    Ok(())
}

#[tauri::command]
pub async fn fetch_registry(
    registry_url: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<RegistryEntry>, String> {
    let client = state.http_client.clone();
    let entries = if let Some(url) = registry_url {
        // Specific URL provided (e.g. from legacy settings)
        crate::registry::fetch_registry(&client, &url).await?
    } else {
        // Use all configured sources
        let sources = mcpviews_shared::registry::get_registry_sources();
        mcpviews_shared::registry::fetch_all_registries(&client, &sources).await?
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
    state: State<'_, Arc<AppState>>,
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
        } => {
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
pub async fn get_plugin_auth_header(
    plugin_name: String,
    org_id: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let auth = {
        let registry = state.plugin_registry.lock().unwrap();
        registry.resolve_plugin_auth(&plugin_name)?
    };

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
        let token = crate::auth::refresh_oauth_token(
            &plugin_name,
            token_url,
            client_id.as_deref(),
            &client,
            org_id.as_deref(),
        )
        .await?;
        return Ok(format!("Bearer {}", token));
    }

    Err(format!("No token available for plugin '{}'", plugin_name))
}

#[tauri::command]
pub fn store_plugin_token(plugin_name: String, token: String, org_id: Option<String>) -> Result<(), String> {
    if let Some(ref oid) = org_id {
        let stored = mcpviews_shared::token_store::StoredToken {
            access_token: token,
            refresh_token: None,
            expires_at: None,
        };
        mcpviews_shared::token_store::store_token_for_org(&mcpviews_shared::auth_dir(), &plugin_name, oid, &stored)
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
    let entry: RegistryEntry = serde_json::from_str(&entry_json)
        .map_err(|e| format!("Invalid registry entry: {}", e))?;

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
pub fn get_first_party_ai_config() -> serde_json::Value {
    crate::first_party_ai::config_summary()
}

#[tauri::command]
pub async fn start_first_party_ai_auth(
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
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
pub async fn verify_first_party_ai_magic_link(
    verification_url_or_token: String,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    crate::first_party_ai::verify_magic_link(state.inner(), &verification_url_or_token).await
}

#[tauri::command]
pub async fn clear_first_party_ai_auth(
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
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
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    crate::desktop_relay::relay_request(state.inner(), &method, &path, body, query).await
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

    let path = rx.await.map_err(|_| "Save dialog cancelled unexpectedly".to_string())?;

    match path {
        Some(file_path) => {
            let p = file_path
                .as_path()
                .ok_or_else(|| "Save dialog returned a non-local path".to_string())?;
            std::fs::write(p, &content)
                .map_err(|e| format!("Failed to write file: {}", e))?;
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

    let path = rx.await.map_err(|_| "Save dialog cancelled unexpectedly".to_string())?;

    match path {
        Some(file_path) => {
            let p = file_path
                .as_path()
                .ok_or_else(|| "Save dialog returned a non-local path".to_string())?;
            std::fs::write(p, &bytes)
                .map_err(|e| format!("Failed to write file: {}", e))?;
            Ok(true)
        }
        None => Ok(false),
    }
}

#[tauri::command]
pub fn get_standalone_renderers(state: State<'_, Arc<AppState>>) -> Vec<serde_json::Value> {
    let registry = state.plugin_registry.lock().unwrap();
    let mut results = Vec::new();

    for manifest in registry.manifests.iter() {
        let standalone_renderers: Vec<serde_json::Value> = manifest
            .renderer_definitions
            .iter()
            .filter(|def| def.standalone)
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
            results.push(serde_json::json!({
                "plugin": manifest.name,
                "renderers": standalone_renderers,
            }));
        }
    }
    results
}

/// Collect invocable renderer definitions (those with invoke_schema) from plugin manifests.
pub fn collect_invocable_renderers(manifests: &[mcpviews_shared::PluginManifest]) -> Vec<serde_json::Value> {
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
            });
        }
        let receiver = {
            let mut reviews = state.reviews.lock().unwrap();
            reviews.add_pending(session_id.to_string())
        };

        let review_decision = build_review_decision(
            session_id.to_string(),
            "accept".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
        );

        let extracted_callback = resolve_local_review_decision(
            &state,
            session_id,
            "accept",
            None,
            review_decision,
        );

        assert_eq!(extracted_callback, Some(callback));

        let sessions = state.sessions.lock().unwrap();
        let session = sessions.get(session_id).unwrap();
        assert_eq!(session.decision.as_deref(), Some("accept"));
        assert!(session.decided_at.is_some());
        assert!(session.meta.get("backendCallback").is_none());

        let resolved = receiver.borrow().clone().unwrap();
        assert_eq!(resolved.decision.as_deref(), Some("accept"));
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
        let count = registry.manifests.iter().filter(|m| m.name == "dup-plugin").count();
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
        state.install_or_update_from_entry(&found_entry.unwrap()).await.unwrap();

        let registry = state.plugin_registry.lock().unwrap();
        let count = registry.manifests.iter().filter(|m| m.name == "reinstall-me").count();
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
        assert!(found_entry.is_none(), "Should not find local-only plugin in registry");
    }

    #[test]
    fn test_get_renderer_registry_logic() {
        let (state, _dir) = test_app_state();

        // Add a plugin with an invocable renderer
        let mut manifest = test_manifest("test-invocable");
        manifest.renderer_definitions.push(mcpviews_shared::RendererDef {
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
        manifest.renderer_definitions.push(mcpviews_shared::RendererDef {
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
            let installed = registry.manifests.iter().find(|m| m.name == "guarded-plugin").unwrap();
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
            registry.add_plugin(test_manifest("no-auth-plugin")).unwrap();
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
