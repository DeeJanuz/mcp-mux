use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::AsyncAppState;
use crate::first_party_ai;
use crate::mcp_tools;
use crate::state::AppState;

enum EndpointScope {
    Relay,
    Device,
}

const RELAY_TOOL_SNAPSHOT_PATH: &str = "/api/desktop-relay/tools/list";
const RELAY_TOOL_RESPONSE_PATH: &str = "/api/desktop-relay/tools/response";

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

fn parse_json_payload(raw_data: &str) -> Value {
    serde_json::from_str::<Value>(raw_data).unwrap_or_else(|_| {
        json!({
            "raw": raw_data,
        })
    })
}

fn get_nested_value<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

fn extract_string(value: Option<&Value>) -> Option<String> {
    value.and_then(|entry| entry.as_str()).map(|entry| entry.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum HostedToolMethod {
    List,
    Call,
}

impl HostedToolMethod {
    fn as_str(&self) -> &'static str {
        match self {
            Self::List => "tools/list",
            Self::Call => "tools/call",
        }
    }
}

#[derive(Debug, Clone)]
struct HostedToolRequest {
    method: HostedToolMethod,
    request_id: Option<Value>,
    tool_name: Option<String>,
    arguments: Value,
    relay_session_id: Option<String>,
    device_id: Option<String>,
    workspace_id: Option<String>,
    thread_id: Option<String>,
}

fn extract_hosted_tool_request(payload: &Value) -> Option<HostedToolRequest> {
    let request = payload.get("request").unwrap_or(payload);
    let params = request
        .get("params")
        .or_else(|| payload.get("params"))
        .unwrap_or(payload);

    let mut method = extract_string(request.get("method"))
        .or_else(|| extract_string(payload.get("method")))
        .unwrap_or_default()
        .trim()
        .to_lowercase();

    if method.is_empty() {
        method = extract_string(payload.get("type"))
            .or_else(|| extract_string(payload.get("event")))
            .or_else(|| extract_string(payload.get("kind")))
            .unwrap_or_default()
            .trim()
            .to_lowercase();
    }

    let method = match method.as_str() {
        "tools/list" | "tools.list" | "mcp.tools/list" | "mcp_tools_list" | "mcp.tools_list" => {
            HostedToolMethod::List
        }
        "tools/call"
        | "tools.call"
        | "tool_request"
        | "tool.call"
        | "mcp.tool_request"
        | "mcp.tool_call"
        | "mcp.tools/call"
        | "mcp_tools_call" => HostedToolMethod::Call,
        _ => {
            if extract_string(params.get("name"))
                .or_else(|| extract_string(params.get("toolName")))
                .or_else(|| extract_string(params.get("tool_name")))
                .or_else(|| extract_string(payload.get("toolName")))
                .or_else(|| extract_string(payload.get("tool_name")))
                .is_some()
            {
                HostedToolMethod::Call
            } else {
                return None;
            }
        }
    };

    let request_id = request
        .get("id")
        .cloned()
        .or_else(|| payload.get("requestId").cloned())
        .or_else(|| payload.get("request_id").cloned())
        .or_else(|| payload.get("id").cloned());

    let tool_name = extract_string(params.get("name"))
        .or_else(|| extract_string(params.get("toolName")))
        .or_else(|| extract_string(params.get("tool_name")))
        .or_else(|| extract_string(payload.get("toolName")))
        .or_else(|| extract_string(payload.get("tool_name")))
        .or_else(|| extract_string(payload.get("name")));

    if method == HostedToolMethod::Call && tool_name.is_none() {
        return None;
    }

    let arguments = params
        .get("arguments")
        .cloned()
        .or_else(|| params.get("input").cloned())
        .or_else(|| params.get("toolArgs").cloned())
        .or_else(|| params.get("tool_args").cloned())
        .or_else(|| request.get("toolArgs").cloned())
        .or_else(|| request.get("tool_args").cloned())
        .or_else(|| request.get("input").cloned())
        .or_else(|| payload.get("arguments").cloned())
        .or_else(|| payload.get("toolArgs").cloned())
        .or_else(|| payload.get("tool_args").cloned())
        .or_else(|| payload.get("input").cloned())
        .or_else(|| payload.get("args").cloned())
        .unwrap_or_else(|| json!({}));

    let thread_id = extract_string(payload.get("threadId"))
        .or_else(|| extract_string(get_nested_value(payload, &["context", "threadId"])))
        .or_else(|| extract_string(get_nested_value(&arguments, &["toolArgs", "threadId"])))
        .or_else(|| extract_string(get_nested_value(&arguments, &["toolArgs", "thread_id"])))
        .or_else(|| extract_string(get_nested_value(&arguments, &["tool_args", "threadId"])))
        .or_else(|| extract_string(get_nested_value(&arguments, &["tool_args", "thread_id"])))
        .or_else(|| extract_string(get_nested_value(&arguments, &["meta", "threadId"])))
        .or_else(|| extract_string(get_nested_value(&arguments, &["meta", "thread_id"])));

    Some(HostedToolRequest {
        method,
        request_id,
        tool_name,
        arguments,
        relay_session_id: extract_string(payload.get("relaySessionId"))
            .or_else(|| extract_string(get_nested_value(payload, &["context", "relaySessionId"]))),
        device_id: extract_string(payload.get("deviceId"))
            .or_else(|| extract_string(get_nested_value(payload, &["context", "deviceId"]))),
        workspace_id: extract_string(payload.get("workspaceId"))
            .or_else(|| extract_string(get_nested_value(payload, &["context", "workspaceId"]))),
        thread_id,
    })
}

fn build_tool_snapshot_payload(response: &Value, tools: Vec<Value>) -> Value {
    let tool_count = tools.len();
    json!({
        "method": "tools/list",
        "relaySessionId": extract_string(response.get("relaySessionId"))
            .or_else(|| extract_string(get_nested_value(response, &["relaySession", "id"]))),
        "deviceId": extract_string(response.get("relayDeviceId"))
            .or_else(|| extract_string(response.get("deviceId"))),
        "workspaceId": extract_string(response.get("workspaceId")),
        "threadId": extract_string(response.get("threadId")),
        "tools": tools,
        "toolCount": tool_count,
    })
}

fn build_tool_response_payload(request: &HostedToolRequest, result: Value) -> Value {
    let request_id = request.request_id.as_ref().map(|value| match value {
        Value::String(inner) => inner.clone(),
        _ => value.to_string(),
    });
    let request_id_value = request.request_id.clone();
    let is_error = result
        .get("isError")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let error = if is_error {
        result
            .get("content")
            .and_then(|value| value.as_array())
            .and_then(|entries| {
                entries.iter().find_map(|entry| {
                    entry
                        .get("text")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                })
            })
            .or_else(|| Some("Hosted desktop relay tool failed.".to_string()))
    } else {
        None
    };

    json!({
        "jsonrpc": "2.0",
        "id": request_id_value,
        "relaySessionId": request.relay_session_id,
        "requestId": request_id,
        "success": !is_error,
        "result": result,
        "error": error,
    })
}

fn build_tool_error_result(message: &str) -> Value {
    json!({
        "content": [{
            "type": "text",
            "text": message,
        }],
        "isError": true,
    })
}

fn enrich_thread_scoped_renderer_arguments(request: &HostedToolRequest) -> Value {
    let arguments = request.arguments.clone();
    let Some(thread_id) = request.thread_id.as_ref() else {
        return arguments;
    };
    let Some(tool_name) = request.tool_name.as_ref() else {
        return arguments;
    };
    if !matches!(tool_name.as_str(), "rich_content" | "structured_data") {
        return arguments;
    }

    let mut object = match arguments.as_object() {
        Some(existing) => existing.clone(),
        None => serde_json::Map::new(),
    };

    let mut meta = object
        .get("meta")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    meta.insert("threadId".to_string(), json!(thread_id));
    meta.insert("artifactSource".to_string(), json!("tribex-ai-thread-result"));
    object.insert("meta".to_string(), Value::Object(meta));

    let mut tool_args = object
        .get("toolArgs")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    tool_args.insert("threadId".to_string(), json!(thread_id));
    tool_args.insert("artifactSource".to_string(), json!("tribex-ai-thread-result"));
    object.insert("toolArgs".to_string(), Value::Object(tool_args));

    Value::Object(object)
}

async fn publish_tools_snapshot(
    state: Arc<AppState>,
    app_handle: AppHandle,
    response: Value,
) -> Result<(), String> {
    let async_state = Arc::new(TokioMutex::new(AsyncAppState {
        inner: Arc::clone(&state),
        app_handle,
    }));
    let tools = mcp_tools::list_tools(&async_state).await;
    let payload = build_tool_snapshot_payload(&response, tools);
    scoped_request(
        &state,
        EndpointScope::Relay,
        "POST",
        RELAY_TOOL_SNAPSHOT_PATH,
        Some(payload),
        None,
    )
    .await
    .map(|_| ())
}

async fn execute_hosted_tool_request(
    state: Arc<AppState>,
    app_handle: AppHandle,
    request: HostedToolRequest,
) -> Value {
    let async_state = Arc::new(TokioMutex::new(AsyncAppState {
        inner: Arc::clone(&state),
        app_handle,
    }));

    match request.method {
        HostedToolMethod::List => {
            let tools = mcp_tools::list_tools(&async_state).await;
            json!({ "tools": tools })
        }
        HostedToolMethod::Call => {
            let tool_name = request.tool_name.clone().unwrap_or_default();
            let arguments = enrich_thread_scoped_renderer_arguments(&request);
            match mcp_tools::call_tool(&tool_name, arguments, &async_state).await {
                Ok(result) => result,
                Err(message) => build_tool_error_result(&message),
            }
        }
    }
}

async fn execute_hosted_tool_request_with_async_state(
    async_state: &Arc<TokioMutex<AsyncAppState>>,
    request: HostedToolRequest,
) -> Value {
    match request.method {
        HostedToolMethod::List => {
            let tools = mcp_tools::list_tools(async_state).await;
            json!({ "tools": tools })
        }
        HostedToolMethod::Call => {
            let tool_name = request.tool_name.clone().unwrap_or_default();
            let arguments = enrich_thread_scoped_renderer_arguments(&request);
            match mcp_tools::call_tool(&tool_name, arguments, async_state).await {
                Ok(result) => result,
                Err(message) => build_tool_error_result(&message),
            }
        }
    }
}

fn build_local_tool_request_response(payload: &Value, result: Value) -> Value {
    let request = payload.get("request").unwrap_or(payload);
    let request_id = request
        .get("id")
        .cloned()
        .or_else(|| payload.get("requestId").cloned())
        .or_else(|| payload.get("request_id").cloned())
        .or_else(|| payload.get("id").cloned());
    let uses_jsonrpc = request
        .get("jsonrpc")
        .and_then(|value| value.as_str())
        .map(|value| value == "2.0")
        .unwrap_or(false)
        || payload
            .get("jsonrpc")
            .and_then(|value| value.as_str())
            .map(|value| value == "2.0")
            .unwrap_or(false);

    if uses_jsonrpc {
        let is_error = result
            .get("isError")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        if is_error {
            let message = result
                .get("content")
                .and_then(|value| value.as_array())
                .and_then(|entries| {
                    entries.iter().find_map(|entry| {
                        entry
                            .get("text")
                            .and_then(|value| value.as_str())
                            .map(|value| value.to_string())
                    })
                })
                .unwrap_or_else(|| "Hosted desktop relay tool failed.".to_string());
            return json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {
                    "code": -32000,
                    "message": message,
                    "data": result,
                }
            });
        }

        return json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": result,
        });
    }

    result
}

