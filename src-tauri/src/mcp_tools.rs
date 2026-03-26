use mcp_mux_shared::RendererDef;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::{execute_push, AsyncAppState, ExecutePushResult};
use crate::plugin::PluginRegistry;

/// Return all tool definitions (built-in + plugin tools)
pub async fn list_tools(state: &Arc<TokioMutex<AsyncAppState>>) -> Vec<Value> {
    // Get available renderers for dynamic tool descriptions
    let renderers = {
        let state_guard = state.lock().await;
        available_renderers(&state_guard.inner)
    };
    let mut tools = builtin_tool_definitions(&renderers);

    // Check for stale plugins and collect info needed for refresh
    let (plugins_to_refresh, client) = {
        let state_guard = state.lock().await;
        let registry = state_guard.inner.plugin_registry.lock().unwrap();
        let client = state_guard.inner.http_client.clone();
        let stale = registry.stale_plugin_indices();
        (stale, client)
    };

    if !plugins_to_refresh.is_empty() {
        // Mark plugins as refresh-pending
        {
            let state_guard = state.lock().await;
            let mut registry = state_guard.inner.plugin_registry.lock().unwrap();
            for idx in &plugins_to_refresh {
                registry.mark_refresh_pending(*idx);
            }
        }

        // Do the actual refresh (async HTTP calls)
        PluginRegistry::refresh_stale_plugins(state, &client).await;
    }

    // Collect plugin tools
    {
        let state_guard = state.lock().await;
        let registry = state_guard.inner.plugin_registry.lock().unwrap();
        tools.extend(registry.all_tools());
    }

    tools
}

/// Dispatch a tool call (built-in first, then plugins)
pub async fn call_tool(
    name: &str,
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    // Check built-in tools first
    match name {
        "push_content" => call_push_content(arguments, state).await,
        "push_review" => call_push_review(arguments, state).await,
        "push_check" => call_push_check(arguments, state).await,
        "setup_agent_rules" => call_setup_agent_rules(arguments, state).await,
        _ => {
            // Check plugin tools — scope MutexGuard to block before any .await
            let (plugin_info, client) = lookup_plugin_tool(name, state).await;

            // If not found, refresh stale plugins and retry once (handles race
            // where tools/call arrives before lazy tools/list cache is populated)
            let plugin_info = match plugin_info {
                Some(info) => Some(info),
                None => {
                    ensure_plugins_refreshed(state, &client).await;
                    let (retry_info, _) = lookup_plugin_tool(name, state).await;
                    retry_info
                }
            };

            match plugin_info {
                Some((mcp_url, auth_header, unprefixed_name, renderer_map)) => {
                    let result =
                        proxy_plugin_tool_call(&client, &mcp_url, auth_header.as_deref(), &unprefixed_name, &arguments)
                            .await?;

                    // Auto-push to viewer as a side effect
                    auto_push_plugin_result(
                        state,
                        &unprefixed_name,
                        &arguments,
                        &result,
                        &renderer_map,
                    )
                    .await;

                    Ok(result)
                }
                None => Err(format!("Unknown tool: {}", name)),
            }
        }
    }
}

/// Plugin tool info returned from lookup: (mcp_url, auth_header, unprefixed_name, renderer_map)
type PluginToolInfo = (String, Option<String>, String, std::collections::HashMap<String, String>);

