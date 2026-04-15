use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::first_party_ai;
use crate::state::AppState;

enum EndpointScope {
    Relay,
    Device,
}

fn shorten_error_body(body: &str) -> String {
    let compact = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.len() > 240 {
        format!("{}...", &compact[..240])
    } else {
        compact
    }
}

fn emit_event(app_handle: &AppHandle, event_name: &str, payload: Value) {
    let _ = app_handle.emit(event_name, payload);
}

fn endpoint_url(scope: EndpointScope, path: &str) -> Result<String, String> {
    match scope {
        EndpointScope::Relay => first_party_ai::build_relay_request_url(path),
        EndpointScope::Device => first_party_ai::build_device_request_url(path),
    }
}

async fn auth_header(state: &Arc<AppState>) -> Result<String, String> {
    first_party_ai::get_relay_auth_header(state).await
}

async fn scoped_request(
    state: &Arc<AppState>,
    scope: EndpointScope,
    method: &str,
    path: &str,
    body: Option<Value>,
    query: Option<HashMap<String, String>>,
) -> Result<Value, String> {
    let url = endpoint_url(scope, path)?;
    let method = method
        .parse::<reqwest::Method>()
        .map_err(|err| format!("Invalid HTTP method '{}': {}", method, err))?;

    let mut request = state
        .http_client
        .request(method, &url)
        .header("Accept", "application/json");

    if let Ok(header) = auth_header(state).await {
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

    serde_json::from_str(&text).map_err(|err| {
        format!(
            "Failed to parse JSON from '{}': {} ({})",
            url,
            err,
            shorten_error_body(&text)
        )
    })
}

pub async fn relay_request(
    state: &Arc<AppState>,
    method: &str,
    path: &str,
    body: Option<Value>,
    query: Option<HashMap<String, String>>,
) -> Result<Value, String> {
    scoped_request(state, EndpointScope::Relay, method, path, body, query).await
}

pub async fn register_desktop_relay(
    state: &Arc<AppState>,
    body: Option<Value>,
) -> Result<Value, String> {
    let settings = first_party_ai::load_settings();
    let response = scoped_request(
        state,
        EndpointScope::Device,
        "POST",
        "/api/desktop-relay/register",
        body,
        None,
    )
    .await?;

    first_party_ai::apply_relay_session_response(
        &response,
        settings.relay_base_url.as_deref(),
        settings.device_base_url.as_deref(),
    )
}

pub async fn refresh_desktop_relay(
    state: &Arc<AppState>,
    body: Option<Value>,
) -> Result<Value, String> {
    let settings = first_party_ai::load_settings();
    let response = scoped_request(
        state,
        EndpointScope::Device,
        "POST",
        "/api/desktop-relay/refresh",
        body,
        None,
    )
    .await?;

    first_party_ai::apply_relay_session_response(
        &response,
        settings.relay_base_url.as_deref(),
        settings.device_base_url.as_deref(),
    )
}

pub async fn start_desktop_relay_stream(
    state: Arc<AppState>,
    app_handle: AppHandle,
    stream_id: String,
    path: Option<String>,
    query: Option<HashMap<String, String>>,
) -> Result<(), String> {
    stop_desktop_relay_stream(&state, &stream_id);

    let url_path = path.unwrap_or_else(|| "/api/desktop-relay/stream".to_string());
    let event_name = "first_party_ai_desktop_relay_event";
    let url = endpoint_url(EndpointScope::Relay, &url_path)?;
    let auth_header = auth_header(&state).await?;
    let client = state.http_client.clone();
    let app_handle_clone = app_handle.clone();
    let stream_id_clone = stream_id.clone();

    let handle = tokio::spawn(async move {
        emit_event(
            &app_handle_clone,
            event_name,
            json!({
                "relayId": stream_id_clone,
                "type": "status",
                "status": "connecting",
            }),
        );

        let mut request = client
            .get(&url)
            .header("Authorization", auth_header)
            .header("Accept", "text/event-stream");
        if let Some(query) = query {
            request = request.query(&query);
        }

        let response = request.send().await;

        let mut response = match response {
            Ok(response) => response,
            Err(err) => {
                emit_event(
                    &app_handle_clone,
                    event_name,
                    json!({
                        "relayId": stream_id_clone,
                        "type": "error",
                        "message": format!("Failed to connect to relay stream: {}", err),
                    }),
                );
                return;
            }
        };

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            emit_event(
                &app_handle_clone,
                event_name,
                json!({
                    "relayId": stream_id_clone,
                    "type": "error",
                    "message": format!("Relay stream returned HTTP {}: {}", status, shorten_error_body(&body)),
                }),
            );
            return;
        }

        emit_event(
            &app_handle_clone,
            event_name,
            json!({
                "relayId": stream_id_clone,
                "type": "status",
                "status": "connected",
            }),
        );

        let mut buffer = String::new();

        loop {
            let chunk = match response.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(err) => {
                    emit_event(
                        &app_handle_clone,
                        event_name,
                        json!({
                            "relayId": stream_id_clone,
                            "type": "error",
                            "message": format!("Relay stream read failed: {}", err),
                        }),
                    );
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

                    emit_event(
                        &app_handle_clone,
                        event_name,
                        json!({
                            "relayId": stream_id_clone,
                            "type": "data",
                            "payload": payload,
                        }),
                    );
                }
            }
        }

        emit_event(
            &app_handle_clone,
            event_name,
            json!({
                "relayId": stream_id_clone,
                "type": "status",
                "status": "closed",
            }),
        );
    });

    let mut streams = state.first_party_ai_desktop_relay_streams.lock().unwrap();
    streams.insert(stream_id, handle);
    Ok(())
}