pub(crate) async fn handle_local_tool_request(
    async_state: Arc<TokioMutex<AsyncAppState>>,
    payload: Value,
) -> Value {
    let Some(request) = extract_hosted_tool_request(&payload) else {
        return build_local_tool_request_response(
            &payload,
            build_tool_error_result("Invalid desktop relay tool request."),
        );
    };

    let request_for_response = request.clone();
    emit_local_tool_event(&async_state, &request, "relay.tool.request.local", None, None).await;
    let result = execute_hosted_tool_request_with_async_state(&async_state, request).await;
    let is_error = result
        .get("isError")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let error = if is_error {
        result
            .get("content")
            .and_then(|value| value.as_array())
            .and_then(|entries| {
                entries.iter().find_map(|entry| {
                    entry
                        .get("text")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                })
            })
    } else {
        None
    };
    emit_local_tool_event(
        &async_state,
        &request_for_response,
        "relay.tool.response.local",
        Some(&result),
        error.as_deref(),
    )
    .await;
    build_local_tool_request_response(&payload, result)
}

async fn emit_local_tool_event(
    async_state: &Arc<TokioMutex<AsyncAppState>>,
    request: &HostedToolRequest,
    event_type: &str,
    result: Option<&Value>,
    error: Option<&str>,
) {
    let state_guard = async_state.lock().await;
    let app_handle = state_guard.app_handle.clone();
    drop(state_guard);

    let relay_id = request
        .thread_id
        .clone()
        .or_else(|| request.relay_session_id.clone())
        .unwrap_or_else(|| "desktop-relay".to_string());
    let request_id = request.request_id.clone().unwrap_or(Value::Null);

    emit_event(
        &app_handle,
        "first_party_ai_desktop_relay_event",
        json!({
            "relayId": relay_id,
            "type": "data",
            "payload": {
                "type": event_type,
                "threadId": request.thread_id,
                "relaySessionId": request.relay_session_id,
                "workspaceId": request.workspace_id,
                "requestId": request_id,
                "toolName": request.tool_name,
                "arguments": request.arguments,
                "createdAt": chrono::Utc::now().to_rfc3339(),
                "success": result.map(|value| {
                    !value.get("isError").and_then(|inner| inner.as_bool()).unwrap_or(false)
                }),
                "result": result.cloned(),
                "error": error,
            },
        }),
    );
}

