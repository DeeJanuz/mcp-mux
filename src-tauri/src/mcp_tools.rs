use mcpviews_shared::RendererDef;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::AsyncAppState;
use crate::plugin::PluginRegistry;

mod builtin_registry;
mod discovery;
mod lifecycle;
mod plugin_proxy;
mod presentation;
mod session;

const RULES_VERSION: &str = "5"; // Bump when built-in rules change

/// Return all tool definitions (built-in + plugin tools)
pub async fn list_tools(state: &Arc<TokioMutex<AsyncAppState>>) -> Vec<Value> {
    let renderers = {
        let state_guard = state.lock().await;
        available_renderers(&state_guard.inner)
    };
    let mut tools = builtin_registry::builtin_tool_definitions(&renderers);

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
    if let Some(spec) = builtin_registry::find_builtin_tool_spec(name) {
        return (spec.handler)(arguments, state).await;
    }

    let (plugin_info, client) = plugin_proxy::lookup_plugin_tool(name, &arguments, state).await;

    let plugin_info = match plugin_info {
        Some(info) => Some(info),
        None => {
            plugin_proxy::ensure_plugins_refreshed(state, &client).await;
            let (retry_info, _) = plugin_proxy::lookup_plugin_tool(name, &arguments, state).await;
            retry_info
        }
    };

    match plugin_info {
        Some(info) => {
            let result = plugin_proxy::proxy_plugin_tool_call(
                &client,
                &info.mcp_url,
                info.auth_header.as_deref(),
                &info.unprefixed_name,
                &arguments,
            )
            .await;

            match result {
                Ok(mut val) => {
                    if info.unprefixed_name == "list_organizations" {
                        plugin_proxy::enrich_list_organizations(&mut val, &info.plugin_name);
                    }
                    Ok(val)
                }
                Err(ref e) if e.contains("HTTP 401") => {
                    if let Some(ref oauth) = info.oauth_info {
                        if let Some(new_header) = crate::plugin::try_refresh_oauth(oauth, &client).await {
                            let mut retry = plugin_proxy::proxy_plugin_tool_call(
                                &client,
                                &info.mcp_url,
                                Some(&new_header),
                                &info.unprefixed_name,
                                &arguments,
                            )
                            .await?;
                            if info.unprefixed_name == "list_organizations" {
                                plugin_proxy::enrich_list_organizations(&mut retry, &info.plugin_name);
                            }
                            return Ok(retry);
                        }
                    }
                    result
                }
                Err(_) => result,
            }
        }
        None => Err(format!("Unknown tool: {}", name)),
    }
}

/// Ensure the registry cache is populated. If empty, fetch from all sources
/// and resolve remote manifests. Errors are logged but swallowed (best-effort).
pub(crate) async fn ensure_registry_fresh(state: &Arc<TokioMutex<AsyncAppState>>) {
    let is_empty = {
        let state_guard = state.lock().await;
        let empty = state_guard.inner.latest_registry.lock().unwrap().is_empty();
        empty
    };

    if !is_empty {
        return;
    }

    let client = {
        let state_guard = state.lock().await;
        state_guard.inner.http_client.clone()
    };

    let sources = mcpviews_shared::registry::get_registry_sources();
    // fetch_all_registries already calls resolve_manifest_urls internally
    match mcpviews_shared::registry::fetch_all_registries(&client, &sources).await {
        Ok(entries) => {
            let state_guard = state.lock().await;
            let mut cached = state_guard.inner.latest_registry.lock().unwrap();
            *cached = entries;
        }
        Err(e) => {
            eprintln!("[mcpviews] ensure_registry_fresh failed: {}", e);
        }
    }
}

// ─── Built-in tool implementations ───

/// Remove `change` fields from structured_data payloads so the read-only view
/// never displays diff markers even if the caller accidentally includes them.
fn strip_change_fields(data: &mut Value) {
    if let Some(tables) = data.get_mut("tables").and_then(|t| t.as_array_mut()) {
        for table in tables {
            // Strip column-level change
            if let Some(columns) = table.get_mut("columns").and_then(|c| c.as_array_mut()) {
                for col in columns {
                    if let Some(obj) = col.as_object_mut() {
                        obj.insert("change".into(), Value::Null);
                    }
                }
            }
            // Strip cell-level change (recursive for nested rows)
            if let Some(rows) = table.get_mut("rows").and_then(|r| r.as_array_mut()) {
                strip_row_changes(rows);
            }
        }
    }
}

fn strip_row_changes(rows: &mut Vec<Value>) {
    for row in rows {
        if let Some(cells) = row.get_mut("cells").and_then(|c| c.as_object_mut()) {
            for (_key, cell) in cells.iter_mut() {
                if let Some(obj) = cell.as_object_mut() {
                    obj.insert("change".into(), Value::Null);
                }
            }
        }
        // Recurse into children
        if let Some(children) = row.get_mut("children").and_then(|c| c.as_array_mut()) {
            strip_row_changes(children);
        }
    }
}

/// Normalize a data parameter: if it's a JSON string, parse it into an object.
/// Falls back to the original value if parsing fails.
fn normalize_data_param(raw: &Value) -> Value {
    if let Some(s) = raw.as_str() {
        serde_json::from_str(s).unwrap_or_else(|_| raw.clone())
    } else {
        raw.clone()
    }
}

fn infer_embedded_push_data(arguments: &Value) -> Option<Value> {
    let object = arguments.as_object()?;
    let mut inferred = serde_json::Map::new();

    for (key, value) in object {
        if matches!(key.as_str(), "tool_name" | "meta" | "timeout" | "data") {
            continue;
        }
        inferred.insert(key.clone(), value.clone());
    }

    if inferred.is_empty() {
        None
    } else {
        Some(Value::Object(inferred))
    }
}

fn infer_renderer_tool_name(data: &Value) -> Option<&'static str> {
    let object = data.as_object()?;

    if object.contains_key("body")
        || object.contains_key("title")
        || object.contains_key("suggestions")
        || object.contains_key("citations")
    {
        return Some("rich_content");
    }

    if object.contains_key("tables") {
        return Some("structured_data");
    }

    None
}

const MERMAID_DIAGRAM_STARTERS: &[&str] = &[
    "graph",
    "flowchart",
    "sequenceDiagram",
    "classDiagram",
    "stateDiagram",
    "erDiagram",
    "journey",
    "gantt",
    "pie",
    "mindmap",
    "timeline",
    "gitGraph",
    "quadrantChart",
    "requirementDiagram",
    "C4Context",
    "C4Container",
    "C4Component",
    "C4Dynamic",
    "C4Deployment",
    "xychart",
    "block-beta",
    "packet-beta",
    "kanban",
    "architecture-beta",
];

#[derive(Debug, Clone)]
enum RichContentFenceKind {
    Mermaid,
    StructuredData(String),
}

#[derive(Debug, Clone)]
struct RichContentFence {
    kind: RichContentFenceKind,
    start_line: usize,
    lines: Vec<String>,
}

fn validate_push_payload(tool_name: &str, data: &Value) -> Result<(), String> {
    match tool_name {
        "rich_content" => validate_rich_content_payload(data),
        "structured_data" => validate_structured_data_payload(data),
        _ => Ok(()),
    }
}

fn validate_rich_content_payload(data: &Value) -> Result<(), String> {
    let object = data
        .as_object()
        .ok_or("rich_content data must be a JSON object.".to_string())?;
    let table_ids = match object.get("tables") {
        Some(tables) => validate_tables_value(tables, "rich_content.data.tables")?,
        None => Vec::new(),
    };

    if let Some(body) = object.get("body") {
        let body = body
            .as_str()
            .ok_or("rich_content.data.body must be a string.".to_string())?;
        validate_rich_content_body(body, &table_ids)?;
    }

    Ok(())
}

fn validate_structured_data_payload(data: &Value) -> Result<(), String> {
    let object = data
        .as_object()
        .ok_or("structured_data data must be a JSON object.".to_string())?;
    let tables = object
        .get("tables")
        .ok_or("structured_data.data.tables is required.".to_string())?;
    validate_tables_value(tables, "structured_data.data.tables")?;
    Ok(())
}

fn validate_tables_value(tables: &Value, context: &str) -> Result<Vec<String>, String> {
    let tables = tables
        .as_array()
        .ok_or(format!("{} must be an array.", context))?;
    let mut table_ids = Vec::new();

    for (table_index, table) in tables.iter().enumerate() {
        let table_context = format!("{}[{}]", context, table_index);
        let table = table
            .as_object()
            .ok_or(format!("{} must be an object.", table_context))?;
        let table_id = table
            .get("id")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or(format!("{}.id must be a non-empty string.", table_context))?
            .to_string();

        if table_ids.iter().any(|existing| existing == &table_id) {
            return Err(format!("{} contains duplicate table id `{}`.", context, table_id));
        }

        let columns = table
            .get("columns")
            .and_then(|value| value.as_array())
            .ok_or(format!("{}.columns must be an array.", table_context))?;
        for (column_index, column) in columns.iter().enumerate() {
            let column_context = format!("{}.columns[{}]", table_context, column_index);
            let column = column
                .as_object()
                .ok_or(format!("{} must be an object.", column_context))?;
            column
                .get("id")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or(format!("{}.id must be a non-empty string.", column_context))?;
            column
                .get("name")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or(format!("{}.name must be a non-empty string.", column_context))?;
        }

        let rows = table
            .get("rows")
            .and_then(|value| value.as_array())
            .ok_or(format!("{}.rows must be an array.", table_context))?;
        validate_table_rows(rows, &format!("{}.rows", table_context))?;
        table_ids.push(table_id);
    }

    Ok(table_ids)
}

fn validate_table_rows(rows: &[Value], context: &str) -> Result<(), String> {
    for (row_index, row) in rows.iter().enumerate() {
        let row_context = format!("{}[{}]", context, row_index);
        let row = row
            .as_object()
            .ok_or(format!("{} must be an object.", row_context))?;
        row.get("id")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or(format!("{}.id must be a non-empty string.", row_context))?;

        if let Some(cells) = row.get("cells") {
            cells
                .as_object()
                .ok_or(format!("{}.cells must be an object when provided.", row_context))?;
        }

        if let Some(children) = row.get("children") {
            let children = children
                .as_array()
                .ok_or(format!("{}.children must be an array when provided.", row_context))?;
            validate_table_rows(children, &format!("{}.children", row_context))?;
        }
    }

    Ok(())
}

fn validate_rich_content_body(body: &str, table_ids: &[String]) -> Result<(), String> {
    let mut active_fence: Option<RichContentFence> = None;

    for (line_index, line) in body.lines().enumerate() {
        let line_number = line_index + 1;
        let trimmed = line.trim();

        if let Some(fence) = active_fence.as_mut() {
            if trimmed == "```" {
                validate_rich_content_fence(fence, table_ids)?;
                active_fence = None;
            } else {
                fence.lines.push(line.to_string());
            }
            continue;
        }

        if trimmed == "mermaid" {
            return Err(format!(
                "Invalid Mermaid block at line {}: Mermaid content must be wrapped in fenced code blocks using ```mermaid.",
                line_number
            ));
        }

        if let Some(info_string) = trimmed.strip_prefix("```") {
            let info_string = info_string.trim();
            if info_string.eq_ignore_ascii_case("mermaid") {
                active_fence = Some(RichContentFence {
                    kind: RichContentFenceKind::Mermaid,
                    start_line: line_number,
                    lines: Vec::new(),
                });
                continue;
            }

            if let Some(table_id) = info_string.strip_prefix("structured_data:") {
                let table_id = table_id.trim();
                if table_id.is_empty() {
                    return Err(format!(
                        "Invalid embedded structured_data block at line {}: expected ```structured_data:<table-id>.",
                        line_number
                    ));
                }
                active_fence = Some(RichContentFence {
                    kind: RichContentFenceKind::StructuredData(table_id.to_string()),
                    start_line: line_number,
                    lines: Vec::new(),
                });
                continue;
            }

            if info_string.starts_with("structured_data") {
                return Err(format!(
                    "Invalid embedded structured_data block at line {}: expected ```structured_data:<table-id>.",
                    line_number
                ));
            }
        }
    }

    if let Some(fence) = active_fence {
        return Err(match fence.kind {
            RichContentFenceKind::Mermaid => format!(
                "Invalid Mermaid block: missing closing ``` for block starting at line {}.",
                fence.start_line
            ),
            RichContentFenceKind::StructuredData(table_id) => format!(
                "Invalid embedded structured_data block for table `{}`: missing closing ``` for block starting at line {}.",
                table_id, fence.start_line
            ),
        });
    }

    Ok(())
}

fn validate_rich_content_fence(fence: &RichContentFence, table_ids: &[String]) -> Result<(), String> {
    match &fence.kind {
        RichContentFenceKind::Mermaid => validate_mermaid_fence(fence),
        RichContentFenceKind::StructuredData(table_id) => {
            validate_embedded_structured_data_fence(fence, table_id, table_ids)
        }
    }
}

fn validate_mermaid_fence(fence: &RichContentFence) -> Result<(), String> {
    let first_meaningful_line = fence
        .lines
        .iter()
        .map(|line| line.trim())
        .find(|line| !line.is_empty() && !line.starts_with("%%"));

    let first_meaningful_line = first_meaningful_line.ok_or(format!(
        "Invalid Mermaid block starting at line {}: the block is empty.",
        fence.start_line
    ))?;

    if !MERMAID_DIAGRAM_STARTERS
        .iter()
        .any(|starter| first_meaningful_line.starts_with(starter))
    {
        return Err(format!(
            "Invalid Mermaid block starting at line {}: expected a Mermaid diagram declaration like `flowchart TD` or `sequenceDiagram`, found `{}`.",
            fence.start_line, first_meaningful_line
        ));
    }

    Ok(())
}

