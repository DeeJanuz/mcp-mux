use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::state::AppState;

const AUTH_NAMESPACE: &str = "first_party_ai";

fn env_override(keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
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

pub fn load_settings() -> mcpviews_shared::settings::FirstPartyAiSettings {
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

    cfg
}

pub fn config_summary() -> Value {
    let cfg = load_settings();
    json!({
        "configured": cfg.base_url.is_some(),
        "baseUrl": cfg.base_url,
        "authUrl": cfg.auth_url,
        "tokenUrl": cfg.token_url,
        "clientId": cfg.client_id,
        "authMode": "brokered_magic_link",
        "authConfigured": mcpviews_shared::token_store::has_stored_token(&mcpviews_shared::auth_dir(), AUTH_NAMESPACE),
    })
}

pub fn build_request_url(path: &str) -> Result<String, String> {
    let cfg = load_settings();
    let base_url = cfg
        .base_url
        .ok_or_else(|| "First-party AI base URL is not configured".to_string())?;
    Ok(join_url(&base_url, path))
}

pub async fn get_auth_header(_state: &Arc<AppState>) -> Result<String, String> {
    if let Some(stored) =
        mcpviews_shared::token_store::load_stored_token(&mcpviews_shared::auth_dir(), AUTH_NAMESPACE)
    {
        return Ok(format!("Bearer {}", stored.access_token));
    }

    Err("First-party AI uses the session cookie established by magic-link sign-in.".to_string())
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
        return Err(format!(
            "HTTP {} from '{}': {}",
            status.as_u16(),
            verify_url,
            shorten_error_body(&body)
        ));
    }

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

    let _ = mcpviews_shared::token_store::remove_token(&mcpviews_shared::auth_dir(), AUTH_NAMESPACE);
    Ok(())
}

async fn emit_stream_event(app_handle: &AppHandle, payload: Value) {
    let _ = app_handle.emit("first_party_ai_stream_event", payload);
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
                let line = buffer[..idx].trim().to_string();
                buffer = buffer[idx + 1..].to_string();

                if let Some(data) = line.strip_prefix("data: ") {
                    let payload = serde_json::from_str::<Value>(data).unwrap_or_else(|_| {
                        json!({
                            "raw": data,
                        })
                    });

                    emit_stream_event(
                        &app_handle_clone,
                        json!({
                            "threadId": thread_id_clone,
                            "type": "data",
                            "payload": payload,
                        }),
                    )
                    .await;
                }
            }
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