async fn respond_to_hosted_tool_request(
    state: Arc<AppState>,
    app_handle: AppHandle,
    event_name: &'static str,
    relay_id: String,
    request: HostedToolRequest,
) {
    let result = execute_hosted_tool_request(Arc::clone(&state), app_handle.clone(), request.clone()).await;
    let response_payload = build_tool_response_payload(&request, result);
    let response_result = scoped_request(
        &state,
        EndpointScope::Relay,
        "POST",
        RELAY_TOOL_RESPONSE_PATH,
        Some(response_payload.clone()),
        None,
    )
    .await;

    match response_result {
        Ok(_) => emit_event(
            &app_handle,
            event_name,
            json!({
                "relayId": relay_id,
                "type": "data",
                "payload": {
                    "type": "relay.tool_response.sent",
                    "method": request.method.as_str(),
                    "requestId": request.request_id,
                    "toolName": request.tool_name,
                    "relaySessionId": request.relay_session_id,
                },
            }),
        ),
        Err(err) => emit_event(
            &app_handle,
            event_name,
            json!({
                "relayId": relay_id,
                "type": "data",
                "payload": {
                    "type": "relay.tool_response.error",
                    "method": request.method.as_str(),
                    "requestId": request.request_id,
                    "toolName": request.tool_name,
                    "message": err,
                    "relaySessionId": request.relay_session_id,
                    "response": response_payload,
                },
            }),
        ),
    }
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
    app_handle: &AppHandle,
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

    let response = first_party_ai::apply_relay_session_response(
        &response,
        settings.relay_base_url.as_deref(),
        settings.device_base_url.as_deref(),
    )?;

    let state_clone = Arc::clone(state);
    let app_handle_clone = app_handle.clone();
    let response_clone = response.clone();
    tokio::spawn(async move {
        if let Err(err) = publish_tools_snapshot(state_clone, app_handle_clone, response_clone).await {
            eprintln!("[mcpviews] failed to publish desktop relay tool snapshot after register: {}", err);
        }
    });

    Ok(response)
}

