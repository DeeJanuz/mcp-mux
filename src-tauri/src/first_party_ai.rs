use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::state::AppState;

const AUTH_NAMESPACE: &str = "first_party_ai";
const RELAY_AUTH_NAMESPACE: &str = "first_party_ai_relay";

fn has_persisted_session(auth_dir: &std::path::Path) -> bool {
    auth_dir.join("first_party_ai.cookies.json").exists()
}

fn env_override(keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_override_i64(keys: &[&str]) -> Option<i64> {
    env_override(keys).and_then(|value| value.parse::<i64>().ok())
}

fn trim_trailing_slash(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn join_url(base: &str, path: &str) -> String {
    let base = trim_trailing_slash(base);
    if path.starts_with("http://") || path.starts_with("https://") {
        return path.to_string();
    }
    if path.is_empty() {
        return base;
    }
    if path.starts_with('/') {
        format!("{}{}", base, path)
    } else {
        format!("{}/{}", base, path)
    }
}

fn shorten_error_body(body: &str) -> String {
    let compact = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.len() > 240 {
        format!("{}...", &compact[..240])
    } else {
        compact
    }
}

fn current_unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub(crate) fn load_settings() -> mcpviews_shared::settings::FirstPartyAiSettings {
    let mut cfg = mcpviews_shared::settings::Settings::load()
        .first_party_ai
        .unwrap_or_default();

    if let Some(value) = env_override(&["MCPVIEWS_FIRST_PARTY_AI_BASE_URL", "PROPAASAI_BASE_URL"]) {
        cfg.base_url = Some(trim_trailing_slash(&value));
    } else if let Some(value) = cfg.base_url.clone() {
        cfg.base_url = Some(trim_trailing_slash(&value));
    }

    if let Some(value) = env_override(&["MCPVIEWS_FIRST_PARTY_AI_AUTH_URL", "PROPAASAI_AUTH_URL"]) {
        cfg.auth_url = Some(value);
    }
    if let Some(value) = env_override(&["MCPVIEWS_FIRST_PARTY_AI_TOKEN_URL", "PROPAASAI_TOKEN_URL"]) {
        cfg.token_url = Some(value);
    }
    if let Some(value) = env_override(&["MCPVIEWS_FIRST_PARTY_AI_CLIENT_ID", "PROPAASAI_CLIENT_ID"]) {
        cfg.client_id = Some(value);
    }
    if let Some(value) = env_override(&[
        "MCPVIEWS_FIRST_PARTY_AI_RELAY_BASE_URL",
        "PROPAASAI_RELAY_BASE_URL",
    ]) {
        cfg.relay_base_url = Some(trim_trailing_slash(&value));
    } else if let Some(value) = cfg.relay_base_url.clone() {
        cfg.relay_base_url = Some(trim_trailing_slash(&value));
    }
    if let Some(value) = env_override(&[
        "MCPVIEWS_FIRST_PARTY_AI_DEVICE_BASE_URL",
        "PROPAASAI_DEVICE_BASE_URL",
    ]) {
        cfg.device_base_url = Some(trim_trailing_slash(&value));
    } else if let Some(value) = cfg.device_base_url.clone() {
        cfg.device_base_url = Some(trim_trailing_slash(&value));
    }
    if let Some(value) = env_override(&[
        "MCPVIEWS_FIRST_PARTY_AI_RELAY_TOKEN",
        "PROPAASAI_RELAY_TOKEN",
    ]) {
        cfg.relay_token = Some(value);
    }
    if let Some(value) = env_override_i64(&[
        "MCPVIEWS_FIRST_PARTY_AI_RELAY_TOKEN_EXPIRES_AT",
        "PROPAASAI_RELAY_TOKEN_EXPIRES_AT",
    ]) {
        cfg.relay_token_expires_at = Some(value);
    }
    if let Some(value) = env_override(&[
        "MCPVIEWS_FIRST_PARTY_AI_RELAY_DEVICE_ID",
        "PROPAASAI_RELAY_DEVICE_ID",
    ]) {
        cfg.relay_device_id = Some(value);
    }

    cfg
}

pub fn config_summary() -> Value {
    let cfg = load_settings();
    let relay_token_configured = cfg.relay_token.is_some()
        || mcpviews_shared::token_store::has_stored_token(
            &mcpviews_shared::auth_dir(),
            RELAY_AUTH_NAMESPACE,
        );
    json!({
        "configured": cfg.base_url.is_some(),
        "baseUrl": cfg.base_url,
        "authUrl": cfg.auth_url,
        "tokenUrl": cfg.token_url,
        "clientId": cfg.client_id,
        "relayBaseUrl": cfg.relay_base_url,
        "deviceBaseUrl": cfg.device_base_url,
        "relayTokenConfigured": relay_token_configured,
        "relayTokenExpiresAt": cfg.relay_token_expires_at,
        "relayDeviceId": cfg.relay_device_id,
        "authMode": "brokered_magic_link",
        "authConfigured": has_persisted_session(&mcpviews_shared::auth_dir())
            || mcpviews_shared::token_store::has_stored_token(&mcpviews_shared::auth_dir(), AUTH_NAMESPACE),
    })
}

pub(crate) fn build_request_url(path: &str) -> Result<String, String> {
    let cfg = load_settings();
    let base_url = cfg
        .base_url
        .ok_or_else(|| "First-party AI base URL is not configured".to_string())?;
    Ok(join_url(&base_url, path))
}

pub(crate) fn build_relay_request_url(path: &str) -> Result<String, String> {
    let cfg = load_settings();
    let base_url = cfg
        .relay_base_url
        .or(cfg.base_url)
        .ok_or_else(|| "First-party AI relay base URL is not configured".to_string())?;
    Ok(join_url(&base_url, path))
}

pub(crate) fn build_device_request_url(path: &str) -> Result<String, String> {
    let cfg = load_settings();
    let base_url = cfg
        .device_base_url
        .or(cfg.relay_base_url)
        .or(cfg.base_url)
        .ok_or_else(|| "First-party AI device base URL is not configured".to_string())?;
    Ok(join_url(&base_url, path))
}

pub async fn get_auth_header(state: &Arc<AppState>) -> Result<String, String> {
    if let Some(stored) =
        mcpviews_shared::token_store::load_stored_token(&state.auth_dir, AUTH_NAMESPACE)
    {
        return Ok(format!("Bearer {}", stored.access_token));
    }

    Err("First-party AI uses the session cookie established by magic-link sign-in.".to_string())
}

pub(crate) async fn get_relay_auth_header(state: &Arc<AppState>) -> Result<String, String> {
    if let Some(stored) =
        mcpviews_shared::token_store::load_stored_token(&state.auth_dir, RELAY_AUTH_NAMESPACE)
    {
        return Ok(format!("Bearer {}", stored.access_token));
    }

    let cfg = load_settings();
    if let Some(token) = cfg.relay_token {
        if let Some(expires_at) = cfg.relay_token_expires_at {
            if current_unix_timestamp() >= expires_at {
                return Err("First-party AI relay token has expired. Refresh the desktop relay session.".to_string());
            }
        }
        return Ok(format!("Bearer {}", token));
    }

    if let Ok(header) = get_auth_header(state).await {
        return Ok(header);
    }

    Err("First-party AI relay token is not configured.".to_string())
}

pub(crate) fn persist_relay_auth_with_paths(
    auth_dir: &std::path::Path,
    settings_path: &std::path::Path,
    token: &str,
    expires_at: Option<i64>,
    relay_base_url: Option<&str>,
    device_base_url: Option<&str>,
    relay_device_id: Option<&str>,
) -> Result<(), String> {
    persist_relay_session_with_paths(
        auth_dir,
        settings_path,
        Some(token),
        expires_at,
        relay_base_url,
        device_base_url,
        relay_device_id,
    )
}

pub(crate) fn persist_relay_session_with_paths(
    auth_dir: &std::path::Path,
    settings_path: &std::path::Path,
    token: Option<&str>,
    expires_at: Option<i64>,
    relay_base_url: Option<&str>,
    device_base_url: Option<&str>,
    relay_device_id: Option<&str>,
) -> Result<(), String> {
    let should_persist_settings =
        token.is_some() || relay_base_url.is_some() || device_base_url.is_some() || relay_device_id.is_some();
    if let Some(token) = token {
        mcpviews_shared::token_store::store_token(
            &auth_dir,
            RELAY_AUTH_NAMESPACE,
            &mcpviews_shared::token_store::StoredToken {
                access_token: token.to_string(),
                refresh_token: None,
                expires_at,
            },
        )?;
    }

    if should_persist_settings {
        let mut settings = mcpviews_shared::settings::Settings::load_from_path(settings_path);
        let relay_settings = settings.first_party_ai.get_or_insert_with(Default::default);
        if let Some(token) = token {
            relay_settings.relay_token = Some(token.to_string());
            relay_settings.relay_token_expires_at = expires_at;
        }
        if let Some(url) = relay_base_url {
            relay_settings.relay_base_url = Some(trim_trailing_slash(url));
        }
        if let Some(url) = device_base_url {
            relay_settings.device_base_url = Some(trim_trailing_slash(url));
        }
        if let Some(device_id) = relay_device_id {
            relay_settings.relay_device_id = Some(device_id.to_string());
        }
        settings.save_to_path(settings_path)?;
    }
    Ok(())
}

pub(crate) fn clear_relay_auth() -> Result<(), String> {
    let auth_dir = mcpviews_shared::auth_dir();
    let _ = mcpviews_shared::token_store::remove_token(&auth_dir, RELAY_AUTH_NAMESPACE);

    let mut settings = mcpviews_shared::settings::Settings::load();
    let mut changed = false;
    if let Some(relay_settings) = settings.first_party_ai.as_mut() {
        if relay_settings.relay_token.is_some() || relay_settings.relay_token_expires_at.is_some() {
            changed = true;
        }
        relay_settings.relay_token = None;
        relay_settings.relay_token_expires_at = None;
    }
    if changed {
        settings.save()
    } else {
        Ok(())
    }
}

pub(crate) fn apply_relay_session_response(
    response: &Value,
    fallback_relay_base_url: Option<&str>,
    fallback_device_base_url: Option<&str>,
) -> Result<Value, String> {
    let token = response
        .get("relayToken")
        .or_else(|| response.get("relay_token"))
        .or_else(|| response.get("accessToken"))
        .or_else(|| response.get("access_token"))
        .or_else(|| response.get("token"))
        .or_else(|| response.get("relayAccessToken"))
        .and_then(|value| value.as_str());

    if let Some(token) = token {
        let expires_at = response
            .get("relayTokenExpiresAt")
            .or_else(|| response.get("relay_token_expires_at"))
            .or_else(|| response.get("expiresAt"))
            .or_else(|| response.get("expires_at"))
            .and_then(|value| value.as_i64());
        let relay_base_url = response
            .get("relayBaseUrl")
            .or_else(|| response.get("relay_base_url"))
            .and_then(|value| value.as_str())
            .or(fallback_relay_base_url);
        let device_base_url = response
            .get("deviceBaseUrl")
            .or_else(|| response.get("device_base_url"))
            .and_then(|value| value.as_str())
            .or(fallback_device_base_url);
        let relay_device_id = response
            .get("relayDeviceId")
            .or_else(|| response.get("relay_device_id"))
            .or_else(|| response.get("deviceId"))
            .or_else(|| response.get("device_id"))
            .and_then(|value| value.as_str());

        persist_relay_session_with_paths(
            &mcpviews_shared::auth_dir(),
            &mcpviews_shared::config_path(),
            Some(token),
            expires_at,
            relay_base_url,
            device_base_url,
            relay_device_id,
        )?;
    } else {
        let relay_base_url = response
            .get("relayBaseUrl")
            .or_else(|| response.get("relay_base_url"))
            .and_then(|value| value.as_str())
            .or(fallback_relay_base_url);
        let device_base_url = response
            .get("deviceBaseUrl")
            .or_else(|| response.get("device_base_url"))
            .and_then(|value| value.as_str())
            .or(fallback_device_base_url);
        let relay_device_id = response
            .get("relayDeviceId")
            .or_else(|| response.get("relay_device_id"))
            .or_else(|| response.get("deviceId"))
            .or_else(|| response.get("device_id"))
            .and_then(|value| value.as_str());
        persist_relay_session_with_paths(
            &mcpviews_shared::auth_dir(),
            &mcpviews_shared::config_path(),
            None,
            None,
            relay_base_url,
            device_base_url,
            relay_device_id,
        )?;
    }

    Ok(response.clone())
}

pub async fn proxy_request(
    state: &Arc<AppState>,
    method: &str,
    path: &str,
    body: Option<Value>,
    query: Option<HashMap<String, String>>,
) -> Result<Value, String> {
    let url = build_request_url(path)?;
    let method = method
        .parse::<reqwest::Method>()
        .map_err(|err| format!("Invalid HTTP method '{}': {}", method, err))?;

    let mut request = state
        .http_client
        .request(method, &url)
        .header("Accept", "application/json");

    if let Ok(header) = get_auth_header(state).await {
        request = request.header("Authorization", header);
    }

    if let Some(query) = query {
        request = request.query(&query);
    }
    if let Some(body) = body {
        request = request.json(&body);
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("Request to '{}' failed: {}", url, err))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Failed to read response from '{}': {}", url, err))?;
    state.persist_first_party_ai_cookies()?;

    if !status.is_success() {
        return Err(format!(
            "HTTP {} from '{}': {}",
            status.as_u16(),
            url,
            shorten_error_body(&text)
        ));
    }

    if text.trim().is_empty() {
        return Ok(json!({}));
    }

    serde_json::from_str(&text)
        .map_err(|err| format!("Failed to parse JSON from '{}': {} ({})", url, err, shorten_error_body(&text)))
}

pub async fn start_auth(state: &Arc<AppState>) -> Result<String, String> {
    let _ = state;
    Err("First-party AI now uses magic-link sign-in. Send a magic link, then verify it, instead of starting an OAuth flow.".to_string())
}

pub async fn get_session(state: &Arc<AppState>) -> Result<Value, String> {
    let url = build_request_url("/api/auth/get-session")?;
    let response = state
        .http_client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|err| format!("Request to '{}' failed: {}", url, err))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Failed to read response from '{}': {}", url, err))?;
    state.persist_first_party_ai_cookies()?;

    if !status.is_success() {
        return Err(format!(
            "HTTP {} from '{}': {}",
            status.as_u16(),
            url,
            shorten_error_body(&text)
        ));
    }

    if text.trim().is_empty() || text.trim() == "null" {
        return Ok(Value::Null);
    }

    serde_json::from_str(&text)
        .map_err(|err| format!("Failed to parse JSON from '{}': {} ({})", url, err, shorten_error_body(&text)))
}

pub async fn send_magic_link(state: &Arc<AppState>, email: &str) -> Result<Value, String> {
    let url = build_request_url("/api/auth/sign-in/magic-link")?;
    let response = state
        .http_client
        .post(&url)
        .header("Accept", "application/json")
        .json(&json!({
            "email": email,
            "callbackURL": "/admin",
        }))
        .send()
        .await
        .map_err(|err| format!("Request to '{}' failed: {}", url, err))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Failed to read response from '{}': {}", url, err))?;
    state.persist_first_party_ai_cookies()?;

    if !status.is_success() {
        return Err(format!(
            "HTTP {} from '{}': {}",
            status.as_u16(),
            url,
            shorten_error_body(&text)
        ));
    }

    if text.trim().is_empty() {
        return Ok(json!({ "status": true }));
    }

    serde_json::from_str(&text)
        .map_err(|err| format!("Failed to parse JSON from '{}': {} ({})", url, err, shorten_error_body(&text)))
}

pub async fn verify_magic_link(
    state: &Arc<AppState>,
    verification_url_or_token: &str,
) -> Result<Value, String> {
    let raw = verification_url_or_token.trim();
    if raw.is_empty() {
        return Err("Magic link verification URL or token is required.".to_string());
    }

    let verify_url = if raw.starts_with("http://") || raw.starts_with("https://") {
        raw.to_string()
    } else {
        build_request_url(&format!("/api/auth/magic-link/verify?token={}", raw))?
    };

    let response = state
        .http_client
        .get(&verify_url)
        .header("Accept", "text/html,application/json")
        .send()
        .await
        .map_err(|err| format!("Request to '{}' failed: {}", verify_url, err))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        state.persist_first_party_ai_cookies()?;
        return Err(format!(
            "HTTP {} from '{}': {}",
            status.as_u16(),
            verify_url,
            shorten_error_body(&body)
        ));
    }

    state.persist_first_party_ai_cookies()?;
    get_session(state).await
}