pub fn stop_desktop_relay_stream(state: &Arc<AppState>, stream_id: &str) {
    let mut streams = state.first_party_ai_desktop_relay_streams.lock().unwrap();
    if let Some(handle) = streams.remove(stream_id) {
        handle.abort();
    }
}

pub async fn start_desktop_presence_heartbeat(
    state: Arc<AppState>,
    app_handle: AppHandle,
    heartbeat_id: String,
    path: Option<String>,
    interval_secs: u64,
    body: Option<Value>,
) -> Result<(), String> {
    stop_desktop_presence_heartbeat(&state, &heartbeat_id);

    let url_path = path.unwrap_or_else(|| "/api/desktop-relay/presence".to_string());
    let event_name = "first_party_ai_desktop_presence_event";
    let url = endpoint_url(EndpointScope::Device, &url_path)?;
    let auth_header = auth_header(&state).await?;
    let client = state.http_client.clone();
    let app_handle_clone = app_handle.clone();
    let heartbeat_id_clone = heartbeat_id.clone();
    let interval_secs = interval_secs.max(1);

    let handle = tokio::spawn(async move {
        emit_event(
            &app_handle_clone,
            event_name,
            json!({
                "heartbeatId": heartbeat_id_clone,
                "type": "status",
                "status": "connecting",
            }),
        );

        let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            ticker.tick().await;

            let mut request = client
                .post(&url)
                .header("Authorization", auth_header.clone())
                .header("Accept", "application/json");
            if let Some(ref body) = body {
                request = request.json(body);
            }

            match request.send().await {
                Ok(response) => {
                    if !response.status().is_success() {
                        let status = response.status().as_u16();
                        let body = response.text().await.unwrap_or_default();
                        emit_event(
                            &app_handle_clone,
                            event_name,
                            json!({
                                "heartbeatId": heartbeat_id_clone,
                                "type": "error",
                                "message": format!("Presence heartbeat returned HTTP {}: {}", status, shorten_error_body(&body)),
                            }),
                        );
                        return;
                    }
                }
                Err(err) => {
                    emit_event(
                        &app_handle_clone,
                        event_name,
                        json!({
                            "heartbeatId": heartbeat_id_clone,
                            "type": "error",
                            "message": format!("Presence heartbeat failed: {}", err),
                        }),
                    );
                    return;
                }
            }

            emit_event(
                &app_handle_clone,
                event_name,
                json!({
                    "heartbeatId": heartbeat_id_clone,
                    "type": "status",
                    "status": "running",
                }),
            );
        }
    });

    let mut heartbeats = state
        .first_party_ai_desktop_presence_heartbeats
        .lock()
        .unwrap();
    heartbeats.insert(heartbeat_id, handle);
    Ok(())
}

pub fn stop_desktop_presence_heartbeat(state: &Arc<AppState>, heartbeat_id: &str) {
    let mut heartbeats = state
        .first_party_ai_desktop_presence_heartbeats
        .lock()
        .unwrap();
    if let Some(handle) = heartbeats.remove(heartbeat_id) {
        handle.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::test_app_state;

    #[test]
    fn relay_handles_stop_missing_handles() {
        let (state, _dir) = test_app_state();
        stop_desktop_relay_stream(&state, "missing");
        stop_desktop_presence_heartbeat(&state, "missing");
    }

    #[test]
    fn persist_relay_auth_with_paths_persists_token() {
        let dir = tempfile::tempdir().unwrap();
        let auth_dir = dir.path().join("auth");
        let settings_path = dir.path().join("config.json");

        first_party_ai::persist_relay_auth_with_paths(
            &auth_dir,
            &settings_path,
            "relay-123",
            Some(2_000_000_000),
            Some("https://relay.example.com"),
            Some("https://device.example.com"),
            Some("device-1"),
        )
        .unwrap();

        let token = mcpviews_shared::token_store::load_stored_token(&auth_dir, "first_party_ai_relay")
            .expect("relay token should persist");
        assert_eq!(token.access_token, "relay-123");
        assert_eq!(token.expires_at, Some(2_000_000_000));

        let settings = mcpviews_shared::settings::Settings::load_from_path(&settings_path);
        let relay = settings.first_party_ai.expect("first_party_ai config");
        assert_eq!(relay.relay_base_url.as_deref(), Some("https://relay.example.com"));
        assert_eq!(relay.device_base_url.as_deref(), Some("https://device.example.com"));
        assert_eq!(relay.relay_device_id.as_deref(), Some("device-1"));
    }
}