/// Look up a plugin tool by prefixed name, returning plugin info and HTTP client.
/// If auth is None but OAuth refresh info is available, attempts token refresh.
async fn lookup_plugin_tool(
    name: &str,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> (Option<PluginToolInfo>, reqwest::Client) {
    let (info, client) = {
        let state_guard = state.lock().await;
        let registry = state_guard.inner.plugin_registry.lock().unwrap();
        let info = registry.find_plugin_for_tool(name);
        let client = state_guard.inner.http_client.clone();
        (info, client)
    };

    // If auth is None but OAuth info is present, attempt token refresh
    match info {
        Some((mcp_url, auth, unprefixed_name, renderer_map, oauth_info)) => {
            if auth.is_none() {
                if let Some(oauth) = &oauth_info {
                    match crate::auth::refresh_oauth_token(
                        &oauth.plugin_name,
                        &oauth.token_url,
                        oauth.client_id.as_deref(),
                        &client,
                    )
                    .await
                    {
                        Ok(token) => {
                            eprintln!(
                                "[mcp-mux] Auto-refreshed token for '{}' during tool call",
                                oauth.plugin_name
                            );
                            return (
                                Some((
                                    mcp_url,
                                    Some(format!("Bearer {}", token)),
                                    unprefixed_name,
                                    renderer_map,
                                )),
                                client,
                            );
                        }
                        Err(e) => {
                            eprintln!(
                                "[mcp-mux] Token refresh failed for '{}': {}",
                                oauth.plugin_name, e
                            );
                        }
                    }
                }
            }
            (Some((mcp_url, auth, unprefixed_name, renderer_map)), client)
        }
        None => (None, client),
    }
}

/// Ensure all stale plugin tool caches are refreshed.
async fn ensure_plugins_refreshed(
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

// ─── Built-in tool implementations ───

async fn call_push_content(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    call_push_impl(arguments, state, false).await
}

async fn call_push_review(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    call_push_impl(arguments, state, true).await
}

async fn call_push_impl(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
    review_required: bool,
) -> Result<Value, String> {
    let tool_name = arguments
        .get("tool_name")
        .and_then(|v| v.as_str())
        .ok_or("Missing required parameter: tool_name")?
        .to_string();
    let data = arguments
        .get("data")
        .ok_or("Missing required parameter: data")?
        .clone();
    let meta = arguments.get("meta").cloned();
    let timeout = if review_required {
        arguments
            .get("timeout")
            .and_then(|v| v.as_u64())
            .unwrap_or(120)
    } else {
        120
    };

    let result = execute_push(
        state,
        tool_name,
        None, // tool_args
        data,
        meta,
        review_required,
        timeout,
        None, // session_id
    )
    .await;

    match result {
        ExecutePushResult::Stored { session_id } => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string(&serde_json::json!({
                    "session_id": session_id,
                    "status": "stored"
                })).unwrap()
            }]
        })),
        ExecutePushResult::Decision(resp) => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string(&resp).unwrap()
            }]
        })),
    }
}

async fn call_push_check(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let session_id = arguments
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or("Missing required parameter: session_id")?
        .to_string();

    let state_guard = state.lock().await;
    let sessions = state_guard.inner.sessions.lock().unwrap();

    let result = match sessions.get(&session_id) {
        Some(session) => {
            let has_decision = session.decided_at.is_some();
            serde_json::json!({
                "session_id": session_id,
                "status": if has_decision { "decided" } else { "pending" },
                "review_required": session.review_required,
                "has_decision": has_decision,
                "decision": session.decision,
            })
        }
        None => {
            serde_json::json!({
                "session_id": session_id,
                "status": "not_found",
                "review_required": false,
                "has_decision": false,
            })
        }
    };

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&result).unwrap()
        }]
    }))
}