pub async fn clear_auth(state: &Arc<AppState>) -> Result<(), String> {
    let sign_out_url = build_request_url("/api/auth/sign-out")?;
    let _ = state
        .http_client
        .post(&sign_out_url)
        .header("Accept", "application/json")
        .send()
        .await;

    let _ = state.clear_first_party_ai_cookies();
    let _ = mcpviews_shared::token_store::remove_token(&state.auth_dir, AUTH_NAMESPACE);
    let _ = clear_relay_auth();
    Ok(())
}

async fn emit_stream_event(app_handle: &AppHandle, payload: Value) {
    let _ = app_handle.emit("first_party_ai_stream_event", payload);
}

fn parse_sse_payload(raw_data: &str) -> Value {
    serde_json::from_str::<Value>(raw_data).unwrap_or_else(|_| {
        json!({
            "raw": raw_data,
        })
    })
}

async fn emit_companion_data_event(
    app_handle: &AppHandle,
    thread_id: &str,
    raw_data: &str,
    pending_sequence: Option<i64>,
    pending_event_name: Option<&str>,
) {
    let mut payload = parse_sse_payload(raw_data);
    if let Some(sequence) = pending_sequence {
        if let Some(payload_object) = payload.as_object_mut() {
            payload_object.insert("sequence".to_string(), json!(sequence));
        }
    }

    let mut envelope = json!({
        "threadId": thread_id,
        "type": "data",
        "payload": payload,
    });

    if let Some(event_name) = pending_event_name {
        if !event_name.is_empty() {
            envelope["sseEvent"] = json!(event_name);
        }
    }

    emit_stream_event(app_handle, envelope).await;
}