pub async fn refresh_desktop_relay(
    state: &Arc<AppState>,
    app_handle: &AppHandle,
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

    let response = first_party_ai::apply_relay_session_response(
        &response,
        settings.relay_base_url.as_deref(),
        settings.device_base_url.as_deref(),
    )?;

    let state_clone = Arc::clone(state);
    let app_handle_clone = app_handle.clone();
    let response_clone = response.clone();
    tokio::spawn(async move {
        if let Err(err) = publish_tools_snapshot(state_clone, app_handle_clone, response_clone).await {
            eprintln!("[mcpviews] failed to publish desktop relay tool snapshot after refresh: {}", err);
        }
    });

    Ok(response)
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
    let stream_state = Arc::clone(&state);

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
        let mut pending_event_name: Option<String> = None;
        let mut pending_data_lines: Vec<String> = Vec::new();

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
                let line = buffer[..idx].trim_end_matches('\r').to_string();
                buffer = buffer[idx + 1..].to_string();

                if line.is_empty() {
                    if !pending_data_lines.is_empty() {
                        let raw_data = pending_data_lines.join("\n");
                        let payload = parse_json_payload(&raw_data);
                        if let Some(request) = extract_hosted_tool_request(&payload) {
                            let state_clone = Arc::clone(&stream_state);
                            let app_handle_task = app_handle_clone.clone();
                            let stream_id_task = stream_id_clone.clone();
                            tokio::spawn(async move {
                                respond_to_hosted_tool_request(
                                    state_clone,
                                    app_handle_task,
                                    event_name,
                                    stream_id_task,
                                    request,
                                )
                                .await;
                            });
                        }

                        let mut event_payload = json!({
                            "relayId": stream_id_clone,
                            "type": "data",
                            "payload": payload,
                        });
                        if let Some(event_name_value) = pending_event_name.as_deref() {
                            if !event_name_value.is_empty() {
                                event_payload["sseEvent"] = json!(event_name_value);
                            }
                        }
                        emit_event(&app_handle_clone, event_name, event_payload);
                        pending_data_lines.clear();
                    }
                    pending_event_name = None;
                    continue;
                }

                if line.starts_with(':') {
                    continue;
                }

                if let Some(event_name_value) = line.strip_prefix("event:") {
                    let event_name_value = event_name_value.trim();
                    pending_event_name = if event_name_value.is_empty() {
                        None
                    } else {
                        Some(event_name_value.to_string())
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
            let payload = parse_json_payload(&raw_data);
            if let Some(request) = extract_hosted_tool_request(&payload) {
                let state_clone = Arc::clone(&stream_state);
                let app_handle_task = app_handle_clone.clone();
                let stream_id_task = stream_id_clone.clone();
                tokio::spawn(async move {
                    respond_to_hosted_tool_request(
                        state_clone,
                        app_handle_task,
                        event_name,
                        stream_id_task,
                        request,
                    )
                    .await;
                });
            }

            let mut event_payload = json!({
                "relayId": stream_id_clone,
                "type": "data",
                "payload": payload,
            });
            if let Some(event_name_value) = pending_event_name.as_deref() {
                if !event_name_value.is_empty() {
                    event_payload["sseEvent"] = json!(event_name_value);
                }
            }
            emit_event(&app_handle_clone, event_name, event_payload);
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

    #[test]
    fn extracts_hosted_tools_call_requests_from_direct_payloads() {
        let request = extract_hosted_tool_request(&json!({
            "type": "mcp.tool_request",
            "requestId": "req-1",
            "relaySessionId": "relay-session-1",
            "threadId": "thread-1",
            "toolName": "list_registry",
            "arguments": { "limit": 5 }
        }))
        .expect("tool request should be recognized");

        assert_eq!(request.method, HostedToolMethod::Call);
        assert_eq!(request.request_id, Some(json!("req-1")));
        assert_eq!(request.tool_name.as_deref(), Some("list_registry"));
        assert_eq!(request.arguments["limit"], 5);
        assert_eq!(request.relay_session_id.as_deref(), Some("relay-session-1"));
        assert_eq!(request.thread_id.as_deref(), Some("thread-1"));
    }

    #[test]
    fn extracts_hosted_tools_call_requests_from_relay_tool_args_payloads() {
        let request = extract_hosted_tool_request(&json!({
            "type": "relay.tool.request",
            "requestId": "req-2",
            "relaySessionId": "relay-session-2",
            "threadId": "thread-2",
            "toolName": "rich_content",
            "toolArgs": {
                "title": "Web App Architecture",
                "body": "# Overview"
            }
        }))
        .expect("relay tool request should be recognized");

        assert_eq!(request.method, HostedToolMethod::Call);
        assert_eq!(request.request_id, Some(json!("req-2")));
        assert_eq!(request.tool_name.as_deref(), Some("rich_content"));
        assert_eq!(request.arguments["title"], "Web App Architecture");
        assert_eq!(request.arguments["body"], "# Overview");
        assert_eq!(request.relay_session_id.as_deref(), Some("relay-session-2"));
        assert_eq!(request.thread_id.as_deref(), Some("thread-2"));
    }

    #[test]
    fn extracts_hosted_tool_requests_from_jsonrpc_tool_name_and_input_payloads() {
        let request = extract_hosted_tool_request(&json!({
            "jsonrpc": "2.0",
            "id": 9,
            "method": "tools/call",
            "params": {
                "toolName": "structured_data",
                "input": {
                    "tables": [{
                        "id": "t1",
                        "name": "Finance Review",
                        "columns": [],
                        "rows": []
                    }]
                }
            }
        }))
        .expect("jsonrpc tool request should be recognized");

        assert_eq!(request.method, HostedToolMethod::Call);
        assert_eq!(request.request_id, Some(json!(9)));
        assert_eq!(request.tool_name.as_deref(), Some("structured_data"));
        assert_eq!(request.arguments["tables"][0]["id"], "t1");
    }

    #[test]
    fn enriches_thread_scoped_renderer_requests_with_thread_artifact_metadata() {
        let request = HostedToolRequest {
            method: HostedToolMethod::Call,
            request_id: Some(json!("req-3")),
            tool_name: Some("structured_data".to_string()),
            arguments: json!({
                "tables": []
            }),
            relay_session_id: Some("relay-session-3".to_string()),
            device_id: None,
            workspace_id: None,
            thread_id: Some("thread-3".to_string()),
        };

        let enriched = enrich_thread_scoped_renderer_arguments(&request);
        assert_eq!(enriched["meta"]["threadId"], "thread-3");
        assert_eq!(enriched["meta"]["artifactSource"], "tribex-ai-thread-result");
        assert_eq!(enriched["toolArgs"]["threadId"], "thread-3");
        assert_eq!(enriched["toolArgs"]["artifactSource"], "tribex-ai-thread-result");
    }

    #[test]
    fn extracts_hosted_tools_list_requests_from_jsonrpc_payloads() {
        let request = extract_hosted_tool_request(&json!({
            "request": {
                "jsonrpc": "2.0",
                "id": 7,
                "method": "tools/list"
            },
            "workspaceId": "workspace-1"
        }))
        .expect("tools/list request should be recognized");

        assert_eq!(request.method, HostedToolMethod::List);
        assert_eq!(request.request_id, Some(json!(7)));
        assert_eq!(request.workspace_id.as_deref(), Some("workspace-1"));
    }

    #[test]
    fn ignores_non_tool_relay_payloads() {
        assert!(extract_hosted_tool_request(&json!({
            "type": "relay.connected",
            "relaySessionId": "relay-session-1"
        }))
        .is_none());
    }

    #[test]
    fn builds_tool_snapshot_payload_with_context() {
        let payload = build_tool_snapshot_payload(
            &json!({
                "relaySession": { "id": "relay-session-1" },
                "relayDeviceId": "device-1",
                "workspaceId": "workspace-1",
                "threadId": "thread-1"
            }),
            vec![json!({ "name": "push_content" }), json!({ "name": "list_registry" })],
        );

        assert_eq!(payload["method"], "tools/list");
        assert_eq!(payload["relaySessionId"], "relay-session-1");
        assert_eq!(payload["deviceId"], "device-1");
        assert_eq!(payload["toolCount"], 2);
        assert_eq!(payload["tools"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn builds_tool_response_payload_with_jsonrpc_result() {
        let request = HostedToolRequest {
            method: HostedToolMethod::Call,
            request_id: Some(json!("req-1")),
            tool_name: Some("list_registry".to_string()),
            arguments: json!({}),
            relay_session_id: Some("relay-session-1".to_string()),
            device_id: Some("device-1".to_string()),
            workspace_id: Some("workspace-1".to_string()),
            thread_id: Some("thread-1".to_string()),
        };

        let payload = build_tool_response_payload(
            &request,
            json!({
                "content": [{ "type": "text", "text": "ok" }]
            }),
        );

        assert_eq!(payload["requestId"], "req-1");
        assert_eq!(payload["jsonrpc"], "2.0");
        assert_eq!(payload["id"], "req-1");
        assert_eq!(payload["relaySessionId"], "relay-session-1");
        assert_eq!(payload["success"], true);
        assert_eq!(payload["result"]["content"][0]["text"], "ok");
        assert_eq!(payload["error"], Value::Null);
    }

    #[test]
    fn builds_tool_response_payload_with_tool_error_shape() {
        let request = HostedToolRequest {
            method: HostedToolMethod::Call,
            request_id: Some(json!("req-2")),
            tool_name: Some("push_content".to_string()),
            arguments: json!({}),
            relay_session_id: Some("relay-session-1".to_string()),
            device_id: Some("device-1".to_string()),
            workspace_id: Some("workspace-1".to_string()),
            thread_id: Some("thread-1".to_string()),
        };

        let payload = build_tool_response_payload(
            &request,
            build_tool_error_result("Invalid mermaid block."),
        );

        assert_eq!(payload["requestId"], "req-2");
        assert_eq!(payload["jsonrpc"], "2.0");
        assert_eq!(payload["id"], "req-2");
        assert_eq!(payload["success"], false);
        assert_eq!(payload["error"], "Invalid mermaid block.");
    }

    #[test]
    fn builds_local_tool_request_response_in_jsonrpc_shape() {
        let payload = build_local_tool_request_response(
            &json!({
                "jsonrpc": "2.0",
                "id": 11,
                "method": "tools/call",
                "params": {
                    "name": "rich_content",
                    "arguments": {
                        "title": "Example",
                        "body": "# Hello"
                    }
                }
            }),
            json!({
                "content": [{ "type": "text", "text": "ok" }]
            }),
        );

        assert_eq!(payload["jsonrpc"], "2.0");
        assert_eq!(payload["id"], 11);
        assert_eq!(payload["result"]["content"][0]["text"], "ok");
        assert!(payload.get("error").is_none());
    }

    #[test]
    fn builds_tool_error_result_in_mcp_shape() {
        let payload = build_tool_error_result("Tool failed");
        assert_eq!(payload["isError"], true);
        assert_eq!(payload["content"][0]["type"], "text");
        assert_eq!(payload["content"][0]["text"], "Tool failed");
    }
}