fn validate_embedded_structured_data_fence(
    fence: &RichContentFence,
    table_id: &str,
    table_ids: &[String],
) -> Result<(), String> {
    if fence.lines.iter().any(|line| !line.trim().is_empty()) {
        return Err(format!(
            "Embedded structured_data block for table `{}` should be empty. Define the table in data.tables and keep the fence body empty.",
            table_id
        ));
    }

    if !table_ids.iter().any(|candidate| candidate == table_id) {
        return Err(format!(
            "Embedded structured_data block references table `{}`, but no matching entry exists in data.tables.",
            table_id
        ));
    }

    Ok(())
}

/// Common parameters extracted from push_content / push_review arguments.
#[derive(Debug)]
struct PushParams {
    session_id: Option<String>,
    tool_name: String,
    data: Value,
    meta: Option<Value>,
    timeout: u64,
}

/// Extract the common parameters shared by `call_push_review` and `call_push_impl`.
/// When `review` is true, timeout defaults to 120; when false, timeout is always 120.
fn extract_push_params(arguments: &Value, review: bool) -> Result<PushParams, String> {
    let data = arguments
        .get("data")
        .map(normalize_data_param)
        .or_else(|| infer_embedded_push_data(arguments))
        .ok_or("Missing required parameter: data")?;
    let tool_name = arguments
        .get("tool_name")
        .and_then(|v| v.as_str())
        .map(|value| value.to_string())
        .or_else(|| infer_renderer_tool_name(&data).map(|value| value.to_string()))
        .ok_or("Missing required parameter: tool_name")?;
    let meta = arguments.get("meta").cloned();
    let session_id = arguments
        .get("session_id")
        .or_else(|| arguments.get("sessionId"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let timeout = if review {
        arguments
            .get("timeout")
            .and_then(|v| v.as_u64())
            .unwrap_or(120)
    } else {
        120
    };
    validate_push_payload(&tool_name, &data)?;
    Ok(PushParams {
        session_id,
        tool_name,
        data,
        meta,
        timeout,
    })
}

/// Collect renderer and tool rules from all renderers and plugin manifests.
pub(crate) fn collect_rules(
    all_renderers: &[RendererDef],
    manifests: &[mcpviews_shared::PluginManifest],
) -> Vec<Value> {
    let mut rules: Vec<Value> = Vec::new();

    // Cross-cutting renderer selection rule
    rules.push(serde_json::json!({
        "name": "renderer_selection",
        "category": "system",
        "source": "built-in",
        "rule": RENDERER_SELECTION_RULE
    }));

    rules.push(serde_json::json!({
        "name": "bulk_action_review",
        "category": "system",
        "source": "built-in",
        "rule": BULK_ACTION_REVIEW_RULE
    }));

    // Renderer rules — covers built-in, explicit, AND synthesized renderers.
    // Always include description, data_hint, scope, and tools so agents know
    // the payload schema regardless of how the renderer was defined.
    for renderer in all_renderers {
        if let Some(rule) = &renderer.rule {
            // Renderer has an explicit rule
            let source = if renderer.scope == "universal" { "built-in" } else { "plugin" };
            rules.push(serde_json::json!({
                "name": format!("{}_usage", renderer.name),
                "category": "renderer",
                "source": source,
                "renderer": renderer.name,
                "description": renderer.description,
                "scope": renderer.scope,
                "data_hint": renderer.data_hint,
                "tools": renderer.tools,
                "rule": rule,
            }));
        } else if renderer.scope == "tool" && !renderer.tools.is_empty() {
            // Synthesized tool-scoped renderer — generate a usage hint from description
            rules.push(serde_json::json!({
                "name": format!("{}_usage", renderer.name),
                "category": "renderer",
                "source": "plugin",
                "renderer": renderer.name,
                "description": renderer.description,
                "scope": renderer.scope,
                "data_hint": renderer.data_hint,
                "tools": renderer.tools,
            }));
        }
    }

    // Plugin tool rules
    for manifest in manifests {
        let plugin_name = &manifest.name;
        let tool_prefix = manifest
            .mcp
            .as_ref()
            .map(|m| m.tool_prefix.as_str())
            .unwrap_or("");

        for (tool_name, rule) in &manifest.tool_rules {
            let prefixed_name = if tool_prefix.is_empty() {
                tool_name.clone()
            } else {
                format!("{}{}", tool_prefix, tool_name)
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

    // Plugin-level behavioral rules
    for manifest in manifests {
        for (i, rule) in manifest.plugin_rules.iter().enumerate() {
            rules.push(serde_json::json!({
                "name": format!("{}_plugin_rule_{}", manifest.name, i),
                "category": "plugin",
                "source": &manifest.name,
                "rule": rule,
            }));
        }
    }

    rules
}

/// Collect only built-in (universal) rules — renderer_selection + universal renderer rules.
pub(crate) fn collect_builtin_rules(all_renderers: &[RendererDef]) -> Vec<Value> {
    let mut rules: Vec<Value> = Vec::new();

    // Cross-cutting renderer selection rule
    rules.push(serde_json::json!({
        "name": "renderer_selection",
        "category": "system",
        "source": "built-in",
        "rule": RENDERER_SELECTION_RULE
    }));

    rules.push(serde_json::json!({
        "name": "bulk_action_review",
        "category": "system",
        "source": "built-in",
        "rule": BULK_ACTION_REVIEW_RULE
    }));

    rules.push(serde_json::json!({
        "name": "org_switching",
        "category": "system",
        "source": "built-in",
        "rule": "When working with multi-org plugins, be aware of which organization the current token is scoped to. The init_session response includes org_tokens showing available organizations and token status per plugin. If the user asks about data in a different org, include organization_id in tool call arguments. If no token exists for that org, call start_plugin_auth with organization_id to authenticate."
    }));

    // Only built-in (universal scope) renderers with rules
    for renderer in all_renderers {
        if renderer.scope == "universal" {
            if let Some(rule) = &renderer.rule {
                rules.push(serde_json::json!({
                    "name": format!("{}_usage", renderer.name),
                    "category": "renderer",
                    "source": "built-in",
                    "renderer": renderer.name,
                    "description": renderer.description,
                    "scope": renderer.scope,
                    "data_hint": renderer.data_hint,
                    "tools": renderer.tools,
                    "rule": rule,
                }));
            }
        }
    }

    rules
}

/// Collect rules for a single plugin, optionally filtered by tool names and/or renderer names.
pub(crate) fn collect_plugin_rules(
    all_renderers: &[RendererDef],
    manifest: &mcpviews_shared::PluginManifest,
    tool_filter: Option<&[String]>,
    renderer_filter: Option<&[String]>,
) -> Vec<Value> {
    let mut rules: Vec<Value> = Vec::new();

    let tool_prefix = manifest
        .mcp
        .as_ref()
        .map(|m| m.tool_prefix.as_str())
        .unwrap_or("");

    // Determine which renderers are associated with filtered tools
    let mut relevant_renderers: std::collections::HashSet<String> = std::collections::HashSet::new();
    if let Some(tools) = tool_filter {
        for tool_name in tools {
            if let Some(renderer_name) = manifest.renderers.get(tool_name) {
                relevant_renderers.insert(renderer_name.clone());
            }
        }
    }
    if let Some(renderers) = renderer_filter {
        for r in renderers {
            relevant_renderers.insert(r.clone());
        }
    }

    let has_filter = tool_filter.is_some() || renderer_filter.is_some();

    // Renderer rules — only non-universal (plugin) renderers
    for renderer in all_renderers {
        if renderer.scope == "universal" {
            continue;
        }

        // If filters are active, only include matching renderers
        if has_filter && !relevant_renderers.contains(&renderer.name) {
            continue;
        }

        if let Some(rule) = &renderer.rule {
            rules.push(serde_json::json!({
                "name": format!("{}_usage", renderer.name),
                "category": "renderer",
                "source": "plugin",
                "renderer": renderer.name,
                "description": renderer.description,
                "scope": renderer.scope,
                "data_hint": renderer.data_hint,
                "tools": renderer.tools,
                "rule": rule,
            }));
        } else if renderer.scope == "tool" && !renderer.tools.is_empty() {
            rules.push(serde_json::json!({
                "name": format!("{}_usage", renderer.name),
                "category": "renderer",
                "source": "plugin",
                "renderer": renderer.name,
                "description": renderer.description,
                "scope": renderer.scope,
                "data_hint": renderer.data_hint,
                "tools": renderer.tools,
            }));
        }
    }

    // Plugin tool rules
    for (tool_name, rule) in &manifest.tool_rules {
        // If tools filter is active, only include matching tools
        if let Some(tools) = tool_filter {
            if !tools.iter().any(|t| t == tool_name) {
                continue;
            }
        }

        let prefixed_name = if tool_prefix.is_empty() {
            tool_name.clone()
        } else {
            format!("{}{}", tool_prefix, tool_name)
        };
        rules.push(serde_json::json!({
            "name": format!("{}_usage", prefixed_name),
            "category": "tool",
            "source": &manifest.name,
            "tool": prefixed_name,
            "rule": rule,
        }));
    }

    // Plugin-level behavioral rules (always included regardless of filters)
    for (i, rule) in manifest.plugin_rules.iter().enumerate() {
        rules.push(serde_json::json!({
            "name": format!("{}_plugin_rule_{}", manifest.name, i),
            "category": "plugin",
            "source": &manifest.name,
            "rule": rule,
        }));
    }

    rules
}

/// Collect auth status for each plugin that has MCP + auth configured.
pub(crate) fn collect_plugin_auth_status(
    manifests: &[mcpviews_shared::PluginManifest],
) -> Vec<Value> {
    let mut plugin_status: Vec<Value> = Vec::new();

    for manifest in manifests {
        if let Some(mcp) = &manifest.mcp {
            if let Some(auth) = &mcp.auth {
                let is_configured = auth.is_configured(&manifest.name);
                let mut status_entry = serde_json::json!({
                    "plugin": manifest.name,
                    "auth_type": auth.display_name(),
                    "auth_configured": is_configured,
                });

                if !is_configured {
                    if let mcpviews_shared::PluginAuth::OAuth {
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

    plugin_status
}

/// Return agent-type-specific persistence instructions.
pub(crate) fn persistence_instructions(agent_type: &str) -> String {
    match agent_type {
        "claude_code" => format!("Create a file at `.claude/rules/mcpviews.md` in the project root containing all the rules below. Each rule should be a separate section with its name as a heading and its rule text as the body. Include `<!-- mcpviews-rules-version: {} -->` as the first line. This file will be automatically loaded by Claude Code as project-level rules.", RULES_VERSION),

        "claude_desktop" => format!("For each rule below, create an individual memory using your memory creation capability. Use the title `mcpviews: <rule name>` and the rule text as the content. Include `mcpviews-rules-version: {}` in a separate memory titled `mcpviews: version`. Creating individual memories (rather than one combined memory) ensures each rule is retrievable independently and survives context window limits.", RULES_VERSION),

        "codex" | "opencode" | "antigravity" => format!("Append all rules below to `AGENTS.md` in the project root. Each rule should be a separate section with its name as a heading and its rule text as the body. Include `<!-- mcpviews-rules-version: {} -->` as the first line of the MCPViews section.", RULES_VERSION),

        "cursor" => format!("Create a file at `.cursor/rules/mcpviews.mdc` in the project root containing all the rules below. Each rule should be a separate section with its name as a heading and its rule text as the body. Include `<!-- mcpviews-rules-version: {} -->` as the first line. This file is read by Cursor as project-level rules.", RULES_VERSION),

        "windsurf" => format!("Append all rules below to `.windsurfrules` in the project root. Each rule should be a separate section with its name as a heading and its rule text as the body. Include `<!-- mcpviews-rules-version: {} -->` as the first line of the MCPViews section.", RULES_VERSION),

        _ => format!("These rules should be persisted so they guide your behavior in future conversations. \
              Ask the user: \"I have received behavioral rules from MCPViews for its renderers and tools. \
              How would you like me to persist them? I can write them to a rules file in this project, \
              create memories, or use another method your platform supports.\" \
              Then follow the user's direction to commit the rules. Include version marker `mcpviews-rules-version: {}` so updates can be detected.", RULES_VERSION),
    }
}

/// Extract lightweight tool summaries (name + description) from full tool definitions.
fn extract_tool_summaries(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .filter_map(|t| {
            let name = t.get("name")?.as_str()?;
            let description = t
                .get("description")
                .and_then(|d| d.as_str())
                .unwrap_or("");
            Some(serde_json::json!({
                "name": name,
                "description": description,
            }))
        })
        .collect()
}

fn extract_tool_summaries_with_schema(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .filter_map(|t| {
            let name = t.get("name")?.as_str()?;
            Some(serde_json::json!({
                "name": name,
                "description": t
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or(""),
                "inputSchema": t.get("inputSchema").cloned().unwrap_or(Value::Null),
            }))
        })
        .collect()
}

fn find_tool_summary<'a>(tools: &'a [Value], name: &str) -> Option<&'a Value> {
    tools
        .iter()
        .find(|tool| tool.get("name").and_then(|value| value.as_str()) == Some(name))
}

fn title_case_words(value: &str) -> String {
    value
        .split(|c: char| c == '_' || c == '-' || c == '.')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn capability_key(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn plugin_auth_state_map(plugin_status: &[Value]) -> HashMap<String, String> {
    plugin_status
        .iter()
        .filter_map(|entry| {
            let name = entry.get("plugin").and_then(|value| value.as_str())?;
            let auth_configured = entry
                .get("auth_configured")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            Some((
                name.to_string(),
                if auth_configured {
                    "authenticated".to_string()
                } else {
                    "needs_auth".to_string()
                },
            ))
        })
        .collect()
}

fn build_core_hosted_connector(available_tools: &[Value]) -> Option<Value> {
    let mut ordered_tools = Vec::new();
    let mut group_entries: Vec<(String, String, Vec<Value>)> = Vec::new();

    for spec in builtin_registry::builtin_tool_specs() {
        let Some(group) = spec.core_connector_group else {
            continue;
        };
        let Some(summary) = find_tool_summary(available_tools, spec.name).cloned() else {
            continue;
        };

        ordered_tools.push(summary.clone());

        match group_entries
            .iter_mut()
            .find(|(name, _, _)| name == group.name)
        {
            Some((_, _, tools)) => tools.push(summary),
            None => group_entries.push((
                group.name.to_string(),
                group.hint.to_string(),
                vec![summary],
            )),
        }
    }

    if ordered_tools.is_empty() {
        return None;
    }

    Some(serde_json::json!({
        "key": "mcpviews-core",
        "label": "MCPViews Core",
        "description": "Local renderers, review surfaces, and hosted discovery helpers available in MCPViews.",
        "namespaces": ["mcpviews", "renderers", "reviews"],
        "capabilities": ["rich-content", "structured-data", "review", "discovery"],
        "authState": "available",
        "discoveryState": "breadcrumb",
        "toolCount": ordered_tools.len(),
        "tools": ordered_tools.iter().take(3).cloned().collect::<Vec<Value>>(),
        "toolGroups": group_entries
            .into_iter()
            .map(|(name, hint, tools)| serde_json::json!({
                "name": name,
                "hint": hint,
                "tools": tools,
            }))
            .collect::<Vec<Value>>(),
    }))
}

fn filter_hosted_model_facing_tools(tools: Vec<Value>) -> Vec<Value> {
    tools
        .into_iter()
        .filter(|tool| {
            tool.get("name")
                .and_then(|value| value.as_str())
                .map(builtin_registry::is_hosted_model_facing_builtin)
                .unwrap_or(true)
        })
        .collect()
}

fn build_plugin_hosted_connectors(
    manifests: &[mcpviews_shared::PluginManifest],
    tool_cache: &crate::tool_cache::ToolCache,
    available_tools: &[Value],
    plugin_status: &[Value],
) -> Vec<Value> {
    let auth_states = plugin_auth_state_map(plugin_status);

    manifests
        .iter()
        .enumerate()
        .filter_map(|(idx, manifest)| {
            let index = manifest
                .registry_index
                .clone()
                .unwrap_or_else(|| auto_derive_registry_index(manifest, tool_cache.plugin_tools(idx)));
            let prefix = manifest
                .mcp
                .as_ref()
                .map(|mcp| mcp.tool_prefix.as_str())
                .unwrap_or("");

            let mut tool_names = Vec::new();
            let mut representative_tools = Vec::new();
            let mut seen = HashSet::new();
            let tool_groups = index
                .tool_groups
                .iter()
                .map(|group| {
                    let group_tools = group
                        .tools
                        .iter()
                        .filter_map(|tool_name| {
                            let actual_name = if prefix.is_empty() {
                                tool_name.clone()
                            } else {
                                format!("{}{}", prefix, tool_name)
                            };
                            let summary = find_tool_summary(available_tools, &actual_name)?.clone();
                            if seen.insert(actual_name.clone()) {
                                tool_names.push(actual_name);
                                if representative_tools.len() < 4 {
                                    representative_tools.push(summary.clone());
                                }
                            }
                            Some(summary)
                        })
                        .collect::<Vec<Value>>();

                    serde_json::json!({
                        "name": group.name,
                        "hint": group.hint,
                        "tools": group_tools,
                    })
                })
                .collect::<Vec<Value>>();

            if tool_names.is_empty() {
                return None;
            }

            let namespaces = if index.tags.is_empty() {
                vec![manifest.name.clone()]
            } else {
                index.tags.clone()
            };
            let capabilities = if index.tool_groups.is_empty() {
                vec![capability_key(&manifest.name)]
            } else {
                index
                    .tool_groups
                    .iter()
                    .map(|group| capability_key(&group.name))
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<String>>()
            };

            Some(serde_json::json!({
                "key": manifest.name,
                "label": title_case_words(&manifest.name),
                "description": index.summary,
                "namespaces": namespaces,
                "capabilities": capabilities,
                "authState": auth_states
                    .get(&manifest.name)
                    .cloned()
                    .unwrap_or_else(|| "available".to_string()),
                "discoveryState": "breadcrumb",
                "toolCount": tool_names.len(),
                "tools": representative_tools,
                "toolGroups": tool_groups,
            }))
        })
        .collect()
}

pub(crate) async fn build_hosted_discovery_catalog(
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Value {
    discovery::build_hosted_discovery_catalog(state).await
}

fn auto_derive_registry_index(
    manifest: &mcpviews_shared::PluginManifest,
    cached_tools: Option<&[serde_json::Value]>,
) -> mcpviews_shared::PluginRegistryIndex {
    let prefix = manifest
        .mcp
        .as_ref()
        .map(|m| m.tool_prefix.as_str())
        .unwrap_or("");

    // Group tools by renderer name
    let mut renderer_tools: std::collections::HashMap<&str, Vec<&str>> =
        std::collections::HashMap::new();
    let mut ungrouped_tools: Vec<&str> = Vec::new();

    // Track which tools are mapped to renderers
    let mapped_tools: std::collections::HashSet<&str> = manifest.renderers.keys().map(|s| s.as_str()).collect();

    for (tool_name, renderer_name) in &manifest.renderers {
        renderer_tools
            .entry(renderer_name.as_str())
            .or_default()
            .push(tool_name.as_str());
    }

    // Find unmapped tools from cache
    if let Some(tools) = cached_tools {
        for tool in tools {
            if let Some(name) = tool.get("name").and_then(|n| n.as_str()) {
                let unprefixed = if !prefix.is_empty() {
                    name.strip_prefix(prefix).unwrap_or(name)
                } else {
                    name
                };
                if !mapped_tools.contains(unprefixed) {
                    ungrouped_tools.push(unprefixed);
                }
            }
        }
    }

    let mut tool_groups: Vec<mcpviews_shared::ToolGroupEntry> = Vec::new();

    for (renderer_name, tool_names) in &renderer_tools {
        // Get a hint from the first tool's description
        let hint = if let Some(tools) = cached_tools {
            let prefixed = format!("{}{}", prefix, tool_names[0]);
            tools.iter()
                .find(|t| t.get("name").and_then(|n| n.as_str()) == Some(&prefixed))
                .and_then(|t| t.get("description").and_then(|d| d.as_str()))
                .map(|d| {
                    let truncated: String = d.chars().take(80).collect();
                    if d.len() > 80 { format!("{}...", truncated) } else { truncated }
                })
                .unwrap_or_else(|| format!("Tools for {}", renderer_name))
        } else {
            format!("Tools for {}", renderer_name)
        };

        // Title-case the renderer name
        let name = renderer_name
            .split('_')
            .map(|w| {
                let mut c = w.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().to_string() + c.as_str(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ");

        tool_groups.push(mcpviews_shared::ToolGroupEntry {
            name,
            hint,
            tools: tool_names.iter().map(|s| s.to_string()).collect(),
        });
    }

    // Add ungrouped tools if any
    if !ungrouped_tools.is_empty() {
        tool_groups.push(mcpviews_shared::ToolGroupEntry {
            name: "Other".to_string(),
            hint: "Additional tools".to_string(),
            tools: ungrouped_tools.iter().map(|s| s.to_string()).collect(),
        });
    }

    let renderer_names: Vec<String> = renderer_tools.keys().map(|s| s.to_string()).collect();
    let tags: Vec<String> = renderer_names.iter().map(|r| r.replace('_', "-")).collect();

    mcpviews_shared::PluginRegistryIndex {
        summary: format!("{} plugin", manifest.name),
        tags,
        tool_groups,
        renderer_names,
    }
}

fn build_plugin_registry(
    manifests: &[mcpviews_shared::PluginManifest],
    tool_cache: &crate::tool_cache::ToolCache,
) -> Vec<Value> {
    manifests.iter().enumerate().map(|(idx, manifest)| {
        let index = match &manifest.registry_index {
            Some(ri) => ri.clone(),
            None => {
                let cached_tools = tool_cache.plugin_tools(idx);
                auto_derive_registry_index(manifest, cached_tools)
            }
        };

        serde_json::json!({
            "name": manifest.name,
            "summary": index.summary,
            "tags": index.tags,
            "tool_groups": index.tool_groups.iter().map(|g| serde_json::json!({
                "name": g.name,
                "hint": g.hint,
                "tools": g.tools,
            })).collect::<Vec<Value>>(),
            "renderers": index.renderer_names,
            "prompts": manifest.prompt_definitions.iter().map(|p| serde_json::json!({
                "name": p.name,
                "description": p.description,
                "arguments": p.arguments,
            })).collect::<Vec<Value>>(),
            "plugin_rules": manifest.plugin_rules,
        })
    }).collect()
}

/// Collect plugin updates by comparing installed versions against registry versions.
fn collect_plugin_updates(
    manifests: &[mcpviews_shared::PluginManifest],
    registry_entries: &[mcpviews_shared::RegistryEntry],
) -> Vec<Value> {
    manifests
        .iter()
        .filter_map(|manifest| {
            let entry = registry_entries.iter().find(|e| e.name == manifest.name)?;
            let new_ver = mcpviews_shared::newer_version(&manifest.version, &entry.version)?;
            Some(serde_json::json!({
                "name": manifest.name,
                "installed_version": manifest.version,
                "available_version": new_ver,
            }))
        })
        .collect()
}

/// Evaluate update preferences for each pending plugin update.
/// Returns a JSON value with `auto_update`, `ask_user`, and `instruction` fields.
fn evaluate_update_preferences(
    plugin_updates: &[Value],
    store: &mcpviews_shared::plugin_store::PluginStore,
) -> Value {
    let mut auto_update: Vec<Value> = Vec::new();
    let mut ask_user: Vec<Value> = Vec::new();

    for update in plugin_updates {
        let name = update["name"].as_str().unwrap_or("");
        let available_version = update["available_version"].as_str().unwrap_or("");
        let installed_version = update["installed_version"].as_str().unwrap_or("");
        let prefs = store.load_preferences(name);

        let entry = serde_json::json!({
            "name": name,
            "from": installed_version,
            "to": available_version,
        });

        match prefs.update_policy.as_str() {
            "always" => {
                auto_update.push(entry);
            }
            "skip" => {
                if prefs.update_policy_version.as_deref() == Some(available_version) {
                    // Skip this version — don't include in either list
                    continue;
                }
                // New version available, re-ask
                ask_user.push(entry);
            }
            _ => {
                // "ask" or default
                ask_user.push(entry);
            }
        }
    }

    serde_json::json!({
        "auto_update": auto_update,
        "ask_user": ask_user,
        "instruction": "For plugins in auto_update: call update_plugins immediately, then call mcpviews_setup to re-persist rules. For plugins in ask_user: ask the user with three options: (1) Yes, update this time (2) Yes, always auto-update (3) Skip this update. Then call save_update_preference with the user's choice before proceeding."
    })
}

/// Collect org token status for each OAuth plugin.
fn collect_org_tokens(manifests: &[mcpviews_shared::PluginManifest]) -> Value {
    let auth_dir = mcpviews_shared::auth_dir();
    let mut result = serde_json::Map::new();

    for manifest in manifests {
        if let Some(mcp) = &manifest.mcp {
            if let Some(mcpviews_shared::PluginAuth::OAuth { .. }) = &mcp.auth {
                let orgs = mcpviews_shared::token_store::list_orgs(&auth_dir, &manifest.name);
                if !orgs.is_empty() {
                    let org_entries: Vec<Value> = orgs.iter().map(|org_id| {
                        let token = mcpviews_shared::token_store::load_stored_token_for_org_unvalidated(
                            &auth_dir, &manifest.name, org_id
                        );
                        let status = match token {
                            Some(t) => if t.is_expired() { "expired" } else { "valid" },
                            None => "missing",
                        };
                        serde_json::json!({
                            "org_id": org_id,
                            "status": status
                        })
                    }).collect();

                    result.insert(manifest.name.clone(), serde_json::json!({
                        "orgs": org_entries
                    }));
                }
            }
        }
    }

    Value::Object(result)
}

/// Return platform-specific instructions for configuring automatic session initialization.
pub(crate) fn setup_instructions(agent_type: &str) -> String {
    session::setup_instructions(agent_type)
}

// ─── Renderer definitions ───

const RENDERER_SELECTION_RULE: &str = "When displaying content in MCPViews, choose the renderer based on data shape:\n\n- **rich_content**: Prose, explanations, diagrams (mermaid), code blocks, simple markdown tables (<10 rows), inline edit suggestions, embedded tables, plugin citations. Default choice. Use push_review when content includes suggestions or embedded table changes for user review.\n- **structured_data**: Standalone tabular data with sort/filter/expand needs, hierarchical rows, or proposed changes requiring accept/reject review. Use push_review for change approval workflows. For batch MCP actions (2+ mutations), structured_data with push_review is mandatory — see the bulk_action_review rule.\n\nPlugin tool output routes through rich_content with transformation rules defined in the plugin manifest. When uncertain, default to rich_content. Only use structured_data when the data is genuinely tabular with columns and rows and NOT embedded within a document.";

const RICH_CONTENT_RULE: &str = r#"CALLER RESTRICTION: ONLY the main/coordinator agent may call rich_content, structured_data, push_review, and push_check. Sub-agents must NEVER call these — return results to the coordinator.

When to call rich_content: detailed explanations, plans, architecture/data-flow diagrams, API designs, database schemas. Keep chat concise; rich detail goes to rich_content.

## `data` parameter

`data` MUST be a JSON **object**, not a stringified JSON string.
Correct: `"data": { "title": "...", "body": "..." }`
Wrong:   `"data": "{\"title\": \"...\"}"`

## Formatting the `body` field

Body is markdown (CommonMark). Supported: headings, bold/italic, lists, blockquotes, fenced code blocks, markdown tables (<10 rows; use structured_data for more), horizontal rules.

### Mermaid diagrams

MUST be wrapped in a fenced code block with language identifier `mermaid`. Bare `mermaid` without triple-backtick fences renders as plain text — this is the most common mistake.

In the JSON string value for body, a mermaid block looks like:
`"```mermaid\\nflowchart TD\\n  A[Start] --> B[End]\\n```"`

**Line breaks in node labels**: use `<br/>` tags. Never use `\\n` or literal newlines inside node text.
Correct: `A[Line one<br/>Line two]`
Wrong:   `A[Line one\nLine two]`

**Special characters in node text**: wrap node labels in quotes if they contain parentheses, brackets, or other Mermaid syntax characters.

### JSON string escaping

The body value is a JSON string. Use `\n` for newlines, `\"` for quotes, `\\` for backslashes. Backticks need no escaping.

## Inline edit suggestions (push_review only)

When proposing text changes for user review, use `suggestions` + `{{suggest:id=X}}` placement marks in the body:

```json
{
  "title": "Document Review",
  "body": "The system {{suggest:id=s1}} token-based auth.\n\n{{suggest:id=s2}}",
  "suggestions": {
    "s1": { "old": "uses", "new": "leverages" },
    "s2": { "type": "insert", "new": "New paragraph to insert." }
  }
}
```

Suggestion types: **replace** (default, has `old` + `new`), **insert** (`type: "insert"`, has `new`), **delete** (`type: "delete"`, has `old`). Multiline old/new values render as block-level diffs. Each suggestion gets accept/reject toggles and a comment button. Push via `push_review`, not `rich_content`.

## Embedded structured_data tables (push_review or rich_content)

Embed interactive tables within markdown using fenced code blocks:

````
Context paragraph explaining the changes.

```structured_data:t1
```

More context after the table.
````

Include table data in `data.tables`:
```json
{
  "body": "Context\n\n```structured_data:t1\n```",
  "tables": [{ "id": "t1", "name": "Changes", "columns": [...], "rows": [...] }]
}
```

Table data shape matches structured_data (columns with id/name/change, rows with id/cells/children). Tables are fully interactive in review mode (accept/reject rows, edit cells).

## Combined review payload

When `push_review` includes suggestions and/or tables, the user submits a combined `rich_content_decisions` payload:
```json
{
  "suggestion_decisions": { "s1": { "status": "accept", "comment": "looks good" } },
  "table_decisions": { "t1": { "decisions": {...}, "modifications": {...}, "additions": {...} } }
}
```

These arrive as `suggestionDecisions` and `tableDecisions` in the `await_review` response.

## Plugin citations

Reference plugin entities with `[label](cite:plugin:SOURCE:TYPE:ID)` links. Clicking opens a slideout panel that lazy-fetches full data. Include citation metadata in `data.citations.plugin`:
```json
{
  "citations": {
    "plugin": [
      { "index": 1, "source": "ludflow", "type": "code_unit", "id": "abc123", "label": "myFunc" }
    ]
  }
}
```"#;

const BULK_ACTION_REVIEW_RULE: &str = r#"When an agent plans 2 or more MCP tool calls that create, update, or delete external resources (mutations), it MUST present the planned actions to the user for review before executing any of them.

## Trigger

Any time the agent intends to make 2+ MCP tool calls that mutate external state (create, update, delete operations on files, database records, API resources, etc.).

## Mandate

Present all planned actions as `structured_data` via `push_review` before executing any mutation.

## Table structure

Use a single table with these columns:
- **Action** — the operation type: create, update, or delete
- **Entity Type** — what kind of resource (e.g., file, record, API endpoint)
- **Target** — the specific resource identifier (name, path, ID)
- **Details** — brief description of what will be created/changed/removed

Mark each row's `change` field to visually distinguish operations:
- `"add"` for create actions (green)
- `"update"` for update actions (yellow)
- `"delete"` for delete actions (red strikethrough)

**Use hierarchical rows for parent-child operations.** When creating containers with contents (e.g., folders with documents, categories with items), nest child rows inside parent rows using the `children` array. Do NOT flatten everything into a single list with a "Parent" column — the renderer shows collapsible nested rows natively.

## Workflow

1. **Gather**: Collect all planned mutations before executing any
2. **Present**: Send them via `push_review` as a structured_data table — this returns immediately with a `session_id`
3. **Wait**: Call `await_review(session_id)` to block until the user's decisions (accept/reject per row, possible cell edits). If your transport times out, call `await_review` again with the same `session_id` — the session persists on the server
4. **Execute**: Only execute rows the user accepted, respecting any user edits to cell values
5. **Report**: Summarize what was executed and what was skipped

## Single-action exception

If only 1 mutation is planned, `push_review` is not required — proceed directly.

## Formatting

See the `structured_data_usage` rule for full structured_data formatting details, column/row schema, and push_review response handling."#;

const STRUCTURED_DATA_RULE: &str = r#"Use structured_data when presenting tabular or schema data that benefits from sort, filter, expand/collapse, or review workflows. Prefer it over rich_content markdown tables when:
- Data has hierarchical/nested rows (parent-child relationships)
- Users need to sort or filter interactively
- Data represents proposed changes that need accept/reject review
- Tables have many rows (>10) where scrolling + filtering helps

Use rich_content with markdown tables for simple, small, static tables.

## Choose the right call pattern

- Use `push_content` + `structured_data` for a read-only interactive table.
- Use `push_review` + `structured_data` when the user needs to approve adds, deletes, updates, or edited cell values.
- If you want review behavior, do NOT send the table through plain `push_content` and expect approval controls to appear.

## Required payload shape — do not omit these

The most common failure mode is sending a payload that is almost correct but missing required ids or row structure. A valid structured_data payload requires:

- `data` must be a JSON object, not a stringified JSON string
- `tables` must be an array
- each table must have `id`, `name`, `columns`, and `rows`
- each column must have `id`, `name`, and `change`
- each row must have `id`, `cells`, and `children`
- `cells` must be an object keyed by column id
- `children` must always be present, even when empty (`[]`)

If table ids, row ids, or `children` are missing, the tool may validate or appear to partially render in one surface while looking empty or broken in another.

## Hierarchical rows — USE THEM

**IMPORTANT**: When data has parent-child relationships (folders containing files, categories with items, sections with sub-items, etc.), use `children` arrays to nest child rows inside parent rows. Do NOT flatten the hierarchy into a single column with descriptions like "parent: X" — the renderer supports collapsible nested rows natively.

Example — folders containing documents:
```json
{
  "rows": [
    {
      "id": "folder1",
      "cells": { "name": { "value": "Architecture", "change": "add" }, "type": { "value": "folder", "change": "add" } },
      "children": [
        {
          "id": "doc1",
          "cells": { "name": { "value": "API Design", "change": "add" }, "type": { "value": "document", "change": "add" } },
          "children": []
        },
        {
          "id": "doc2",
          "cells": { "name": { "value": "Data Model", "change": "add" }, "type": { "value": "document", "change": "add" } },
          "children": []
        }
      ]
    }
  ]
}
```

This renders as a collapsible tree: clicking "Architecture" expands to show its two documents indented beneath it. Rows auto-expand to depth 2; deeper rows start collapsed.

**When to nest**: Any time you would otherwise add a "Parent" or "Folder" column to describe containment, or group items by category in a flat list — nest them instead.

## push_content + structured_data (read-only display)

Display-only mode. Change markers are automatically stripped by the server and ignored by the renderer. Set all `change` fields to null.

Example:
```json
{
  "title": "Server Inventory",
  "tables": [{
    "id": "t1",
    "name": "Production Servers",
    "columns": [
      { "id": "name", "name": "Name", "change": null },
      { "id": "type", "name": "Type", "change": null },
      { "id": "status", "name": "Status", "change": null }
    ],
    "rows": [
      {
        "id": "r1",
        "cells": {
          "name": { "value": "api-01", "change": null },
          "type": { "value": "m5.xlarge", "change": null },
          "status": { "value": "Running", "change": null }
        },
        "children": []
      }
    ]
  }]
}
```

## push_review + structured_data (change review mode — two-step flow)

`push_review` returns immediately with a `session_id`. Call `await_review(session_id)` to block until the user submits. If your transport times out, call `await_review` again — the session persists on the server.

Shows proposed changes with color-coded diffs. Users can accept/reject individual rows and columns, edit cell values, then submit. Use `change` fields to mark what was added, deleted, or updated.

Change values: "add" (green), "delete" (red strikethrough), "update" (yellow), null (unchanged).

Example with nested rows:
```json
{
  "tool_name": "structured_data",
  "data": {
    "title": "Document Organization Review",
    "tables": [{
      "id": "t1",
      "name": "Folders & Documents",
      "columns": [
        { "id": "name", "name": "Name", "change": null },
        { "id": "details", "name": "Details", "change": null }
      ],
      "rows": [
        {
          "id": "folder1",
          "cells": {
            "name": { "value": "Design Specs", "change": "add" },
            "details": { "value": "3 documents", "change": "add" }
          },
          "children": [
            {
              "id": "doc1",
              "cells": {
                "name": { "value": "API Design v2", "change": "add" },
                "details": { "value": "REST endpoint specifications", "change": "add" }
              },
              "children": []
            },
            {
              "id": "doc2",
              "cells": {
                "name": { "value": "Data Model", "change": "add" },
                "details": { "value": "ERD and schema definitions", "change": "add" }
              },
              "children": []
            }
          ]
        }
      ]
    }]
  },
  "timeout": 300
}
```

For CSV-style review workflows, each CSV row should map to a structured_data row with a stable row `id`, and each CSV column should map to a structured_data column `id`. If a profit value was corrected in a finance CSV, that belongs in a cell like:

```json
{
  "profit": { "value": 650, "change": "update" }
}
```

inside a row shaped like:

```json
{
  "id": "row_2026_04_08",
  "cells": {
    "date": { "value": "2026-04-08", "change": null },
    "profit": { "value": 650, "change": "update" }
  },
  "children": []
}
```

push_review response contains user decisions:
```json
{
  "sessionId": "uuid",
  "status": "decision_received",
  "decision": "partial",
  "operationDecisions": { "r1": "accept", "col:new_col": "reject" },
  "modifications": { "r1.type": "{\"value\":\"text\",\"user_edited\":true}" },
  "additions": { "user_edits": { "r1.type": "text" } }
}
```

**Bulk MCP actions**: When an agent plans 2+ MCP tool calls that mutate external resources, it MUST present them via push_review before executing. push_review returns a session_id; call await_review(session_id) to block until the user decides. See the bulk_action_review rule for the full workflow and table structure.

## Data shape reference

- `tables[]`: Array of table objects, each with `id`, `name`, `columns[]`, `rows[]`
- `columns[]`: `{ id, name, change }` — change is null for read-only, "add"/"delete" for review
- `rows[]`: `{ id, cells, children }` — cells is `{ [colId]: { value, change } }`, children enables arbitrary nesting
- For read-only tables rendered via `push_content`, set all `change` values to null
- For approval flows rendered via `push_review`, set row/column/cell `change` values explicitly where changes exist
- **Always use `children` for parent-child relationships** — do not flatten hierarchies into extra columns
- Nested rows auto-expand to depth 2; deeper rows start collapsed"#;

fn builtin_renderer_definitions() -> Vec<RendererDef> {
    vec![
        RendererDef {
            name: "rich_content".into(),
            description: "Universal markdown display with mermaid diagrams, tables, code blocks, and citations. Use for any rich text content.".into(),
            scope: "universal".into(),
            tools: vec![],
            data_hint: Some(r#"{ "title": "Optional heading", "body": "Markdown with ```mermaid blocks and {{suggest:id=X}} markers", "suggestions": { "s1": { "old": "text", "new": "replacement" } }, "tables": [{ "id": "t1", "name": "Name", "columns": [...], "rows": [...] }], "citations": { "plugin": [{ "index": 1, "source": "ludflow", "type": "code_unit", "id": "abc123", "label": "name" }] } } — data must be a JSON object, not a string. suggestions and tables are optional, used with push_review."#.into()),
            rule: Some(RICH_CONTENT_RULE.into()),
            display_mode: None,
            invoke_schema: None,
            url_patterns: vec![],
            standalone: false,
            standalone_label: None,
        },
        RendererDef {
            name: "structured_data".into(),
            description: "Tabular data with hierarchical rows, change tracking, sort/filter, and review mode with per-row/column accept/reject and cell editing.".into(),
            scope: "universal".into(),
            tools: vec![],
            data_hint: Some(r#"{ "title": "Optional", "tables": [{ "id": "t1", "name": "Name", "columns": [{ "id": "c1", "name": "Col", "change": null|"add"|"delete" }], "rows": [{ "id": "r1", "cells": { "c1": { "value": "v", "change": null|"add"|"delete"|"update" } }, "children": [] }] }] }"#.into()),
            display_mode: None,
            invoke_schema: None,
            url_patterns: vec![],
            standalone: false,
            standalone_label: None,
            rule: Some(STRUCTURED_DATA_RULE.into()),
        },
    ]
}

/// Synthesize `RendererDef` entries from a manifest's `renderers` map for any
/// renderer names not already in `known_names`. Uses cached tool definitions
/// to derive descriptions when available.
fn synthesize_renderer_defs(
    manifest: &mcpviews_shared::PluginManifest,
    cached_tools: Option<&[serde_json::Value]>,
    known_names: &std::collections::HashSet<&str>,
) -> Vec<RendererDef> {
    // Group tools by renderer name, skipping already-known renderers
    let mut renderer_tools: std::collections::HashMap<&str, Vec<&str>> =
        std::collections::HashMap::new();
    for (tool_name, renderer_name) in &manifest.renderers {
        if !known_names.contains(renderer_name.as_str()) {
            renderer_tools
                .entry(renderer_name.as_str())
                .or_default()
                .push(tool_name.as_str());
        }
    }

    let prefix = manifest
        .mcp
        .as_ref()
        .map(|m| m.tool_prefix.as_str())
        .unwrap_or("");

    let mut result = Vec::new();
    for (renderer_name, tool_names) in renderer_tools {
        let mut tool_descriptions: Vec<String> = Vec::new();

        for tool_name in &tool_names {
            let prefixed = format!("{}{}", prefix, tool_name);
            if let Some(tools) = cached_tools {
                if let Some(tool_def) = tools
                    .iter()
                    .find(|t| t.get("name").and_then(|n| n.as_str()) == Some(&prefixed))
                {
                    if let Some(desc) = tool_def.get("description").and_then(|d| d.as_str()) {
                        tool_descriptions.push(format!("- {}: {}", tool_name, desc));
                    }
                }
            }
        }

        let description = if tool_descriptions.is_empty() {
            format!("Renderer for {} plugin", manifest.name)
        } else {
            format!(
                "Renders output from these tools:\n{}",
                tool_descriptions.join("\n")
            )
        };

        let data_hint = format!(
            "Pass the result from any of these tools: {}. The data shape matches the tool's response.",
            tool_names.join(", ")
        );

        result.push(RendererDef {
            name: renderer_name.to_string(),
            description,
            scope: "tool".to_string(),
            tools: tool_names.iter().map(|s| s.to_string()).collect(),
            data_hint: Some(data_hint),
            rule: None,
            display_mode: None,
            invoke_schema: None,
            url_patterns: vec![],
            standalone: false,
            standalone_label: None,
        });
    }

    result
}

pub fn available_renderers(state: &std::sync::Arc<crate::state::AppState>) -> Vec<RendererDef> {
    let mut renderers = builtin_renderer_definitions();
    let registry = state.plugin_registry.lock().unwrap();

    for (idx, manifest) in registry.manifests.iter().enumerate() {
        // 1. Add explicit renderer definitions (plugin-provided, rich metadata)
        renderers.extend(manifest.renderer_definitions.clone());

        // 2. Collect names already covered
        let known: std::collections::HashSet<&str> =
            renderers.iter().map(|r| r.name.as_str()).collect();

        // 3. Synthesize from renderers map for any not already covered
        let cached_tools = registry.tool_cache.plugin_tools(idx);
        renderers.extend(synthesize_renderer_defs(manifest, cached_tools, &known));
    }

    renderers
}

// ─── Tool definitions ───

fn build_data_description(renderers: &[RendererDef], prefix: &str) -> String {
    let hints = renderers.iter()
        .filter(|r| r.scope == "universal")
        .filter_map(|r| r.data_hint.as_ref().map(|h| format!("For {}: {}", r.name, h)))
        .collect::<Vec<_>>()
        .join(". ");
    format!("{} {} For plugin renderer data shapes, call get_plugin_docs.", prefix, hints)
}

fn renderer_description(renderers: &[RendererDef], name: &str, fallback: &str) -> String {
    renderers
        .iter()
        .find(|renderer| renderer.name == name)
        .map(|renderer| renderer.description.clone())
        .unwrap_or_else(|| fallback.to_string())
}

fn direct_renderer_tool_definitions(renderers: &[RendererDef]) -> Vec<Value> {
    builtin_registry::builtin_tool_definitions(renderers)
        .into_iter()
        .filter(|tool| {
            matches!(
                tool.get("name").and_then(|value| value.as_str()),
                Some("rich_content" | "structured_data")
            )
        })
        .collect()
}

fn builtin_tool_definitions(renderers: &[RendererDef]) -> Vec<Value> {
    builtin_registry::builtin_tool_definitions(renderers)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mcpviews_shared::{PluginManifest, PluginMcpConfig, PluginAuth};

    fn make_manifest(
        name: &str,
        renderer_defs: Vec<RendererDef>,
        tool_rules: std::collections::HashMap<String, String>,
        mcp: Option<PluginMcpConfig>,
    ) -> PluginManifest {
        PluginManifest {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            renderers: std::collections::HashMap::new(),
            mcp,
            renderer_definitions: renderer_defs,
            tool_rules,
            no_auto_push: vec![],
            registry_index: None,
            download_url: None,
            prompt_definitions: vec![],
            plugin_rules: vec![],
        }
    }

    // ─── collect_rules tests ───

    #[test]
    fn test_collect_rules_includes_renderer_selection() {
        let rules = collect_rules(&[], &[]);
        assert_eq!(rules.len(), 2);
        let sel = rules.iter().find(|r| r["name"] == "renderer_selection").expect("renderer_selection rule should exist");
        assert_eq!(sel["category"], "system");
    }

    #[test]
    fn test_collect_rules_builtin_renderer_with_rule() {
        let renderers = vec![RendererDef {
            name: "rich_content".into(),
            description: "Universal markdown display".into(),
            scope: "universal".into(),
            tools: vec![],
            data_hint: Some(r#"{ "title": "heading", "body": "markdown" }"#.into()),
            rule: Some("Always use rich_content for plans.".into()),
            display_mode: None,
            invoke_schema: None,
            url_patterns: vec![],
            standalone: false,
            standalone_label: None,
        }];
        let rules = collect_rules(&renderers, &[]);
        assert_eq!(rules.len(), 3);
        let sel = rules.iter().find(|r| r["name"] == "renderer_selection").expect("renderer_selection rule should exist");
        assert_eq!(sel["category"], "system");

        let rc = rules.iter().find(|r| r["name"] == "rich_content_usage").expect("rich_content_usage rule should exist");
        assert_eq!(rc["category"], "renderer");
        assert_eq!(rc["source"], "built-in");
        assert_eq!(rc["renderer"], "rich_content");
        assert_eq!(rc["rule"], "Always use rich_content for plans.");
        assert_eq!(rc["description"], "Universal markdown display");
        assert_eq!(rc["scope"], "universal");
        assert_eq!(rc["data_hint"], r#"{ "title": "heading", "body": "markdown" }"#);
    }

    #[test]
    fn test_collect_rules_builtin_renderer_without_rule_skipped() {
        let renderers = vec![RendererDef {
            name: "no_rule".into(),
            description: "test".into(),
            scope: "universal".into(),
            tools: vec![],
            data_hint: None,
            rule: None,
            display_mode: None,
            invoke_schema: None,
            url_patterns: vec![],
            standalone: false,
            standalone_label: None,
        }];
        let rules = collect_rules(&renderers, &[]);
        // Only the renderer_selection + bulk_action_review rules, no renderer-specific rule
        assert_eq!(rules.len(), 2);
        let sel = rules.iter().find(|r| r["name"] == "renderer_selection").expect("renderer_selection rule should exist");
        assert_eq!(sel["category"], "system");
    }

    #[test]
    fn test_collect_rules_renderer_with_rule() {
        let renderers = vec![RendererDef {
            name: "custom_view".into(),
            description: "Custom".into(),
            scope: "tool".into(),
            tools: vec![],
            data_hint: None,
            rule: Some("Use custom_view for X.".into()),
            display_mode: None,
            invoke_schema: None,
            url_patterns: vec![],
            standalone: false,
            standalone_label: None,
        }];
        let rules = collect_rules(&renderers, &[]);
        assert_eq!(rules.len(), 3);
        let cv = rules.iter().find(|r| r["renderer"] == "custom_view").expect("custom_view rule should exist");
        assert_eq!(cv["source"], "plugin");
        assert_eq!(cv["description"], "Custom");
        assert_eq!(cv["scope"], "tool");
    }

    #[test]
    fn test_collect_rules_synthesized_renderer_included() {
        let renderers = vec![RendererDef {
            name: "search_results".into(),
            description: "Renders search output".into(),
            scope: "tool".into(),
            tools: vec!["search_codebase".into()],
            data_hint: Some("Pass search results".into()),
            rule: None,
            display_mode: None,
            invoke_schema: None,
            url_patterns: vec![],
            standalone: false,
            standalone_label: None,
        }];
        let rules = collect_rules(&renderers, &[]);
        assert_eq!(rules.len(), 3);
        let sr = rules.iter().find(|r| r["renderer"] == "search_results").expect("search_results rule should exist");
        assert_eq!(sr["category"], "renderer");
        assert_eq!(sr["source"], "plugin");
        assert_eq!(sr["tools"][0], "search_codebase");
        assert_eq!(sr["scope"], "tool");
        assert_eq!(sr["description"], "Renders search output");
        assert_eq!(sr["data_hint"], "Pass search results");
    }

    #[test]
    fn test_collect_rules_plugin_tool_rules_prefixed() {
        let mut tool_rules = std::collections::HashMap::new();
        tool_rules.insert("search".to_string(), "Use search for queries.".to_string());
        let manifest = make_manifest(
            "search-plugin",
            vec![],
            tool_rules,
            Some(PluginMcpConfig {
                url: "http://localhost:8080".into(),
                auth: None,
                tool_prefix: "sp__".into(),
            }),
        );
        let rules = collect_rules(&[], &[manifest]);
        assert_eq!(rules.len(), 3);
        let tr = rules.iter().find(|r| r["name"] == "sp__search_usage").expect("sp__search_usage rule should exist");
        assert_eq!(tr["category"], "tool");
        assert_eq!(tr["tool"], "sp__search");
        assert_eq!(tr["source"], "search-plugin");
    }

    #[test]
    fn test_collect_rules_plugin_tool_rules_no_prefix() {
        let mut tool_rules = std::collections::HashMap::new();
        tool_rules.insert("do_thing".to_string(), "Do the thing.".to_string());
        let manifest = make_manifest(
            "bare-plugin",
            vec![],
            tool_rules,
            Some(PluginMcpConfig {
                url: "http://localhost:8080".into(),
                auth: None,
                tool_prefix: "".into(),
            }),
        );
        let rules = collect_rules(&[], &[manifest]);
        assert_eq!(rules.len(), 3);
        let tr = rules.iter().find(|r| r["tool"] == "do_thing").expect("do_thing rule should exist");
        assert_eq!(tr["name"], "do_thing_usage");
    }

    // ─── collect_plugin_auth_status tests ───

    #[test]
    fn test_collect_plugin_auth_status_no_mcp() {
        let manifest = make_manifest("no-mcp", vec![], std::collections::HashMap::new(), None);
        let status = collect_plugin_auth_status(&[manifest]);
        assert!(status.is_empty());
    }

    #[test]
    fn test_collect_plugin_auth_status_oauth_not_configured() {
        let _dir = tempfile::tempdir().unwrap();
        // Point auth_dir to empty temp dir so no tokens are found
        // We need to use a plugin name that won't have a stored token
        let manifest = make_manifest(
            "oauth-test-plugin-nocfg",
            vec![],
            std::collections::HashMap::new(),
            Some(PluginMcpConfig {
                url: "http://localhost:8080".into(),
                auth: Some(PluginAuth::OAuth {
                    client_id: Some("client123".into()),
                    auth_url: "https://example.com/auth".into(),
                    token_url: "https://example.com/token".into(),
                    scopes: vec![],
                }),
                tool_prefix: "otp".into(),
            }),
        );
        let status = collect_plugin_auth_status(&[manifest]);
        assert_eq!(status.len(), 1);
        assert_eq!(status[0]["plugin"], "oauth-test-plugin-nocfg");
        assert_eq!(status[0]["auth_type"], "oauth");
        // OAuth with no stored token => not configured
        assert_eq!(status[0]["auth_configured"], false);
        assert_eq!(status[0]["auth_url"], "https://example.com/auth");
        assert!(status[0]["message"].as_str().unwrap().contains("requires re-authentication"));
    }

    #[test]
    fn test_collect_plugin_auth_status_bearer_with_env_configured() {
        // Set env var so bearer auth is considered configured
        std::env::set_var("TEST_AUTH_STATUS_BEARER_TOKEN", "tok");
        let manifest = make_manifest(
            "bearer-test-plugin",
            vec![],
            std::collections::HashMap::new(),
            Some(PluginMcpConfig {
                url: "http://localhost:8080".into(),
                auth: Some(PluginAuth::Bearer {
                    token_env: "TEST_AUTH_STATUS_BEARER_TOKEN".into(),
                }),
                tool_prefix: "bt".into(),
            }),
        );
        let status = collect_plugin_auth_status(&[manifest]);
        assert_eq!(status.len(), 1);
        assert_eq!(status[0]["auth_configured"], true);
        assert!(status[0].get("auth_url").is_none());
        std::env::remove_var("TEST_AUTH_STATUS_BEARER_TOKEN");
    }

    // ─── persistence_instructions tests ───

    #[test]
    fn test_persistence_instructions_claude_code() {
        let instr = persistence_instructions("claude_code");
        assert!(instr.contains(".claude/rules"));
    }

    #[test]
    fn test_persistence_instructions_claude_desktop() {
        let instr = persistence_instructions("claude_desktop");
        assert!(instr.contains("memory"));
    }

    #[test]
    fn test_persistence_instructions_codex() {
        let instr = persistence_instructions("codex");
        assert!(instr.contains("AGENTS.md"));
    }

    #[test]
    fn test_persistence_instructions_cursor() {
        let instr = persistence_instructions("cursor");
        assert!(instr.contains(".cursor/rules"));
    }

    #[test]
    fn test_persistence_instructions_windsurf() {
        let instr = persistence_instructions("windsurf");
        assert!(instr.contains(".windsurfrules"));
    }

    #[test]
    fn test_persistence_instructions_opencode() {
        let instr = persistence_instructions("opencode");
        assert!(instr.contains("AGENTS.md"));
    }

    #[test]
    fn test_persistence_instructions_antigravity() {
        let instr = persistence_instructions("antigravity");
        assert!(instr.contains("AGENTS.md"));
    }

    #[test]
    fn test_persistence_instructions_generic() {
        let instr = persistence_instructions("generic");
        assert!(instr.contains("Ask the user"));
    }

    #[test]
    fn test_persistence_instructions_unknown() {
        let instr = persistence_instructions("some_unknown_agent");
        assert!(instr.contains("Ask the user"));
    }

    // ─── synthesize_renderer_defs tests ───

    fn make_manifest_with_renderers(
        name: &str,
        renderers: std::collections::HashMap<String, String>,
        prefix: &str,
    ) -> PluginManifest {
        PluginManifest {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            renderers,
            mcp: Some(PluginMcpConfig {
                url: "http://localhost:8080".into(),
                auth: None,
                tool_prefix: prefix.to_string(),
            }),
            renderer_definitions: vec![],
            tool_rules: std::collections::HashMap::new(),
            no_auto_push: vec![],
            registry_index: None,
            download_url: None,
            prompt_definitions: vec![],
            plugin_rules: vec![],
        }
    }

    #[test]
    fn test_synthesize_with_tool_cache_data() {
        let mut renderers_map = std::collections::HashMap::new();
        renderers_map.insert("search_codebase".to_string(), "search_results".to_string());
        let manifest = make_manifest_with_renderers("ludflow", renderers_map, "ludflow__");

        let cached_tools = vec![
            serde_json::json!({
                "name": "ludflow__search_codebase",
                "description": "Search the codebase for matching code"
            }),
        ];

        let known = std::collections::HashSet::new();
        let result = synthesize_renderer_defs(&manifest, Some(&cached_tools), &known);

        assert_eq!(result.len(), 1);
        let def = &result[0];
        assert_eq!(def.name, "search_results");
        assert!(def.description.contains("search_codebase"));
        assert!(def.description.contains("Search the codebase"));
        assert_eq!(def.tools, vec!["search_codebase"]);
        assert!(def.data_hint.is_some());
        assert_eq!(def.scope, "tool");
        assert!(def.rule.is_none());
    }

    #[test]
    fn test_synthesize_skips_known_renderers() {
        let mut renderers_map = std::collections::HashMap::new();
        renderers_map.insert("search_codebase".to_string(), "search_results".to_string());
        let manifest = make_manifest_with_renderers("ludflow", renderers_map, "ludflow__");

        let cached_tools = vec![
            serde_json::json!({
                "name": "ludflow__search_codebase",
                "description": "Search the codebase"
            }),
        ];

        let mut known = std::collections::HashSet::new();
        known.insert("search_results");
        let result = synthesize_renderer_defs(&manifest, Some(&cached_tools), &known);

        assert!(result.is_empty());
    }

    #[test]
    fn test_synthesize_without_cache_data() {
        let mut renderers_map = std::collections::HashMap::new();
        renderers_map.insert("search_codebase".to_string(), "search_results".to_string());
        let manifest = make_manifest_with_renderers("ludflow", renderers_map, "ludflow__");

        let known = std::collections::HashSet::new();
        let result = synthesize_renderer_defs(&manifest, None, &known);

        assert_eq!(result.len(), 1);
        let def = &result[0];
        assert_eq!(def.name, "search_results");
        assert!(def.description.contains("Renderer for ludflow plugin"));
        assert_eq!(def.tools, vec!["search_codebase"]);
    }

    // ─── setup_instructions tests ───

    #[test]
    fn test_setup_instructions_claude_code() {
        let instr = setup_instructions("claude_code");
        assert!(instr.contains("init_session"));
        assert!(instr.contains(".claude/rules"));
    }

    #[test]
    fn test_setup_instructions_claude_desktop() {
        let instr = setup_instructions("claude_desktop");
        assert!(instr.contains("init_session"));
        assert!(instr.contains("memory"));
    }

    #[test]
    fn test_setup_instructions_cursor() {
        let instr = setup_instructions("cursor");
        assert!(instr.contains("init_session"));
        assert!(instr.contains(".cursor/rules"));
    }

    #[test]
    fn test_setup_instructions_codex() {
        let instr = setup_instructions("codex");
        assert!(instr.contains("init_session"));
        assert!(instr.contains("AGENTS.md"));
    }

    #[test]
    fn test_setup_instructions_windsurf() {
        let instr = setup_instructions("windsurf");
        assert!(instr.contains("init_session"));
        assert!(instr.contains(".windsurfrules"));
    }

    #[test]
    fn test_setup_instructions_generic() {
        let instr = setup_instructions("generic");
        assert!(instr.contains("init_session"));
    }

    #[test]
    fn test_setup_instructions_unknown() {
        let instr = setup_instructions("some_unknown_agent");
        assert!(instr.contains("init_session"));
    }

    // ─── synthesize_renderer_defs tests ───

    // ─── extract_tool_summaries tests ───

    #[test]
    fn test_extract_tool_summaries_extracts_name_and_description() {
        let tools = vec![
            serde_json::json!({
                "name": "rich_content",
                "description": "Display rich markdown content in the MCPViews window.",
                "inputSchema": { "type": "object" }
            }),
            serde_json::json!({
                "name": "push_review",
                "description": "Display content for review. Returns session_id; call await_review to wait.",
                "inputSchema": { "type": "object" }
            }),
        ];
        let summaries = extract_tool_summaries(&tools);
        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0]["name"], "rich_content");
        assert_eq!(summaries[0]["description"], "Display rich markdown content in the MCPViews window.");
        // Should NOT include inputSchema
        assert!(summaries[0].get("inputSchema").is_none());
        assert_eq!(summaries[1]["name"], "push_review");
    }

    #[test]
    fn test_builtin_tool_definitions_include_direct_renderer_tools() {
        let renderers = builtin_renderer_definitions();
        let tools = builtin_tool_definitions(&renderers);
        let rich_content = tools.iter().find(|t| t["name"] == "rich_content").expect("rich_content tool should exist");
        let structured_data = tools.iter().find(|t| t["name"] == "structured_data").expect("structured_data tool should exist");
        assert_eq!(rich_content["inputSchema"]["type"], "object");
        assert_eq!(structured_data["inputSchema"]["required"], serde_json::json!(["tables"]));
        assert!(tools.iter().any(|tool| tool["name"] == "push_content"), "push_content compatibility alias should remain available locally");
    }

    #[test]
    fn test_filter_hosted_model_facing_tools_hides_push_content_alias() {
        let filtered = filter_hosted_model_facing_tools(vec![
            serde_json::json!({ "name": "rich_content" }),
            serde_json::json!({ "name": "structured_data" }),
            serde_json::json!({ "name": "push_content" }),
            serde_json::json!({ "name": "push_review" }),
        ]);
        let tool_names = filtered
            .iter()
            .filter_map(|tool| tool.get("name").and_then(|value| value.as_str()))
            .collect::<Vec<_>>();
        assert!(tool_names.contains(&"rich_content"));
        assert!(tool_names.contains(&"structured_data"));
        assert!(tool_names.contains(&"push_review"));
        assert!(!tool_names.contains(&"push_content"));
    }

    #[test]
    fn test_build_core_hosted_connector_prefers_direct_renderer_tools() {
        let connector = build_core_hosted_connector(&[
            serde_json::json!({ "name": "rich_content" }),
            serde_json::json!({ "name": "structured_data" }),
            serde_json::json!({ "name": "push_review" }),
            serde_json::json!({ "name": "describe_connector" }),
        ]).expect("core connector should exist");

        let presentation_tools = connector["toolGroups"][0]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool.get("name").and_then(|value| value.as_str()))
            .collect::<Vec<_>>();

        assert!(presentation_tools.contains(&"rich_content"));
        assert!(presentation_tools.contains(&"structured_data"));
        assert!(!presentation_tools.contains(&"push_content"));
    }

    #[test]
    fn test_direct_renderer_tool_definitions_stay_in_registry_sync() {
        let renderers = builtin_renderer_definitions();
        let direct_tools = direct_renderer_tool_definitions(&renderers);
        let direct_names = direct_tools
            .iter()
            .filter_map(|tool| tool.get("name").and_then(|value| value.as_str()))
            .collect::<Vec<_>>();

        assert_eq!(direct_names, vec!["rich_content", "structured_data"]);

        let registry_tools = builtin_registry::builtin_tool_definitions(&renderers);
        for name in direct_names {
            assert!(
                registry_tools.iter().any(|tool| tool["name"] == name),
                "registry-backed builtins should still define {}",
                name,
            );
        }
    }

    #[test]
    fn test_build_core_hosted_connector_uses_registry_group_metadata() {
        let renderers = builtin_renderer_definitions();
        let available_tools = extract_tool_summaries(&builtin_registry::builtin_tool_definitions(&renderers));
        let connector =
            build_core_hosted_connector(&available_tools).expect("core connector should exist");

        let actual_groups = connector["toolGroups"]
            .as_array()
            .unwrap()
            .iter()
            .map(|group| {
                (
                    group["name"].as_str().unwrap().to_string(),
                    group["hint"].as_str().unwrap().to_string(),
                )
            })
            .collect::<Vec<_>>();

        let mut expected_groups = Vec::new();
        for spec in builtin_registry::builtin_tool_specs() {
            let Some(group) = spec.core_connector_group else {
                continue;
            };
            if !expected_groups.iter().any(|(name, _)| name == group.name) {
                expected_groups.push((group.name.to_string(), group.hint.to_string()));
            }
        }

        assert_eq!(actual_groups, expected_groups);
    }

    #[test]
    fn test_extract_tool_summaries_skips_entries_without_name() {
        let tools = vec![
            serde_json::json!({ "description": "no name field" }),
            serde_json::json!({ "name": "valid_tool", "description": "has name" }),
        ];
        let summaries = extract_tool_summaries(&tools);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0]["name"], "valid_tool");
    }

    #[test]
    fn test_extract_tool_summaries_handles_missing_description() {
        let tools = vec![
            serde_json::json!({ "name": "no_desc_tool" }),
        ];
        let summaries = extract_tool_summaries(&tools);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0]["name"], "no_desc_tool");
        assert_eq!(summaries[0]["description"], "");
    }

    // ─── install_plugin_from_manifest tests ───

    #[test]
    fn test_install_plugin_manifest_only() {
        let (state, _dir) = crate::test_utils::test_app_state();
        let manifest = crate::test_utils::test_manifest("test-install");

        let result = state.install_plugin_from_manifest(manifest, false);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "test-install");

        let registry = state.plugin_registry.lock().unwrap();
        assert_eq!(registry.manifests.len(), 1);
        assert_eq!(registry.manifests[0].name, "test-install");
    }

    #[test]
    fn test_install_plugin_invalid_manifest_json() {
        // Verify that serde_json rejects invalid JSON before it reaches install_plugin_from_manifest
        let bad_json = "{ not valid json }";
        let result = serde_json::from_str::<mcpviews_shared::PluginManifest>(bad_json);
        assert!(result.is_err());
    }

    #[test]
    fn test_install_plugin_upsert_replaces_existing() {
        let (state, _dir) = crate::test_utils::test_app_state();
        let manifest_v1 = crate::test_utils::test_manifest("upsert-plugin");

        state.install_plugin_from_manifest(manifest_v1, false).unwrap();
        {
            let registry = state.plugin_registry.lock().unwrap();
            assert_eq!(registry.manifests.len(), 1);
        }

        let mut manifest_v2 = crate::test_utils::test_manifest("upsert-plugin");
        manifest_v2.version = "2.0.0".to_string();
        state.install_plugin_from_manifest(manifest_v2, false).unwrap();

        let registry = state.plugin_registry.lock().unwrap();
        assert_eq!(registry.manifests.len(), 1);
        assert_eq!(registry.manifests[0].name, "upsert-plugin");
        assert_eq!(registry.manifests[0].version, "2.0.0");
    }

    #[test]
    fn test_install_plugin_missing_manifest_json_param() {
        // Simulates the extraction logic in call_install_plugin: missing manifest_json → error
        let arguments = serde_json::json!({});
        let result = arguments
            .get("manifest_json")
            .and_then(|v| v.as_str())
            .ok_or("Missing required parameter: manifest_json");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Missing required parameter: manifest_json");
    }

    // ─── schema description tests ───

    #[test]
    fn test_install_plugin_schema_download_url_description() {
        let tools = builtin_tool_definitions(&[]);
        let install_tool = tools.iter()
            .find(|t| t["name"] == "mcpviews_install_plugin")
            .expect("mcpviews_install_plugin tool should exist");
        let desc = install_tool["inputSchema"]["properties"]["download_url"]["description"]
            .as_str()
            .unwrap();
        assert!(
            desc.contains("the manifest_json parameter is not used"),
            "Description should accurately reflect that manifest_json is not used when download_url is provided. Got: {}",
            desc,
        );
        assert!(
            !desc.contains("still required for validation"),
            "Description should not claim manifest_json is required for validation. Got: {}",
            desc,
        );
    }

    #[test]
    fn test_synthesize_groups_multiple_tools_under_one_renderer() {
        let mut renderers_map = std::collections::HashMap::new();
        renderers_map.insert("search_codebase".to_string(), "search_results".to_string());
        renderers_map.insert("vector_search".to_string(), "search_results".to_string());
        let manifest = make_manifest_with_renderers("ludflow", renderers_map, "ludflow__");

        let cached_tools = vec![
            serde_json::json!({
                "name": "ludflow__search_codebase",
                "description": "Search the codebase"
            }),
            serde_json::json!({
                "name": "ludflow__vector_search",
                "description": "Vector search"
            }),
        ];

        let known = std::collections::HashSet::new();
        let result = synthesize_renderer_defs(&manifest, Some(&cached_tools), &known);

        assert_eq!(result.len(), 1);
        let def = &result[0];
        assert_eq!(def.name, "search_results");
        assert_eq!(def.tools.len(), 2);
        assert!(def.tools.contains(&"search_codebase".to_string()));
        assert!(def.tools.contains(&"vector_search".to_string()));
    }

    // ─── collect_builtin_rules tests ───

    #[test]
    fn test_collect_builtin_rules_includes_renderer_selection() {
        let rules = collect_builtin_rules(&[]);
        assert_eq!(rules.len(), 3);
        assert_eq!(rules[0]["name"], "renderer_selection");
    }

    #[test]
    fn test_collect_builtin_rules_includes_universal_renderers_only() {
        let renderers = vec![
            RendererDef {
                name: "rich_content".into(),
                description: "Universal markdown".into(),
                scope: "universal".into(),
                tools: vec![],
                data_hint: Some("{ title, body }".into()),
                rule: Some("Use for prose.".into()),
                display_mode: None,
                invoke_schema: None,
                url_patterns: vec![],
            standalone: false,
            standalone_label: None,
            },
            RendererDef {
                name: "search_results".into(),
                description: "Search output".into(),
                scope: "tool".into(),
                tools: vec!["search_codebase".into()],
                data_hint: Some("Pass search results".into()),
                rule: Some("Use for search output.".into()),
                display_mode: None,
                invoke_schema: None,
                url_patterns: vec![],
            standalone: false,
            standalone_label: None,
            },
        ];
        let rules = collect_builtin_rules(&renderers);
        // renderer_selection + bulk_action_review + org_switching + rich_content_usage, but NOT search_results
        assert_eq!(rules.len(), 4);
        assert!(rules.iter().any(|r| r["name"] == "rich_content_usage"));
        assert!(!rules.iter().any(|r| r["name"] == "search_results_usage"));
    }

    // ─── collect_plugin_rules tests ───

    #[test]
    fn test_collect_plugin_rules_unfiltered() {
        let renderers = vec![RendererDef {
            name: "search_results".into(),
            description: "Search output".into(),
            scope: "tool".into(),
            tools: vec!["search_codebase".into()],
            data_hint: Some("Pass search results".into()),
            rule: None,
            display_mode: None,
            invoke_schema: None,
            url_patterns: vec![],
            standalone: false,
            standalone_label: None,
        }];
        let mut tool_rules = std::collections::HashMap::new();
        tool_rules.insert("search_codebase".to_string(), "Use search for queries.".to_string());
        let manifest = make_manifest(
            "test-plugin",
            vec![],
            tool_rules,
            Some(PluginMcpConfig {
                url: "http://localhost:8080".into(),
                auth: None,
                tool_prefix: "tp".into(),
            }),
        );
        let rules = collect_plugin_rules(&renderers, &manifest, None, None);
        // search_results renderer + search_codebase tool rule
        assert_eq!(rules.len(), 2);
    }

    #[test]
    fn test_collect_plugin_rules_filtered_by_renderer() {
        let renderers = vec![
            RendererDef {
                name: "search_results".into(),
                description: "Search".into(),
                scope: "tool".into(),
                tools: vec!["search_codebase".into()],
                data_hint: None,
                rule: None,
                display_mode: None,
                invoke_schema: None,
                url_patterns: vec![],
            standalone: false,
            standalone_label: None,
            },
            RendererDef {
                name: "code_units".into(),
                description: "Code".into(),
                scope: "tool".into(),
                tools: vec!["get_code_units".into()],
                data_hint: None,
                rule: None,
                display_mode: None,
                invoke_schema: None,
                url_patterns: vec![],
            standalone: false,
            standalone_label: None,
            },
        ];
        let manifest = make_manifest("test-plugin", vec![], std::collections::HashMap::new(), None);
        let renderer_filter = vec!["search_results".to_string()];
        let rules = collect_plugin_rules(&renderers, &manifest, None, Some(&renderer_filter));
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0]["renderer"], "search_results");
    }

    #[test]
    fn test_collect_plugin_rules_skips_universal() {
        let renderers = vec![RendererDef {
            name: "rich_content".into(),
            description: "Universal".into(),
            scope: "universal".into(),
            tools: vec![],
            data_hint: None,
            rule: Some("Use for prose.".into()),
            display_mode: None,
            invoke_schema: None,
            url_patterns: vec![],
            standalone: false,
            standalone_label: None,
        }];
        let manifest = make_manifest("test-plugin", vec![], std::collections::HashMap::new(), None);
        let rules = collect_plugin_rules(&renderers, &manifest, None, None);
        assert!(rules.is_empty());
    }

    // ─── auto_derive_registry_index tests ───

    #[test]
    fn test_auto_derive_registry_index_basic() {
        let mut renderers_map = std::collections::HashMap::new();
        renderers_map.insert("search_codebase".to_string(), "search_results".to_string());
        renderers_map.insert("get_code_units".to_string(), "code_units".to_string());
        let manifest = make_manifest_with_renderers("test-plugin", renderers_map, "tp__");
        let index = auto_derive_registry_index(&manifest, None);
        assert_eq!(index.summary, "test-plugin plugin");
        assert_eq!(index.tool_groups.len(), 2);
        assert!(index.renderer_names.contains(&"search_results".to_string()));
        assert!(index.renderer_names.contains(&"code_units".to_string()));
    }

    #[test]
    fn test_auto_derive_registry_index_with_cache() {
        let mut renderers_map = std::collections::HashMap::new();
        renderers_map.insert("search_codebase".to_string(), "search_results".to_string());
        let manifest = make_manifest_with_renderers("test-plugin", renderers_map, "tp__");
        let cached_tools = vec![serde_json::json!({
            "name": "tp__search_codebase",
            "description": "Search the codebase for matching code snippets"
        })];
        let index = auto_derive_registry_index(&manifest, Some(&cached_tools));
        let group = index.tool_groups.iter().find(|g| g.tools.contains(&"search_codebase".to_string())).unwrap();
        assert!(group.hint.contains("Search the codebase"));
    }

    // ─── build_data_description tests ───

    #[test]
    fn test_build_data_description_only_universal() {
        let renderers = vec![
            RendererDef {
                name: "rich_content".into(),
                description: "Universal".into(),
                scope: "universal".into(),
                tools: vec![],
                data_hint: Some("{ title, body }".into()),
                rule: None,
                display_mode: None,
                invoke_schema: None,
                url_patterns: vec![],
            standalone: false,
            standalone_label: None,
            },
            RendererDef {
                name: "search_results".into(),
                description: "Search".into(),
                scope: "tool".into(),
                tools: vec![],
                data_hint: Some("{ results: [...] }".into()),
                rule: None,
                display_mode: None,
                invoke_schema: None,
                url_patterns: vec![],
            standalone: false,
            standalone_label: None,
            },
        ];
        let desc = build_data_description(&renderers, "Payload.");
        assert!(desc.contains("rich_content"));
        assert!(!desc.contains("search_results"));
        assert!(desc.contains("get_plugin_docs"));
    }

    // ─── collect_plugin_updates tests ───

    #[test]
    fn test_collect_plugin_updates_no_updates() {
        let manifest = make_manifest("test-plugin", vec![], std::collections::HashMap::new(), None);
        let entry = mcpviews_shared::RegistryEntry {
            name: "test-plugin".to_string(),
            version: "1.0.0".to_string(),
            description: "Test".to_string(),
            author: None,
            homepage: None,
            manifest: manifest.clone(),
            tags: vec![],
            download_url: None,
            manifest_url: None,
        };
        let updates = collect_plugin_updates(&[manifest], &[entry]);
        assert!(updates.is_empty());
    }

    #[test]
    fn test_collect_plugin_updates_has_update() {
        let manifest = make_manifest("test-plugin", vec![], std::collections::HashMap::new(), None);
        let mut entry_manifest = manifest.clone();
        entry_manifest.version = "2.0.0".to_string();
        let entry = mcpviews_shared::RegistryEntry {
            name: "test-plugin".to_string(),
            version: "2.0.0".to_string(),
            description: "Test".to_string(),
            author: None,
            homepage: None,
            manifest: entry_manifest,
            tags: vec![],
            download_url: None,
            manifest_url: None,
        };
        let updates = collect_plugin_updates(&[manifest], &[entry]);
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0]["name"], "test-plugin");
        assert_eq!(updates[0]["installed_version"], "1.0.0");
        assert_eq!(updates[0]["available_version"], "2.0.0");
    }

    #[test]
    fn test_collect_plugin_updates_older_registry_ignored() {
        let mut manifest = make_manifest("test-plugin", vec![], std::collections::HashMap::new(), None);
        manifest.version = "3.0.0".to_string();
        let entry = mcpviews_shared::RegistryEntry {
            name: "test-plugin".to_string(),
            version: "2.0.0".to_string(),
            description: "Test".to_string(),
            author: None,
            homepage: None,
            manifest: make_manifest("test-plugin", vec![], std::collections::HashMap::new(), None),
            tags: vec![],
            download_url: None,
            manifest_url: None,
        };
        let updates = collect_plugin_updates(&[manifest], &[entry]);
        assert!(updates.is_empty());
    }

    #[test]
    fn test_collect_plugin_updates_no_matching_entry() {
        let manifest = make_manifest("test-plugin", vec![], std::collections::HashMap::new(), None);
        let updates = collect_plugin_updates(&[manifest], &[]);
        assert!(updates.is_empty());
    }

    // ─── update_plugins tool definition test ───

    #[test]
    fn test_update_plugins_tool_defined() {
        let renderers = builtin_renderer_definitions();
        let tools = builtin_tool_definitions(&renderers);
        let update_tool = tools.iter().find(|t| t["name"] == "update_plugins");
        assert!(update_tool.is_some(), "update_plugins tool should be defined");
        let schema = &update_tool.unwrap()["inputSchema"];
        assert!(schema["properties"]["plugin_name"].is_object());
    }

    // ─── M-028: tool definition tests ───

    #[test]
    fn test_list_registry_tool_defined() {
        let tools = builtin_tool_definitions(&[]);
        let tool = tools.iter().find(|t| t["name"] == "list_registry");
        assert!(tool.is_some(), "list_registry tool should be defined");
    }

    #[test]
    fn test_start_plugin_auth_tool_defined() {
        let tools = builtin_tool_definitions(&[]);
        let tool = tools.iter().find(|t| t["name"] == "start_plugin_auth");
        assert!(tool.is_some(), "start_plugin_auth tool should be defined");
        let schema = &tool.unwrap()["inputSchema"];
        let required = schema["required"].as_array().unwrap();
        assert!(required.iter().any(|r| r == "plugin_name"));
    }

    #[test]
    fn test_get_plugin_prompt_tool_defined() {
        let tools = builtin_tool_definitions(&[]);
        let tool = tools.iter().find(|t| t["name"] == "get_plugin_prompt");
        assert!(tool.is_some(), "get_plugin_prompt tool should be defined");
    }

    #[test]
    fn test_normalize_data_param_object_passthrough() {
        let obj = serde_json::json!({"key": "value"});
        assert_eq!(normalize_data_param(&obj), obj);
    }

    #[test]
    fn test_normalize_data_param_valid_json_string() {
        let s = serde_json::json!("{\"key\": \"value\"}");
        let result = normalize_data_param(&s);
        assert_eq!(result, serde_json::json!({"key": "value"}));
    }

    #[test]
    fn test_normalize_data_param_invalid_json_string() {
        let s = serde_json::json!("not json at all");
        let result = normalize_data_param(&s);
        assert_eq!(result, serde_json::json!("not json at all"));
    }

    // ─── trigger_auth schema tests ───

    #[test]
    fn test_install_plugin_schema_has_trigger_auth() {
        let tools = builtin_tool_definitions(&[]);
        let install_tool = tools
            .iter()
            .find(|t| t["name"] == "mcpviews_install_plugin")
            .expect("mcpviews_install_plugin tool should exist");
        let trigger_auth = &install_tool["inputSchema"]["properties"]["trigger_auth"];
        assert_eq!(
            trigger_auth["type"], "boolean",
            "trigger_auth should be boolean type"
        );
        assert!(
            trigger_auth["description"]
                .as_str()
                .unwrap()
                .contains("OAuth"),
            "trigger_auth description should mention OAuth"
        );
    }

    #[test]
    fn test_update_plugins_schema_has_trigger_auth() {
        let tools = builtin_tool_definitions(&[]);
        let update_tool = tools
            .iter()
            .find(|t| t["name"] == "update_plugins")
            .expect("update_plugins tool should exist");
        let trigger_auth = &update_tool["inputSchema"]["properties"]["trigger_auth"];
        assert_eq!(
            trigger_auth["type"], "boolean",
            "trigger_auth should be boolean type"
        );
        assert!(
            trigger_auth["description"]
                .as_str()
                .unwrap()
                .contains("OAuth"),
            "trigger_auth description should mention OAuth"
        );
    }

    // ─── install auth_status tests ───

    #[test]
    fn test_collect_auth_status_for_plugin_with_auth() {
        let manifest = make_manifest(
            "auth-plugin",
            vec![],
            std::collections::HashMap::new(),
            Some(PluginMcpConfig {
                url: "http://localhost:8080".into(),
                auth: Some(PluginAuth::OAuth {
                    client_id: Some("client123".into()),
                    auth_url: "https://example.com/auth".into(),
                    token_url: "https://example.com/token".into(),
                    scopes: vec![],
                }),
                tool_prefix: "ap".into(),
            }),
        );
        let status = collect_plugin_auth_status(&[manifest]);
        assert_eq!(status.len(), 1);
        assert_eq!(status[0]["plugin"], "auth-plugin");
        assert_eq!(status[0]["auth_type"], "oauth");
    }

    #[test]
    fn test_collect_auth_status_for_plugin_without_auth() {
        let manifest = make_manifest(
            "no-auth-plugin",
            vec![],
            std::collections::HashMap::new(),
            Some(PluginMcpConfig {
                url: "http://localhost:8080".into(),
                auth: None,
                tool_prefix: "na".into(),
            }),
        );
        let status = collect_plugin_auth_status(&[manifest]);
        assert!(
            status.is_empty(),
            "Plugin without auth should produce no auth_status entries"
        );
    }

    #[test]
    fn test_collect_auth_status_for_plugin_without_mcp() {
        let manifest = make_manifest(
            "no-mcp-plugin",
            vec![],
            std::collections::HashMap::new(),
            None,
        );
        let status = collect_plugin_auth_status(&[manifest]);
        assert!(
            status.is_empty(),
            "Plugin without MCP config should produce no auth_status entries"
        );
    }

    #[test]
    fn test_trigger_auth_defaults_to_false() {
        // Verify the default extraction logic used in call_install_plugin
        let args = serde_json::json!({});
        let trigger_auth = args
            .get("trigger_auth")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        assert!(!trigger_auth, "trigger_auth should default to false");
    }

    #[test]
    fn test_trigger_auth_reads_true() {
        let args = serde_json::json!({"trigger_auth": true});
        let trigger_auth = args
            .get("trigger_auth")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        assert!(trigger_auth, "trigger_auth should be true when set");
    }

    #[test]
    fn test_trigger_auth_reads_false_explicitly() {
        let args = serde_json::json!({"trigger_auth": false});
        let trigger_auth = args
            .get("trigger_auth")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        assert!(!trigger_auth, "trigger_auth false should remain false");
    }

    // ─── evaluate_update_preferences tests ───

    #[test]
    fn test_evaluate_update_preferences_no_updates() {
        let store = mcpviews_shared::plugin_store::PluginStore::with_dir(
            tempfile::tempdir().unwrap().into_path(),
        );
        let result = evaluate_update_preferences(&[], &store);
        assert!(result["auto_update"].as_array().unwrap().is_empty());
        assert!(result["ask_user"].as_array().unwrap().is_empty());
    }

    #[test]
    fn test_evaluate_update_preferences_default_ask() {
        let dir = tempfile::tempdir().unwrap();
        let store = mcpviews_shared::plugin_store::PluginStore::with_dir(dir.path().to_path_buf());
        // No preferences saved => default "ask" policy
        let updates = vec![serde_json::json!({
            "name": "test-plugin",
            "installed_version": "1.0.0",
            "available_version": "2.0.0",
        })];
        let result = evaluate_update_preferences(&updates, &store);
        assert!(result["auto_update"].as_array().unwrap().is_empty());
        let ask = result["ask_user"].as_array().unwrap();
        assert_eq!(ask.len(), 1);
        assert_eq!(ask[0]["name"], "test-plugin");
        assert_eq!(ask[0]["from"], "1.0.0");
        assert_eq!(ask[0]["to"], "2.0.0");
    }

    #[test]
    fn test_evaluate_update_preferences_always_auto_updates() {
        let dir = tempfile::tempdir().unwrap();
        let store = mcpviews_shared::plugin_store::PluginStore::with_dir(dir.path().to_path_buf());
        store.save_preferences("auto-plugin", &mcpviews_shared::PluginPreferences {
            update_policy: "always".to_string(),
            update_policy_version: None,
            update_policy_source: "chat".to_string(),
        }).unwrap();
        let updates = vec![serde_json::json!({
            "name": "auto-plugin",
            "installed_version": "1.0.0",
            "available_version": "2.0.0",
        })];
        let result = evaluate_update_preferences(&updates, &store);
        let auto = result["auto_update"].as_array().unwrap();
        assert_eq!(auto.len(), 1);
        assert_eq!(auto[0]["name"], "auto-plugin");
        assert!(result["ask_user"].as_array().unwrap().is_empty());
    }

    #[test]
    fn test_evaluate_update_preferences_skip_matching_version() {
        let dir = tempfile::tempdir().unwrap();
        let store = mcpviews_shared::plugin_store::PluginStore::with_dir(dir.path().to_path_buf());
        store.save_preferences("skip-plugin", &mcpviews_shared::PluginPreferences {
            update_policy: "skip".to_string(),
            update_policy_version: Some("2.0.0".to_string()),
            update_policy_source: "chat".to_string(),
        }).unwrap();
        let updates = vec![serde_json::json!({
            "name": "skip-plugin",
            "installed_version": "1.0.0",
            "available_version": "2.0.0",
        })];
        let result = evaluate_update_preferences(&updates, &store);
        // Skipped version matches => excluded from both lists
        assert!(result["auto_update"].as_array().unwrap().is_empty());
        assert!(result["ask_user"].as_array().unwrap().is_empty());
    }

    #[test]
    fn test_evaluate_update_preferences_skip_different_version_reasks() {
        let dir = tempfile::tempdir().unwrap();
        let store = mcpviews_shared::plugin_store::PluginStore::with_dir(dir.path().to_path_buf());
        store.save_preferences("skip-plugin", &mcpviews_shared::PluginPreferences {
            update_policy: "skip".to_string(),
            update_policy_version: Some("2.0.0".to_string()),
            update_policy_source: "chat".to_string(),
        }).unwrap();
        let updates = vec![serde_json::json!({
            "name": "skip-plugin",
            "installed_version": "1.0.0",
            "available_version": "3.0.0",
        })];
        let result = evaluate_update_preferences(&updates, &store);
        // New version (3.0.0) doesn't match skipped version (2.0.0) => re-ask
        assert!(result["auto_update"].as_array().unwrap().is_empty());
        let ask = result["ask_user"].as_array().unwrap();
        assert_eq!(ask.len(), 1);
        assert_eq!(ask[0]["name"], "skip-plugin");
    }

    #[test]
    fn test_evaluate_update_preferences_mixed_policies() {
        let dir = tempfile::tempdir().unwrap();
        let store = mcpviews_shared::plugin_store::PluginStore::with_dir(dir.path().to_path_buf());
        store.save_preferences("always-plugin", &mcpviews_shared::PluginPreferences {
            update_policy: "always".to_string(),
            update_policy_version: None,
            update_policy_source: "chat".to_string(),
        }).unwrap();
        store.save_preferences("skip-plugin", &mcpviews_shared::PluginPreferences {
            update_policy: "skip".to_string(),
            update_policy_version: Some("2.0.0".to_string()),
            update_policy_source: "chat".to_string(),
        }).unwrap();
        // "ask-plugin" has no saved preferences => default "ask"
        let updates = vec![
            serde_json::json!({"name": "always-plugin", "installed_version": "1.0.0", "available_version": "2.0.0"}),
            serde_json::json!({"name": "skip-plugin", "installed_version": "1.0.0", "available_version": "2.0.0"}),
            serde_json::json!({"name": "ask-plugin", "installed_version": "1.0.0", "available_version": "2.0.0"}),
        ];
        let result = evaluate_update_preferences(&updates, &store);
        let auto = result["auto_update"].as_array().unwrap();
        assert_eq!(auto.len(), 1);
        assert_eq!(auto[0]["name"], "always-plugin");
        let ask = result["ask_user"].as_array().unwrap();
        assert_eq!(ask.len(), 1);
        assert_eq!(ask[0]["name"], "ask-plugin");
    }

    // ─── extract_push_params tests ───

    #[test]
    fn test_extract_push_params_all_fields() {
        let args = serde_json::json!({
            "tool_name": "rich_content",
            "data": {"title": "Hello"},
            "meta": {"key": "val"},
            "timeout": 60
        });
        let params = extract_push_params(&args, true).unwrap();
        assert_eq!(params.tool_name, "rich_content");
        assert_eq!(params.data, serde_json::json!({"title": "Hello"}));
        assert_eq!(params.meta, Some(serde_json::json!({"key": "val"})));
        assert_eq!(params.timeout, 60);
    }

    #[test]
    fn test_extract_push_params_review_default_timeout() {
        let args = serde_json::json!({
            "tool_name": "structured_data",
            "data": {"tables": []}
        });
        let params = extract_push_params(&args, true).unwrap();
        assert_eq!(params.timeout, 120);
        assert!(params.meta.is_none());
    }

    #[test]
    fn test_extract_push_params_non_review_ignores_timeout() {
        let args = serde_json::json!({
            "tool_name": "rich_content",
            "data": {"body": "text"},
            "timeout": 999
        });
        let params = extract_push_params(&args, false).unwrap();
        // Non-review always uses 120 regardless of what's in arguments
        assert_eq!(params.timeout, 120);
    }

    #[test]
    fn test_extract_push_params_missing_tool_name() {
        let args = serde_json::json!({
            "data": {"plain": true}
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("tool_name"));
    }

    #[test]
    fn test_extract_push_params_missing_data() {
        let args = serde_json::json!({
            "tool_name": "rich_content"
        });
        let err = extract_push_params(&args, true).unwrap_err();
        assert!(err.contains("data"));
    }

    #[test]
    fn test_extract_push_params_wraps_top_level_rich_content_fields_into_data() {
        let args = serde_json::json!({
            "tool_name": "rich_content",
            "title": "Example Architecture Document",
            "body": "# Overview"
        });
        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.tool_name, "rich_content");
        assert_eq!(
            params.data,
            serde_json::json!({
                "title": "Example Architecture Document",
                "body": "# Overview"
            })
        );
    }

    #[test]
    fn test_extract_push_params_infers_data_and_tool_name_from_top_level_renderer_payload() {
        let args = serde_json::json!({
            "title": "Web App Architecture",
            "body": "```mermaid\ngraph TD\n  A[Browser] --> B[API]\n```"
        });
        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.tool_name, "rich_content");
        assert_eq!(
            params.data,
            serde_json::json!({
                "title": "Web App Architecture",
                "body": "```mermaid\ngraph TD\n  A[Browser] --> B[API]\n```"
            })
        );
    }

    #[test]
    fn test_extract_push_params_infers_structured_data_from_top_level_tables_payload() {
        let args = serde_json::json!({
            "tables": [{
                "id": "t1",
                "name": "Rows",
                "columns": [{ "id": "status", "name": "Status" }],
                "rows": [{ "id": "r1", "cells": { "status": { "value": "Ready" } }, "children": [] }]
            }]
        });
        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.tool_name, "structured_data");
        assert_eq!(
            params.data,
            serde_json::json!({
                "tables": [{
                    "id": "t1",
                    "name": "Rows",
                    "columns": [{ "id": "status", "name": "Status" }],
                    "rows": [{ "id": "r1", "cells": { "status": { "value": "Ready" } }, "children": [] }]
                }]
            })
        );
    }

    #[test]
    fn test_extract_push_params_string_data_normalized() {
        let args = serde_json::json!({
            "tool_name": "rich_content",
            "data": r#"{"title":"parsed"}"#
        });
        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.data, serde_json::json!({"title": "parsed"}));
    }

    #[test]
    fn test_extract_push_params_infers_rich_content_when_tool_name_is_missing() {
        let args = serde_json::json!({
            "data": {
                "title": "Web App Architecture",
                "body": "# Overview"
            }
        });
        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.tool_name, "rich_content");
    }

    #[test]
    fn test_extract_push_params_infers_structured_data_when_tool_name_is_missing() {
        let args = serde_json::json!({
            "data": {
                "tables": [{
                    "id": "t1",
                    "name": "Rows",
                    "columns": [{ "id": "status", "name": "Status" }],
                    "rows": [{ "id": "r1", "cells": { "status": { "value": "Ready" } }, "children": [] }]
                }]
            }
        });
        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.tool_name, "structured_data");
    }

    #[test]
    fn test_extract_push_params_rejects_invalid_mermaid_blocks() {
        let args = serde_json::json!({
            "tool_name": "rich_content",
            "data": {
                "title": "Broken Mermaid",
                "body": "mermaid\nflowchart TD\n  A[Start] --> B[End]"
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("Mermaid"));
        assert!(err.contains("```mermaid"));
    }

    #[test]
    fn test_extract_push_params_rejects_missing_embedded_structured_data_tables() {
        let args = serde_json::json!({
            "tool_name": "rich_content",
            "data": {
                "title": "Missing table",
                "body": "Context\n\n```structured_data:t1\n```"
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("t1"));
        assert!(err.contains("data.tables"));
    }

    #[test]
    fn test_extract_push_params_accepts_valid_rich_content_renderer_payload() {
        let args = serde_json::json!({
            "tool_name": "rich_content",
            "data": {
                "title": "Architecture",
                "body": "```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```\n\n```structured_data:t1\n```",
                "tables": [{
                    "id": "t1",
                    "name": "Changes",
                    "columns": [{ "id": "status", "name": "Status" }],
                    "rows": [{ "id": "r1", "cells": { "status": { "value": "Ready" } }, "children": [] }]
                }]
            }
        });
        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.tool_name, "rich_content");
    }

    #[test]
    fn test_validate_direct_renderer_payload_ignores_reserved_meta_fields() {
        let mut args = serde_json::json!({
            "title": "Architecture",
            "body": "```mermaid\nflowchart TD\n  A[Browser] --> B[API]\n```",
            "meta": {
                "threadId": "thread-1",
                "artifactSource": "tribex-ai-thread-result",
                "drawerOnly": true
            },
            "toolArgs": {
                "threadId": "thread-1"
            }
        });

        if let Some(object) = args.as_object_mut() {
            object.remove("meta");
            object.remove("toolArgs");
        }

        validate_push_payload("rich_content", &args).unwrap();
    }

    #[test]
    fn test_extract_push_params_rejects_invalid_structured_data_tables() {
        let args = serde_json::json!({
            "tool_name": "structured_data",
            "data": {
                "tables": [{
                    "id": "t1",
                    "columns": [{ "id": "status" }],
                    "rows": []
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("columns[0].name"));
    }
}