pub fn stop_companion_stream(state: &Arc<AppState>, thread_id: &str) {
    let mut streams = state.first_party_ai_streams.lock().unwrap();
    if let Some(handle) = streams.remove(thread_id) {
        handle.abort();
    }
}

pub async fn start_companion_stream(
    state: Arc<AppState>,
    app_handle: AppHandle,
    thread_id: String,
    companion_key: String,
) -> Result<(), String> {
    stop_companion_stream(&state, &thread_id);

    let stream_url = build_request_url("/api/companion/stream")?;
    let client = state.http_client.clone();
    let app_handle_clone = app_handle.clone();
    let thread_id_clone = thread_id.clone();

    let handle = tokio::spawn(async move {
        emit_stream_event(
            &app_handle_clone,
            json!({
                "threadId": thread_id_clone,
                "type": "status",
                "status": "connecting",
            }),
        )
        .await;

        let response = client
            .get(&stream_url)
            .header("Authorization", format!("Bearer {}", companion_key))
            .header("Accept", "text/event-stream")
            .send()
            .await;

        let mut response = match response {
            Ok(response) => response,
            Err(err) => {
                emit_stream_event(
                    &app_handle_clone,
                    json!({
                        "threadId": thread_id_clone,
                        "type": "error",
                        "message": format!("Failed to connect to companion stream: {}", err),
                    }),
                )
                .await;
                return;
            }
        };

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            emit_stream_event(
                &app_handle_clone,
                json!({
                    "threadId": thread_id_clone,
                    "type": "error",
                    "message": format!("Companion stream returned HTTP {}: {}", status, shorten_error_body(&body)),
                }),
            )
            .await;
            return;
        }

        emit_stream_event(
            &app_handle_clone,
            json!({
                "threadId": thread_id_clone,
                "type": "status",
                "status": "connected",
            }),
        )
        .await;

        let mut buffer = String::new();
        let mut pending_sequence: Option<i64> = None;
        let mut pending_event_name: Option<String> = None;
        let mut pending_data_lines: Vec<String> = Vec::new();

        loop {
            let chunk = match response.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(err) => {
                    emit_stream_event(
                        &app_handle_clone,
                        json!({
                            "threadId": thread_id_clone,
                            "type": "error",
                            "message": format!("Companion stream read failed: {}", err),
                        }),
                    )
                    .await;
                    return;
                }
            };

            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(idx) = buffer.find('\n') {
                let line = buffer[..idx].trim_end_matches('\r').to_string();
                buffer = buffer[idx + 1..].to_string();

                if line.is_empty() {
                    if !pending_data_lines.is_empty() {
                        let raw_data = pending_data_lines.join("\n");
                        emit_companion_data_event(
                            &app_handle_clone,
                            &thread_id_clone,
                            &raw_data,
                            pending_sequence.take(),
                            pending_event_name.as_deref(),
                        )
                        .await;
                        pending_data_lines.clear();
                    }
                    pending_event_name = None;
                    continue;
                }

                if line.starts_with(':') {
                    continue;
                }

                if let Some(id) = line.strip_prefix("id:") {
                    pending_sequence = id.trim().parse::<i64>().ok();
                    continue;
                }

                if let Some(event_name) = line.strip_prefix("event:") {
                    let event_name = event_name.trim();
                    pending_event_name = if event_name.is_empty() {
                        None
                    } else {
                        Some(event_name.to_string())
                    };
                    continue;
                }

                if let Some(data) = line.strip_prefix("data:") {
                    pending_data_lines.push(data.trim_start().to_string());
                }
            }
        }

        if !pending_data_lines.is_empty() {
            let raw_data = pending_data_lines.join("\n");
            emit_companion_data_event(
                &app_handle_clone,
                &thread_id_clone,
                &raw_data,
                pending_sequence.take(),
                pending_event_name.as_deref(),
            )
            .await;
        }

        emit_stream_event(
            &app_handle_clone,
            json!({
                "threadId": thread_id_clone,
                "type": "status",
                "status": "closed",
            }),
        )
        .await;
    });

    let mut streams = state.first_party_ai_streams.lock().unwrap();
    streams.insert(thread_id, handle);
    Ok(())
}
