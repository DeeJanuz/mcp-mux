use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::AsyncAppState;
use crate::plugin::{try_refresh_oauth, PluginRegistry, PluginToolResult};

pub(super) async fn lookup_plugin_tool(
    name: &str,
    arguments: &Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> (Option<PluginToolResult>, reqwest::Client) {
    let (info, client) = {
        let state_guard = state.lock().await;
        let registry = state_guard.inner.plugin_registry.lock().unwrap();
        let info = registry.find_plugin_for_tool_with_args(name, arguments);
        let client = state_guard.inner.http_client.clone();
        (info, client)
    };

    match info {
        Some(mut result) => {
            if result.auth_header.is_none() {
                if let Some(oauth) = &result.oauth_info {
                    if let Some(bearer) = try_refresh_oauth(oauth, &client).await {
                        result.auth_header = Some(bearer);
                    }
                }
            }
            (Some(result), client)
        }
        None => (None, client),
    }
}

pub(super) async fn ensure_plugins_refreshed(
    state: &Arc<TokioMutex<AsyncAppState>>,
    client: &reqwest::Client,
) {
    let has_stale = {
        let state_guard = state.lock().await;
        let mut registry = state_guard.inner.plugin_registry.lock().unwrap();
        let stale = registry.stale_plugin_indices();
        for idx in &stale {
            registry.mark_refresh_pending(*idx);
        }
        !stale.is_empty()
    };
    if has_stale {
        PluginRegistry::refresh_stale_plugins(state, client).await;
    }
}

pub(super) fn enrich_list_organizations(result: &mut Value, plugin_name: &str) {
    let auth_dir = mcpviews_shared::auth_dir();

    if let Some(content) = result.get_mut("content").and_then(|c| c.as_array_mut()) {
        for item in content.iter_mut() {
            if item.get("type").and_then(|t| t.as_str()) != Some("text") {
                continue;
            }
            let text = match item.get("text").and_then(|t| t.as_str()) {
                Some(t) => t.to_string(),
                None => continue,
            };
            let mut parsed = match serde_json::from_str::<Value>(&text) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let mut modified = false;

            if let Some(data) = parsed.get_mut("data").and_then(|d| d.as_array_mut()) {
                for org in data.iter_mut() {
                    if let Some(org_id) = org.get("id").and_then(|id| id.as_str()) {
                        let has_token = mcpviews_shared::token_store::has_stored_token_for_org(
                            &auth_dir,
                            plugin_name,
                            org_id,
                        );
                        if let Some(obj) = org.as_object_mut() {
                            obj.insert("has_mcpviews_token".to_string(), Value::Bool(has_token));
                            modified = true;
                        }
                    }
                }
            }

            if let Some(arr) = parsed.as_array_mut() {
                for org in arr.iter_mut() {
                    if let Some(org_id) = org.get("id").and_then(|id| id.as_str()) {
                        let has_token = mcpviews_shared::token_store::has_stored_token_for_org(
                            &auth_dir,
                            plugin_name,
                            org_id,
                        );
                        if let Some(obj) = org.as_object_mut() {
                            obj.insert("has_mcpviews_token".to_string(), Value::Bool(has_token));
                            modified = true;
                        }
                    }
                }
            }

            if modified {
                if let Ok(new_text) = serde_json::to_string(&parsed) {
                    *item.get_mut("text").unwrap() = Value::String(new_text);
                }
            }
        }
    }
}

pub(super) async fn proxy_plugin_tool_call(
    client: &reqwest::Client,
    mcp_url: &str,
    auth_header: Option<&str>,
    tool_name: &str,
    arguments: &Value,
) -> Result<Value, String> {
    let clean_args = if arguments.get("organization_id").is_some() {
        let mut args = arguments.clone();
        if let Some(obj) = args.as_object_mut() {
            obj.remove("organization_id");
        }
        args
    } else {
        arguments.clone()
    };

    let rpc_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": clean_args
        }
    });

    let mut req_builder = client
        .post(mcp_url)
        .header("Accept", "application/json, text/event-stream")
        .json(&rpc_request);
    if let Some(auth) = auth_header {
        req_builder = req_builder.header("Authorization", auth);
    }

    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("Plugin request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Plugin returned HTTP {}", response.status().as_u16()));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse plugin response: {}", e))?;

    if let Some(error) = body.get("error") {
        return Err(format!(
            "Plugin error: {}",
            error
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown error")
        ));
    }

    body.get("result")
        .cloned()
        .ok_or_else(|| "Plugin response missing result".to_string())
}