async fn call_setup_agent_rules(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let agent_type = arguments
        .get("agent_type")
        .and_then(|v| v.as_str())
        .unwrap_or("generic");

    let mut rules: Vec<Value> = Vec::new();

    // 1. Collect renderer rules from built-in renderers
    for renderer in builtin_renderer_definitions() {
        if let Some(rule) = &renderer.rule {
            rules.push(serde_json::json!({
                "name": format!("{}_usage", renderer.name),
                "category": "renderer",
                "source": "built-in",
                "renderer": renderer.name,
                "rule": rule,
            }));
        }
    }

    // 2. Collect renderer rules and tool rules from plugins
    {
        let state_guard = state.lock().await;
        let registry = state_guard.inner.plugin_registry.lock().unwrap();
        for manifest in &registry.manifests {
            let plugin_name = &manifest.name;
            let tool_prefix = manifest.mcp.as_ref()
                .map(|m| m.tool_prefix.as_str())
                .unwrap_or("");

            // Plugin renderer rules
            for renderer in &manifest.renderer_definitions {
                if let Some(rule) = &renderer.rule {
                    rules.push(serde_json::json!({
                        "name": format!("{}_usage", renderer.name),
                        "category": "renderer",
                        "source": plugin_name,
                        "renderer": renderer.name,
                        "rule": rule,
                    }));
                }
            }

            // Plugin tool rules
            for (tool_name, rule) in &manifest.tool_rules {
                let prefixed_name = if tool_prefix.is_empty() {
                    tool_name.clone()
                } else {
                    format!("{}__{}", tool_prefix, tool_name)
                };
                rules.push(serde_json::json!({
                    "name": format!("{}_usage", prefixed_name),
                    "category": "tool",
                    "source": plugin_name,
                    "tool": prefixed_name,
                    "rule": rule,
                }));
            }
        }
    }

    // 3. Collect plugin auth status
    let mut plugin_status: Vec<Value> = Vec::new();
    {
        let state_guard = state.lock().await;
        let registry = state_guard.inner.plugin_registry.lock().unwrap();
        for manifest in &registry.manifests {
            if let Some(mcp) = &manifest.mcp {
                if let Some(auth) = &mcp.auth {
                    let is_configured = auth.is_configured(&manifest.name);
                    let mut status_entry = serde_json::json!({
                        "plugin": manifest.name,
                        "auth_type": auth.display_name(),
                        "auth_configured": is_configured,
                    });

                    if !is_configured {
                        if let mcp_mux_shared::PluginAuth::OAuth {
                            auth_url, ..
                        } = auth
                        {
                            status_entry.as_object_mut().unwrap().insert(
                                "auth_url".to_string(),
                                serde_json::Value::String(auth_url.clone()),
                            );
                            status_entry.as_object_mut().unwrap().insert(
                                "message".to_string(),
                                serde_json::Value::String(format!(
                                    "Plugin '{}' requires re-authentication. Direct the user to authenticate via the companion window or open the auth URL.",
                                    manifest.name
                                )),
                            );
                        }
                    }

                    plugin_status.push(status_entry);
                }
            }
        }
    }

    let persistence_instructions = match agent_type {
        "claude_code" => "Persist each rule as a memory file in your memory system, or add them to CLAUDE.md in the project root. Each rule should be stored so it guides your behavior across conversations.",
        "claude_desktop" => "Add each rule to your project instructions so they persist across conversations and guide your behavior when using mcp-mux tools.",
        "codex" => "Add each rule to AGENTS.md in the project root so they persist and guide agent behavior across sessions.",
        _ => "Persist these rules in your agent's native memory/rule system. For Claude Code: create memory files or add to CLAUDE.md. For Claude Desktop: add to project instructions. For Codex: add to AGENTS.md. The goal is for these rules to guide your behavior across conversations.",
    };

    let response = serde_json::json!({
        "rules": rules,
        "plugin_status": plugin_status,
        "persistence_instructions": persistence_instructions,
    });

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&response).unwrap()
        }]
    }))
}

// ─── Plugin proxy ───

async fn proxy_plugin_tool_call(
    client: &reqwest::Client,
    mcp_url: &str,
    auth_header: Option<&str>,
    tool_name: &str,
    arguments: &Value,
) -> Result<Value, String> {
    let rpc_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments
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
        return Err(format!(
            "Plugin returned HTTP {}",
            response.status().as_u16()
        ));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse plugin response: {}", e))?;

    // Extract result from JSON-RPC response
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

/// Auto-push plugin tool results to the viewer as a side effect
async fn auto_push_plugin_result(
    state: &Arc<TokioMutex<AsyncAppState>>,
    tool_name: &str,
    _arguments: &Value,
    mcp_result: &Value,
    renderer_map: &std::collections::HashMap<String, String>,
) {
    // Extract text content from MCP result
    let data = if let Some(content) = mcp_result.get("content").and_then(|c| c.as_array()) {
        // Try to parse the first text content as JSON for structured display
        content
            .iter()
            .find_map(|item| {
                if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                    item.get("text")
                        .and_then(|t| t.as_str())
                        .and_then(|s| serde_json::from_str::<Value>(s).ok())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| mcp_result.clone())
    } else {
        mcp_result.clone()
    };

    // Use renderer_map to map tool_name -> content_type for display, fallback to tool_name
    let display_tool = renderer_map
        .get(tool_name)
        .cloned()
        .unwrap_or_else(|| tool_name.to_string());

    let _ = execute_push(
        state,
        display_tool,
        None,
        data,
        None,
        false, // non-blocking
        120,
        None,
    )
    .await;
}

// ─── Renderer definitions ───

fn builtin_renderer_definitions() -> Vec<RendererDef> {
    vec![
        RendererDef {
            name: "rich_content".into(),
            description: "Universal markdown display with mermaid diagrams, tables, code blocks, and citations. Use for any rich text content.".into(),
            scope: "universal".into(),
            tools: vec![],
            data_hint: Some("{ \"title\": \"Optional heading\", \"body\": \"Markdown content\" }".into()),
            rule: Some("When presenting implementation plans, architectural decisions, or complex analysis results, ALWAYS push a rich visual summary to the companion window using push_content with tool_name 'rich_content'. Include mermaid diagrams, file change tables, and formatted markdown.".into()),
        },
    ]
}

pub fn available_renderers(state: &std::sync::Arc<crate::state::AppState>) -> Vec<RendererDef> {
    let mut renderers = builtin_renderer_definitions();
    let registry = state.plugin_registry.lock().unwrap();
    for manifest in &registry.manifests {
        renderers.extend(manifest.renderer_definitions.clone());
    }
    renderers
}

// ─── Tool definitions ───

fn builtin_tool_definitions(renderers: &[RendererDef]) -> Vec<Value> {
    let renderer_names: Vec<String> = renderers.iter().map(|r| r.name.clone()).collect();
    let renderer_list = if renderer_names.is_empty() {
        "rich_content".to_string()
    } else {
        renderer_names.join(", ")
    };

    vec![
        serde_json::json!({
            "name": "push_content",
            "description": "Display content in the MCP Mux window. Supports multiple content types.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tool_name": {
                        "type": "string",
                        "description": format!("Content type identifier for renderer selection. Available renderers: {}. Use 'rich_content' for generic markdown display.", renderer_list)
                    },
                    "data": {
                        "type": "object",
                        "description": "Content payload. For rich_content: { \"title\": \"Optional heading\", \"body\": \"Markdown content with ```mermaid blocks, tables, etc.\" }. The 'body' field is required and supports full markdown + mermaid diagrams. For other tool_name types, pass the structured data matching that renderer's expected shape."
                    },
                    "meta": {
                        "type": "object",
                        "description": "Optional metadata (e.g., citation data, source info)."
                    }
                },
                "required": ["tool_name", "data"]
            }
        }),
        serde_json::json!({
            "name": "push_review",
            "description": "Display content in the MCP Mux window and block until the user submits a review decision (accept/reject/partial). Use for mutation operations that need user approval before proceeding.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tool_name": {
                        "type": "string",
                        "description": format!("Content type identifier for renderer selection. Available renderers: {}.", renderer_list)
                    },
                    "data": {
                        "type": "object",
                        "description": "Content payload for review display."
                    },
                    "meta": {
                        "type": "object",
                        "description": "Optional metadata."
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Review timeout in seconds. Default: 120. The timeout resets on user activity (heartbeat)."
                    }
                },
                "required": ["tool_name", "data"]
            }
        }),
        serde_json::json!({
            "name": "push_check",
            "description": "Check the status of a pending review session. Use as a fallback if push_review timed out, to see if the user has since submitted a decision.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "The session ID returned by push_review."
                    }
                },
                "required": ["session_id"]
            }
        }),
        serde_json::json!({
            "name": "setup_agent_rules",
            "description": "Bootstrap behavioral rules for all mcp-mux renderers and plugin tools. Call once to get rules to persist in your agent's native memory/rule system.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "agent_type": {
                        "type": "string",
                        "description": "Optional: 'claude_code', 'claude_desktop', 'codex', 'custom'. Tailors persistence instructions."
                    }
                }
            }
        }),
    ]
}
