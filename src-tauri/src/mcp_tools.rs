use mcpviews_shared::RendererDef;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::AsyncAppState;
use crate::plugin::PluginRegistry;
use crate::state::{CURRENT_PERSONA_STUDIO_PLUGIN, LEGACY_PERSONA_STUDIO_PLUGIN};

mod builtin_registry;
mod discovery;
mod lifecycle;
mod plugin_proxy;
mod presentation;
mod session;

const RULES_VERSION: &str = "18"; // Bump when built-in rules change
const RULES_REFRESH_INSTRUCTION: &str = "If an MCPViews rules file, section, or memory already exists, update that existing MCPViews entry instead of appending a duplicate: replace it when the version marker is missing or different, and also refresh it when installed or updated plugins add rule details that are missing from the persisted rules. If `mcpviews_setup` returns `setup_questions`, ask the user those questions during setup and persist only the selected option's compact `persisted_rule`, using `persist_as_rule_name` when present.";

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

fn is_plugin_auth_http_error(error: &str) -> bool {
    error.contains("HTTP 401") || error.contains("HTTP 403")
}

async fn open_plugin_email_auth_for_failure(
    info: &crate::plugin::PluginToolResult,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let organization_id = info
        .oauth_info
        .as_ref()
        .and_then(|oauth| oauth.org_id.as_deref());
    let session_id = crate::mcp_registry_tools::open_plugin_email_code_session(
        &info.plugin_name,
        organization_id,
        state,
    )
    .await?;

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": format!(
                "Plugin '{}' needs authentication or a refreshed organization token. Opened email-code authentication in MCPViews session '{}'.",
                info.plugin_name,
                session_id
            )
        }]
    }))
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
                Err(e) if is_plugin_auth_http_error(&e) => {
                    if e.contains("HTTP 401") {
                        if let Some(ref oauth) = info.oauth_info {
                            if let Some(new_header) =
                                crate::plugin::force_refresh_oauth(oauth, &client).await
                            {
                                let retry_result = plugin_proxy::proxy_plugin_tool_call(
                                    &client,
                                    &info.mcp_url,
                                    Some(&new_header),
                                    &info.unprefixed_name,
                                    &arguments,
                                )
                                .await;
                                match retry_result {
                                    Ok(mut retry) => {
                                        if info.unprefixed_name == "list_organizations" {
                                            plugin_proxy::enrich_list_organizations(
                                                &mut retry,
                                                &info.plugin_name,
                                            );
                                        }
                                        return Ok(retry);
                                    }
                                    Err(retry_error)
                                        if is_plugin_auth_http_error(&retry_error)
                                            && info.supports_email_code_auth =>
                                    {
                                        return open_plugin_email_auth_for_failure(&info, state)
                                            .await;
                                    }
                                    Err(retry_error) => return Err(retry_error),
                                }
                            }
                        }
                    }
                    if info.supports_email_code_auth {
                        return open_plugin_email_auth_for_failure(&info, state).await;
                    }
                    Err(e)
                }
                Err(e) => Err(e),
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
        || object.contains_key("suggestions")
        || object.contains_key("citations")
    {
        return Some("rich_content");
    }

    if object.contains_key("graphs") {
        return Some("universal_graph");
    }

    if object.contains_key("tables") {
        return Some("structured_data");
    }

    if object.contains_key("title") {
        return Some("rich_content");
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

const UNIVERSAL_GRAPH_TYPES: &[&str] = &[
    "line",
    "area",
    "bar",
    "stacked_bar",
    "grouped_bar",
    "scatter",
    "bubble",
    "combo",
    "histogram",
    "boxplot",
    "heatmap",
    "matrix",
    "pie",
    "donut",
    "waterfall",
    "funnel",
    "gauge",
    "radar",
    "candlestick",
    "timeline",
    "gantt",
    "tree",
    "network",
    "treemap",
    "sunburst",
    "sankey",
];

const DATA_REF_RECIPES: &[&str] = &[
    "select_rows",
    "selectRows",
    "review_rows",
    "reviewRows",
    "count_by",
    "countBy",
    "group_sum",
    "groupSum",
    "trend",
    "heatmap_by_pair",
    "heatmapByPair",
    "funnel_from_counts",
    "funnelFromCounts",
    "waterfall_from_deltas",
    "waterfallFromDeltas",
];
const INLINE_RENDERER_ROW_WARNING_THRESHOLD: usize = 200;

#[derive(Debug, Clone)]
enum RichContentFenceKind {
    Mermaid,
    StructuredData(String),
    UniversalGraph(String),
}

#[derive(Debug, Clone)]
struct RichContentFence {
    kind: RichContentFenceKind,
    start_line: usize,
    lines: Vec<String>,
}

pub(crate) fn validate_push_payload(tool_name: &str, data: &Value) -> Result<(), String> {
    match tool_name {
        "rich_content" => validate_rich_content_payload(data),
        "structured_data" => validate_structured_data_payload(data),
        "universal_graph" => validate_universal_graph_payload(data),
        _ => Ok(()),
    }
}

pub(crate) fn collect_efficiency_warnings(tool_name: &str, data: &Value) -> Vec<String> {
    match tool_name {
        "rich_content" => {
            let table_rows = inline_table_row_count(data);
            let graph_rows = inline_graph_row_count(data);
            inline_row_warnings(table_rows, graph_rows)
        }
        "structured_data" => inline_row_warnings(inline_table_row_count(data), 0),
        "universal_graph" => inline_row_warnings(0, inline_graph_row_count(data)),
        _ => Vec::new(),
    }
}

fn inline_row_warnings(table_rows: usize, graph_rows: usize) -> Vec<String> {
    let mut warnings = Vec::new();
    if table_rows > INLINE_RENDERER_ROW_WARNING_THRESHOLD {
        warnings.push(format!(
            "This renderer payload includes {} inline table rows. Call register_dataset once and use tables[].dataRef to reduce repeated model output tokens.",
            table_rows
        ));
    }
    if graph_rows > INLINE_RENDERER_ROW_WARNING_THRESHOLD {
        warnings.push(format!(
            "This renderer payload includes {} inline graph rows. Call register_dataset once and use graphs[].dataRef recipes to reduce repeated model output tokens.",
            graph_rows
        ));
    }
    warnings
}

fn inline_table_row_count(data: &Value) -> usize {
    data.as_object()
        .and_then(|object| object.get("tables"))
        .and_then(Value::as_array)
        .map(|tables| {
            tables
                .iter()
                .filter(|table| !table.as_object().is_some_and(has_data_ref))
                .map(|table| {
                    table
                        .get("rows")
                        .and_then(Value::as_array)
                        .map(|rows| count_table_rows(rows))
                        .unwrap_or(0)
                })
                .sum()
        })
        .unwrap_or(0)
}

fn count_table_rows(rows: &[Value]) -> usize {
    rows.iter()
        .map(|row| {
            1 + row
                .get("children")
                .and_then(Value::as_array)
                .map(|children| count_table_rows(children))
                .unwrap_or(0)
        })
        .sum()
}

fn inline_graph_row_count(data: &Value) -> usize {
    data.as_object()
        .and_then(|object| object.get("graphs"))
        .and_then(Value::as_array)
        .map(|graphs| {
            graphs
                .iter()
                .filter(|graph| !graph.as_object().is_some_and(has_data_ref))
                .map(|graph| {
                    graph
                        .get("data")
                        .and_then(|value| value.get("rows"))
                        .and_then(Value::as_array)
                        .map(Vec::len)
                        .unwrap_or(0)
                })
                .sum()
        })
        .unwrap_or(0)
}

fn validate_rich_content_payload(data: &Value) -> Result<(), String> {
    let object = data
        .as_object()
        .ok_or("rich_content data must be a JSON object.".to_string())?;
    let table_ids = match object.get("tables") {
        Some(tables) => validate_tables_value(tables, "rich_content.data.tables")?,
        None => Vec::new(),
    };
    let graph_ids = match object.get("graphs") {
        Some(graphs) => validate_graphs_value(graphs, "rich_content.data.graphs")?,
        None => Vec::new(),
    };

    if let Some(body) = object.get("body") {
        let body = body
            .as_str()
            .ok_or("rich_content.data.body must be a string.".to_string())?;
        validate_rich_content_body(body, &table_ids, &graph_ids)?;
    }

    if let Some(template) = object
        .get("instructionTemplate")
        .or_else(|| object.get("instruction_template"))
    {
        validate_instruction_template(template, "rich_content.data.instructionTemplate")?;
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
    if let Some(template) = object
        .get("instructionTemplate")
        .or_else(|| object.get("instruction_template"))
    {
        validate_instruction_template(template, "structured_data.data.instructionTemplate")?;
    }
    Ok(())
}

fn validate_universal_graph_payload(data: &Value) -> Result<(), String> {
    let object = data
        .as_object()
        .ok_or("universal_graph data must be a JSON object.".to_string())?;
    let graphs = object
        .get("graphs")
        .ok_or("universal_graph.data.graphs is required.".to_string())?;
    validate_graphs_value(graphs, "universal_graph.data.graphs")?;
    if let Some(template) = object
        .get("instructionTemplate")
        .or_else(|| object.get("instruction_template"))
    {
        validate_instruction_template(template, "universal_graph.data.instructionTemplate")?;
    }
    Ok(())
}

fn has_data_ref(object: &serde_json::Map<String, Value>) -> bool {
    object
        .get("dataRef")
        .or_else(|| object.get("data_ref"))
        .is_some()
}

fn validate_data_ref(value: &Value, context: &str) -> Result<(), String> {
    let data_ref = value
        .as_object()
        .ok_or(format!("{} must be an object.", context))?;
    data_ref
        .get("dataset_id")
        .or_else(|| data_ref.get("datasetId"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(format!("{} requires dataset_id.", context))?;
    data_ref
        .get("query_token")
        .or_else(|| data_ref.get("queryToken"))
        .or_else(|| data_ref.get("token"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(format!(
            "{} requires query_token from register_dataset.",
            context
        ))?;

    if let Some(source_id) = data_ref
        .get("source_id")
        .or_else(|| data_ref.get("sourceId"))
    {
        source_id
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or(format!("{}.source_id must be a non-empty string.", context))?;
    }

    if let Some(recipe) = data_ref.get("recipe") {
        let recipe = recipe
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or(format!("{}.recipe must be a non-empty string.", context))?;
        if !DATA_REF_RECIPES
            .iter()
            .any(|candidate| candidate == &recipe)
        {
            return Err(format!(
                "{}.recipe `{}` is not supported. Supported recipes: {}.",
                context,
                recipe,
                DATA_REF_RECIPES.join(", ")
            ));
        }
    }

    if let Some(params) = data_ref.get("params") {
        params.as_object().ok_or(format!(
            "{}.params must be an object when provided.",
            context
        ))?;
    }

    Ok(())
}

fn validate_instruction_template(value: &Value, context: &str) -> Result<(), String> {
    let template = value
        .as_object()
        .ok_or(format!("{} must be an object.", context))?;
    template
        .get("id")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(format!("{}.id must be a non-empty string.", context))?;
    if let Some(variables) = template.get("variables") {
        variables.as_object().ok_or(format!(
            "{}.variables must be an object when provided.",
            context
        ))?;
    }
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
            return Err(format!(
                "{} contains duplicate table id `{}`.",
                context, table_id
            ));
        }

        if let Some(data_ref) = table.get("dataRef").or_else(|| table.get("data_ref")) {
            validate_data_ref(data_ref, &format!("{}.dataRef", table_context))?;
        }

        let uses_data_ref = has_data_ref(table);
        if let Some(columns_value) = table.get("columns") {
            let columns = columns_value
                .as_array()
                .ok_or(format!("{}.columns must be an array.", table_context))?;
            validate_table_columns(columns, &format!("{}.columns", table_context))?;
        } else if !uses_data_ref {
            return Err(format!("{}.columns must be an array.", table_context));
        }

        if let Some(rows_value) = table.get("rows") {
            let rows = rows_value
                .as_array()
                .ok_or(format!("{}.rows must be an array.", table_context))?;
            validate_table_rows(rows, &format!("{}.rows", table_context))?;
        } else if !uses_data_ref {
            return Err(format!("{}.rows must be an array.", table_context));
        }
        table_ids.push(table_id);
    }

    Ok(table_ids)
}

fn validate_table_columns(columns: &[Value], context: &str) -> Result<(), String> {
    for (column_index, column) in columns.iter().enumerate() {
        let column_context = format!("{}[{}]", context, column_index);
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
            .ok_or(format!(
                "{}.name must be a non-empty string.",
                column_context
            ))?;
    }
    Ok(())
}

fn validate_graphs_value(graphs: &Value, context: &str) -> Result<Vec<String>, String> {
    let graphs = graphs
        .as_array()
        .ok_or(format!("{} must be an array.", context))?;
    if graphs.is_empty() {
        return Err(format!("{} must contain at least one graph.", context));
    }

    let mut graph_ids = Vec::new();
    let mut graph_columns_by_id: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for (graph_index, graph) in graphs.iter().enumerate() {
        let graph_context = format!("{}[{}]", context, graph_index);
        let graph = graph
            .as_object()
            .ok_or(format!("{} must be an object.", graph_context))?;
        let graph_id = graph
            .get("id")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or(format!("{}.id must be a non-empty string.", graph_context))?
            .to_string();

        if graph_ids.iter().any(|existing| existing == &graph_id) {
            return Err(format!(
                "{} contains duplicate graph id `{}`.",
                context, graph_id
            ));
        }
        if let Some(data_ref) = graph.get("dataRef").or_else(|| graph.get("data_ref")) {
            validate_data_ref(data_ref, &format!("{}.dataRef", graph_context))?;
        }
        let uses_data_ref = has_data_ref(graph);
        let column_ids = if let Some(data) = graph.get("data").and_then(|value| value.as_object()) {
            validate_graph_columns(data, &format!("{}.data", graph_context))?
        } else if uses_data_ref {
            Vec::new()
        } else {
            return Err(format!("{}.data must be an object.", graph_context));
        };
        graph_columns_by_id.insert(graph_id.clone(), column_ids);
        graph_ids.push(graph_id);
    }

    for (graph_index, graph) in graphs.iter().enumerate() {
        let graph_context = format!("{}[{}]", context, graph_index);
        let graph = graph
            .as_object()
            .ok_or(format!("{} must be an object.", graph_context))?;
        let graph_id = graph
            .get("id")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or(format!("{}.id must be a non-empty string.", graph_context))?
            .to_string();
        validate_graph_role(graph.get("role"), &format!("{}.role", graph_context))?;

        let graph_type = graph
            .get("type")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or(format!(
                "{}.type must be a non-empty string.",
                graph_context
            ))?;
        if !UNIVERSAL_GRAPH_TYPES
            .iter()
            .any(|candidate| candidate == &graph_type)
        {
            return Err(format!(
                "{}.type `{}` is not supported. Supported universal_graph types: {}.",
                graph_context,
                graph_type,
                UNIVERSAL_GRAPH_TYPES.join(", ")
            ));
        }

        if let Some(data_ref) = graph.get("dataRef").or_else(|| graph.get("data_ref")) {
            validate_data_ref(data_ref, &format!("{}.dataRef", graph_context))?;
        }
        let uses_data_ref = has_data_ref(graph);
        let data = graph.get("data").and_then(|value| value.as_object());
        let column_ids = if let Some(data) = data {
            let column_ids = validate_graph_columns(data, &format!("{}.data", graph_context))?;
            validate_graph_rows(data, &format!("{}.data", graph_context))?;
            column_ids
        } else if uses_data_ref {
            Vec::new()
        } else {
            return Err(format!("{}.data must be an object.", graph_context));
        };

        let encoding = graph
            .get("encoding")
            .and_then(|value| value.as_object())
            .ok_or(format!("{}.encoding must be an object.", graph_context))?;
        validate_graph_required_encodings(
            graph_type,
            encoding,
            &format!("{}.encoding", graph_context),
        )?;
        if !column_ids.is_empty() {
            validate_graph_encoding_references(
                encoding,
                &column_ids,
                &format!("{}.encoding", graph_context),
            )?;
        }
        validate_graph_options(graph.get("options"), &format!("{}.options", graph_context))?;
        validate_graph_axes(graph.get("axes"), &format!("{}.axes", graph_context))?;
        if let Some(data) = data {
            validate_graph_required_row_values(
                &graph_id,
                graph_type,
                data,
                encoding,
                graph.get("options"),
                &graph_context,
            )?;
            validate_graph_interactions(
                graph.get("interactions"),
                data,
                &column_ids,
                &graph_ids,
                &graph_columns_by_id,
                &format!("{}.interactions", graph_context),
            )?;
        } else {
            validate_data_ref_graph_interactions(
                graph.get("interactions"),
                &graph_ids,
                &format!("{}.interactions", graph_context),
            )?;
        }
    }

    Ok(graph_ids)
}

fn validate_graph_role(role: Option<&Value>, context: &str) -> Result<(), String> {
    let Some(role) = role else {
        return Ok(());
    };
    let role = role
        .as_str()
        .map(str::trim)
        .ok_or(format!("{} must be either primary or drilldown.", context))?;
    if !matches!(role, "primary" | "drilldown") {
        return Err(format!(
            "{} `{}` is not supported. Use primary or drilldown.",
            context, role
        ));
    }
    Ok(())
}

fn validate_graph_options(options: Option<&Value>, context: &str) -> Result<(), String> {
    let Some(options) = options else {
        return Ok(());
    };
    let options = options
        .as_object()
        .ok_or(format!("{} must be an object when provided.", context))?;

    for key in ["xScale", "yScale"] {
        if let Some(value) = options.get(key) {
            let scale = value.as_str().map(str::trim).ok_or(format!(
                "{}.{} must be one of auto, category, linear, or time.",
                context, key
            ))?;
            if !matches!(scale, "auto" | "category" | "linear" | "time") {
                return Err(format!(
                    "{}.{} `{}` is not supported. Use auto, category, linear, or time.",
                    context, key, scale
                ));
            }
        }
    }

    if let Some(value) = options.get("maxVisibleItems") {
        let Some(max_visible) = value.as_u64() else {
            return Err(format!(
                "{}.maxVisibleItems must be a positive integer.",
                context
            ));
        };
        if max_visible == 0 {
            return Err(format!(
                "{}.maxVisibleItems must be greater than 0.",
                context
            ));
        }
    }

    if let Some(value) = options.get("showAll") {
        if !value.is_boolean() {
            return Err(format!("{}.showAll must be a boolean.", context));
        }
    }

    if let Some(value) = options.get("showTotal") {
        if !value.is_boolean() {
            return Err(format!("{}.showTotal must be a boolean.", context));
        }
    }

    if let Some(value) = options.get("totalLabel") {
        let Some(label) = value.as_str().map(str::trim) else {
            return Err(format!("{}.totalLabel must be a string.", context));
        };
        if label.is_empty() {
            return Err(format!("{}.totalLabel must not be empty.", context));
        }
    }

    if let Some(value) = options.get("otherBucket") {
        let mode = value.as_str().map(str::trim).ok_or(format!(
            "{}.otherBucket must be one of separate, inline, or hidden.",
            context
        ))?;
        if !matches!(mode, "separate" | "inline" | "hidden") {
            return Err(format!(
                "{}.otherBucket `{}` is not supported. Use separate, inline, or hidden.",
                context, mode
            ));
        }
    }

    if let Some(value) = options.get("binCount") {
        let Some(bin_count) = value.as_u64() else {
            return Err(format!("{}.binCount must be a positive integer.", context));
        };
        if bin_count == 0 {
            return Err(format!("{}.binCount must be greater than 0.", context));
        }
    }

    Ok(())
}

fn validate_graph_axes(axes: Option<&Value>, context: &str) -> Result<(), String> {
    let Some(axes) = axes else {
        return Ok(());
    };
    let axes = axes
        .as_object()
        .ok_or(format!("{} must be an object when provided.", context))?;

    for key in axes.keys() {
        if !matches!(key.as_str(), "x" | "y") {
            return Err(format!("{}.{} is not supported. Use x or y.", context, key));
        }
    }

    for key in ["x", "y"] {
        let Some(value) = axes.get(key) else {
            continue;
        };
        if value.as_str().is_some() {
            continue;
        }
        let axis = value.as_object().ok_or(format!(
            "{}.{} must be a string label or an object.",
            context, key
        ))?;
        for field in ["label", "description"] {
            if let Some(value) = axis.get(field) {
                value
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or(format!(
                        "{}.{}.{} must be a non-empty string.",
                        context, key, field
                    ))?;
            }
        }
    }

    Ok(())
}

fn validate_graph_interactions(
    interactions: Option<&Value>,
    data: &serde_json::Map<String, Value>,
    column_ids: &[String],
    graph_ids: &[String],
    graph_columns_by_id: &std::collections::HashMap<String, Vec<String>>,
    context: &str,
) -> Result<(), String> {
    let Some(interactions) = interactions else {
        return Ok(());
    };
    let interactions = interactions
        .as_object()
        .ok_or(format!("{} must be an object when provided.", context))?;

    if let Some(details) = interactions.get("details") {
        validate_graph_details(details, column_ids, &format!("{}.details", context))?;
    }

    if let Some(hover) = interactions.get("hover") {
        if let Some(value) = hover.as_str().map(str::trim) {
            if !matches!(value, "auto" | "none") {
                return Err(format!(
                    "{}.hover `{}` is not supported. Use auto or none.",
                    context, value
                ));
            }
        } else if !hover.is_object() && !hover.is_boolean() {
            return Err(format!(
                "{}.hover must be auto, none, a boolean, or an object.",
                context
            ));
        }
    }

    if let Some(drilldowns) = interactions.get("drilldowns") {
        let drilldowns = drilldowns
            .as_array()
            .ok_or(format!("{}.drilldowns must be an array.", context))?;
        for (index, drilldown) in drilldowns.iter().enumerate() {
            validate_graph_drilldown(
                drilldown,
                column_ids,
                graph_ids,
                graph_columns_by_id,
                &format!("{}.drilldowns[{}]", context, index),
            )?;
        }
    }

    if let Some(metric_controls) = interactions.get("metricControls") {
        validate_graph_metric_controls(
            metric_controls,
            data,
            column_ids,
            &format!("{}.metricControls", context),
        )?;
    }

    Ok(())
}

fn validate_data_ref_graph_interactions(
    interactions: Option<&Value>,
    graph_ids: &[String],
    context: &str,
) -> Result<(), String> {
    let Some(interactions) = interactions else {
        return Ok(());
    };
    let interactions = interactions
        .as_object()
        .ok_or(format!("{} must be an object when provided.", context))?;

    if let Some(hover) = interactions.get("hover") {
        if let Some(value) = hover.as_str().map(str::trim) {
            if !matches!(value, "auto" | "none") {
                return Err(format!(
                    "{}.hover `{}` is not supported. Use auto or none.",
                    context, value
                ));
            }
        } else if !hover.is_object() && !hover.is_boolean() {
            return Err(format!(
                "{}.hover must be auto, none, a boolean, or an object.",
                context
            ));
        }
    }

    if let Some(drilldowns) = interactions.get("drilldowns") {
        let drilldowns = drilldowns
            .as_array()
            .ok_or(format!("{}.drilldowns must be an array.", context))?;
        for (index, drilldown) in drilldowns.iter().enumerate() {
            let drilldown = drilldown.as_object().ok_or(format!(
                "{}.drilldowns[{}] must be an object.",
                context, index
            ))?;
            drilldown
                .get("id")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or(format!(
                    "{}.drilldowns[{}].id must be a non-empty string.",
                    context, index
                ))?;
            let target_graph_id = drilldown
                .get("targetGraphId")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or(format!(
                    "{}.drilldowns[{}].targetGraphId must be a non-empty string.",
                    context, index
                ))?;
            if !graph_ids
                .iter()
                .any(|candidate| candidate == target_graph_id)
            {
                return Err(format!(
                    "{}.drilldowns[{}].targetGraphId references missing graph `{}`.",
                    context, index, target_graph_id
                ));
            }
            drilldown
                .get("match")
                .and_then(|value| value.as_object())
                .ok_or(format!(
                    "{}.drilldowns[{}].match must be an object.",
                    context, index
                ))?;
        }
    }

    Ok(())
}

fn validate_graph_details(
    details: &Value,
    column_ids: &[String],
    context: &str,
) -> Result<(), String> {
    let details = details
        .as_object()
        .ok_or(format!("{} must be an object when provided.", context))?;
    if let Some(title_field) = details.get("titleField") {
        let field = title_field
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or(format!(
                "{}.titleField must be a non-empty string.",
                context
            ))?;
        if !column_ids.iter().any(|candidate| candidate == field) {
            return Err(format!(
                "{}.titleField references missing data column `{}`.",
                context, field
            ));
        }
    }
    if let Some(fields) = details.get("fields") {
        let fields = fields
            .as_array()
            .ok_or(format!("{}.fields must be an array.", context))?;
        for (index, field) in fields.iter().enumerate() {
            let field_name = if let Some(text) = field.as_str() {
                text.trim()
            } else {
                field
                    .as_object()
                    .and_then(|object| object.get("field"))
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .ok_or(format!(
                        "{}.fields[{}] must be a string or object with field.",
                        context, index
                    ))?
            };
            if field_name.is_empty() {
                return Err(format!(
                    "{}.fields[{}] must reference a non-empty field.",
                    context, index
                ));
            }
            if !column_ids.iter().any(|candidate| candidate == field_name) {
                return Err(format!(
                    "{}.fields[{}] references missing data column `{}`.",
                    context, index, field_name
                ));
            }
        }
    }
    Ok(())
}

fn validate_graph_drilldown(
    drilldown: &Value,
    column_ids: &[String],
    graph_ids: &[String],
    graph_columns_by_id: &std::collections::HashMap<String, Vec<String>>,
    context: &str,
) -> Result<(), String> {
    let drilldown = drilldown
        .as_object()
        .ok_or(format!("{} must be an object.", context))?;
    drilldown
        .get("id")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(format!("{}.id must be a non-empty string.", context))?;
    let target_graph_id = drilldown
        .get("targetGraphId")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(format!(
            "{}.targetGraphId must be a non-empty string.",
            context
        ))?;
    if !graph_ids
        .iter()
        .any(|candidate| candidate == target_graph_id)
    {
        return Err(format!(
            "{}.targetGraphId references missing graph `{}`.",
            context, target_graph_id
        ));
    }
    if let Some(trigger) = drilldown.get("trigger") {
        let trigger = trigger.as_str().map(str::trim).ok_or(format!(
            "{}.trigger must be one of mark, node, link, or legend.",
            context
        ))?;
        if !matches!(trigger, "mark" | "node" | "link" | "legend") {
            return Err(format!(
                "{}.trigger `{}` is not supported. Use mark, node, link, or legend.",
                context, trigger
            ));
        }
    }
    let match_object = drilldown
        .get("match")
        .and_then(|value| value.as_object())
        .ok_or(format!("{}.match must be an object.", context))?;
    let source = match_object
        .get("source")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(format!(
            "{}.match.source must be a non-empty string.",
            context
        ))?;
    if !matches!(source, "node.label" | "link.source" | "link.target")
        && !column_ids.iter().any(|candidate| candidate == source)
    {
        return Err(format!(
            "{}.match.source references missing data column or unsupported token `{}`.",
            context, source
        ));
    }
    let target_field = match_object
        .get("targetField")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(format!(
            "{}.match.targetField must be a non-empty string.",
            context
        ))?;
    let target_columns = graph_columns_by_id
        .get(target_graph_id)
        .cloned()
        .unwrap_or_default();
    if !target_columns
        .iter()
        .any(|candidate| candidate == target_field)
    {
        return Err(format!(
            "{}.match.targetField references missing target graph column `{}`.",
            context, target_field
        ));
    }
    Ok(())
}

fn validate_graph_metric_controls(
    metric_controls: &Value,
    data: &serde_json::Map<String, Value>,
    column_ids: &[String],
    context: &str,
) -> Result<(), String> {
    if metric_controls == &Value::Bool(true) {
        return Ok(());
    }
    let controls: Vec<&Value> = if let Some(array) = metric_controls.as_array() {
        array.iter().collect()
    } else {
        vec![metric_controls]
    };
    for (index, control) in controls.iter().enumerate() {
        let control_context = if metric_controls.is_array() {
            format!("{}[{}]", context, index)
        } else {
            context.to_string()
        };
        let control = control.as_object().ok_or(format!(
            "{} must be an object, array of objects, or true.",
            control_context
        ))?;
        if let Some(target) = control.get("target") {
            let target = target
                .as_str()
                .map(str::trim)
                .ok_or(format!("{}.target must be y or value.", control_context))?;
            if !matches!(target, "y" | "value") {
                return Err(format!(
                    "{}.target `{}` is not supported. Use y or value.",
                    control_context, target
                ));
            }
        }
        if let Some(fields) = control.get("fields") {
            let fields = fields
                .as_array()
                .ok_or(format!("{}.fields must be an array.", control_context))?;
            if fields.is_empty() {
                return Err(format!(
                    "{}.fields must include at least one field.",
                    control_context
                ));
            }
            for (field_index, field) in fields.iter().enumerate() {
                let field = field
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or(format!(
                        "{}.fields[{}] must be a non-empty string.",
                        control_context, field_index
                    ))?;
                if !column_ids.iter().any(|candidate| candidate == field) {
                    return Err(format!(
                        "{}.fields[{}] references missing data column `{}`.",
                        control_context, field_index, field
                    ));
                }
                if !is_numeric_graph_column(data, field) {
                    return Err(format!(
                        "{}.fields[{}] `{}` must reference a numeric field.",
                        control_context, field_index, field
                    ));
                }
            }
        }
    }
    Ok(())
}

fn is_numeric_graph_column(data: &serde_json::Map<String, Value>, field: &str) -> bool {
    data.get("rows")
        .and_then(|value| value.as_array())
        .map(|rows| {
            !rows.is_empty()
                && rows.iter().all(|row| {
                    row.as_object()
                        .and_then(|object| object.get(field))
                        .is_some_and(is_numeric_json_value)
                })
        })
        .unwrap_or(false)
}

fn validate_graph_required_row_values(
    graph_id: &str,
    graph_type: &str,
    data: &serde_json::Map<String, Value>,
    encoding: &serde_json::Map<String, Value>,
    options: Option<&Value>,
    context: &str,
) -> Result<(), String> {
    let rows = data
        .get("rows")
        .and_then(|value| value.as_array())
        .ok_or(format!("{}.data.rows must be an array.", context))?;
    let column_types = graph_column_types(data);
    let mut numeric_fields: Vec<String> = Vec::new();
    let mut time_fields: Vec<String> = Vec::new();
    let mut text_fields: Vec<String> = Vec::new();

    match graph_type {
        "line" | "area" | "bar" | "stacked_bar" | "grouped_bar" | "combo" => {
            extend_encoding_fields(&mut numeric_fields, encoding, "y");
            maybe_require_axis_field(
                &mut numeric_fields,
                &mut time_fields,
                encoding,
                options,
                &column_types,
                "x",
                false,
            );
        }
        "scatter" | "bubble" => {
            extend_encoding_fields(&mut numeric_fields, encoding, "y");
            maybe_require_axis_field(
                &mut numeric_fields,
                &mut time_fields,
                encoding,
                options,
                &column_types,
                "x",
                true,
            );
            extend_optional_numeric_field(&mut numeric_fields, encoding, "size");
        }
        "histogram" | "boxplot" => extend_encoding_fields(&mut numeric_fields, encoding, "value"),
        "heatmap" | "matrix" => extend_encoding_fields(&mut numeric_fields, encoding, "value"),
        "pie" | "donut" | "funnel" | "gauge" | "radar" | "waterfall" | "tree" | "treemap"
        | "sunburst" | "sankey" => {
            extend_encoding_fields(&mut numeric_fields, encoding, "value");
        }
        "candlestick" => {
            extend_encoding_fields(&mut numeric_fields, encoding, "open");
            extend_encoding_fields(&mut numeric_fields, encoding, "high");
            extend_encoding_fields(&mut numeric_fields, encoding, "low");
            extend_encoding_fields(&mut numeric_fields, encoding, "close");
            maybe_require_axis_field(
                &mut numeric_fields,
                &mut time_fields,
                encoding,
                options,
                &column_types,
                "x",
                true,
            );
        }
        "timeline" | "gantt" => {
            extend_encoding_fields(&mut time_fields, encoding, "start");
            extend_encoding_fields(&mut time_fields, encoding, "end");
        }
        _ => {}
    }
    match graph_type {
        "pie" | "donut" | "funnel" | "gauge" | "radar" | "waterfall" | "treemap" | "sunburst"
        | "tree" => {
            extend_encoding_fields(&mut text_fields, encoding, "label");
        }
        "timeline" | "gantt" => extend_encoding_fields(&mut text_fields, encoding, "label"),
        "network" | "sankey" => {
            extend_encoding_fields(&mut text_fields, encoding, "source");
            extend_encoding_fields(&mut text_fields, encoding, "target");
        }
        _ => {}
    }

    extend_optional_numeric_field(&mut numeric_fields, encoding, "min");
    extend_optional_numeric_field(&mut numeric_fields, encoding, "max");
    numeric_fields.sort();
    numeric_fields.dedup();
    time_fields.sort();
    time_fields.dedup();
    text_fields.sort();
    text_fields.dedup();

    for (row_index, row) in rows.iter().enumerate() {
        let Some(row) = row.as_object() else {
            continue;
        };
        for field in &text_fields {
            let value = row.get(field).ok_or(format!(
                "{}.data.rows[{}].{} is required and must be non-empty for universal_graph graph `{}` type `{}`.",
                context, row_index, field, graph_id, graph_type
            ))?;
            if !is_non_empty_json_value(value) {
                return Err(format!(
                    "{}.data.rows[{}].{} must be non-empty for universal_graph graph `{}` type `{}`.",
                    context, row_index, field, graph_id, graph_type
                ));
            }
        }
        for field in &numeric_fields {
            let value = row.get(field).ok_or(format!(
                "{}.data.rows[{}].{} is required and must be numeric for universal_graph graph `{}` type `{}`.",
                context, row_index, field, graph_id, graph_type
            ))?;
            if !is_numeric_json_value(value) {
                return Err(format!(
                    "{}.data.rows[{}].{} must be a finite number for universal_graph graph `{}` type `{}`.",
                    context, row_index, field, graph_id, graph_type
                ));
            }
        }
        for field in &time_fields {
            let value = row.get(field).ok_or(format!(
                "{}.data.rows[{}].{} is required and must be a parseable date/time for universal_graph graph `{}` type `{}`.",
                context, row_index, field, graph_id, graph_type
            ))?;
            if !is_time_json_value(value) {
                return Err(format!(
                    "{}.data.rows[{}].{} must be a parseable date/time for universal_graph graph `{}` type `{}`.",
                    context, row_index, field, graph_id, graph_type
                ));
            }
        }
        if matches!(graph_type, "timeline" | "gantt") {
            if let (Some(start_field), Some(end_field)) = (
                first_encoding_field(encoding, "start"),
                first_encoding_field(encoding, "end"),
            ) {
                if let (Some(start), Some(end)) = (
                    row.get(&start_field).and_then(json_time_millis),
                    row.get(&end_field).and_then(json_time_millis),
                ) {
                    if end < start {
                        return Err(format!(
                            "{}.data.rows[{}].{} must be greater than or equal to {} for universal_graph graph `{}` type `{}`.",
                            context, row_index, end_field, start_field, graph_id, graph_type
                        ));
                    }
                }
            }
        }
    }

    Ok(())
}

fn graph_column_types(
    data: &serde_json::Map<String, Value>,
) -> std::collections::HashMap<String, String> {
    data.get("columns")
        .and_then(|value| value.as_array())
        .map(|columns| {
            columns
                .iter()
                .filter_map(|column| {
                    let object = column.as_object()?;
                    let id = object.get("id")?.as_str()?.to_string();
                    let column_type = object
                        .get("type")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                        .trim()
                        .to_ascii_lowercase();
                    Some((id, column_type))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn extend_encoding_fields(
    fields: &mut Vec<String>,
    encoding: &serde_json::Map<String, Value>,
    key: &str,
) {
    if let Some(value) = encoding.get(key) {
        match value {
            Value::String(field) => fields.push(field.trim().to_string()),
            Value::Array(values) => {
                for value in values {
                    if let Some(field) = value.as_str() {
                        fields.push(field.trim().to_string());
                    }
                }
            }
            _ => {}
        }
    }
}

fn extend_optional_numeric_field(
    fields: &mut Vec<String>,
    encoding: &serde_json::Map<String, Value>,
    key: &str,
) {
    if encoding.contains_key(key) {
        extend_encoding_fields(fields, encoding, key);
    }
}

fn first_encoding_field(encoding: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    let mut fields = Vec::new();
    extend_encoding_fields(&mut fields, encoding, key);
    fields.into_iter().next()
}

fn maybe_require_axis_field(
    numeric_fields: &mut Vec<String>,
    time_fields: &mut Vec<String>,
    encoding: &serde_json::Map<String, Value>,
    options: Option<&Value>,
    column_types: &std::collections::HashMap<String, String>,
    key: &str,
    prefer_continuous: bool,
) {
    let mut axis_fields = Vec::new();
    extend_encoding_fields(&mut axis_fields, encoding, key);
    let Some(field) = axis_fields.first() else {
        return;
    };
    let scale_key = format!("{}Scale", key);
    let scale = options
        .and_then(|value| value.get(scale_key.as_str()))
        .and_then(|value| value.as_str())
        .unwrap_or("auto");
    let column_type = column_types.get(field).map(String::as_str).unwrap_or("");
    if scale == "time" || column_type == "date" {
        time_fields.push(field.clone());
    } else if scale == "linear" || (prefer_continuous && column_type == "number") {
        numeric_fields.push(field.clone());
    }
}

fn is_numeric_json_value(value: &Value) -> bool {
    match value {
        Value::Number(number) => number.as_f64().map_or(false, f64::is_finite),
        Value::String(text) => text.trim().parse::<f64>().map_or(false, f64::is_finite),
        _ => false,
    }
}

fn is_time_json_value(value: &Value) -> bool {
    json_time_millis(value).is_some()
}

fn is_non_empty_json_value(value: &Value) -> bool {
    match value {
        Value::String(text) => !text.trim().is_empty(),
        Value::Number(number) => number.as_f64().map_or(false, f64::is_finite),
        Value::Bool(_) => true,
        _ => false,
    }
}

fn json_time_millis(value: &Value) -> Option<f64> {
    match value {
        Value::String(text) => parse_graph_time_millis(text),
        Value::Number(number) => number.as_f64().filter(|value| value.is_finite()),
        _ => None,
    }
}

fn parse_graph_time_millis(text: &str) -> Option<f64> {
    let text = text.trim();
    if let Ok(value) = chrono::DateTime::parse_from_rfc3339(text) {
        return Some(value.timestamp_millis() as f64);
    }
    if let Ok(value) = chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d") {
        return value
            .and_hms_opt(0, 0, 0)
            .map(|datetime| datetime.and_utc().timestamp_millis() as f64);
    }
    chrono::NaiveDate::parse_from_str(&format!("{}-01", text), "%Y-%m-%d")
        .ok()
        .and_then(|value| value.and_hms_opt(0, 0, 0))
        .map(|datetime| datetime.and_utc().timestamp_millis() as f64)
}

fn validate_graph_columns(
    data: &serde_json::Map<String, Value>,
    context: &str,
) -> Result<Vec<String>, String> {
    let columns = data
        .get("columns")
        .and_then(|value| value.as_array())
        .ok_or(format!("{}.columns must be an array.", context))?;
    if columns.is_empty() {
        return Err(format!(
            "{}.columns must contain at least one column.",
            context
        ));
    }

    let mut column_ids = Vec::new();
    for (column_index, column) in columns.iter().enumerate() {
        let column_context = format!("{}.columns[{}]", context, column_index);
        let column = column
            .as_object()
            .ok_or(format!("{} must be an object.", column_context))?;
        let column_id = column
            .get("id")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or(format!("{}.id must be a non-empty string.", column_context))?
            .to_string();

        if column_ids.iter().any(|existing| existing == &column_id) {
            return Err(format!(
                "{}.columns contains duplicate column id `{}`.",
                context, column_id
            ));
        }

        column_ids.push(column_id);
    }

    Ok(column_ids)
}

fn validate_graph_rows(data: &serde_json::Map<String, Value>, context: &str) -> Result<(), String> {
    let rows = data
        .get("rows")
        .and_then(|value| value.as_array())
        .ok_or(format!("{}.rows must be an array.", context))?;
    for (row_index, row) in rows.iter().enumerate() {
        row.as_object().ok_or(format!(
            "{}.rows[{}] must be an object.",
            context, row_index
        ))?;
    }
    Ok(())
}

fn validate_graph_required_encodings(
    graph_type: &str,
    encoding: &serde_json::Map<String, Value>,
    context: &str,
) -> Result<(), String> {
    let required: &[&str] = match graph_type {
        "line" | "area" | "bar" | "stacked_bar" | "grouped_bar" | "scatter" | "bubble"
        | "combo" => &["x", "y"],
        "histogram" | "boxplot" => &["value"],
        "heatmap" | "matrix" => &["x", "y", "value"],
        "pie" | "donut" | "funnel" | "gauge" | "radar" | "waterfall" => &["label", "value"],
        "candlestick" => &["x", "open", "high", "low", "close"],
        "timeline" | "gantt" => &["label", "start", "end"],
        "tree" | "treemap" | "sunburst" => &["label", "value"],
        "network" => &["source", "target"],
        "sankey" => &["source", "target", "value"],
        _ => &[],
    };

    for key in required {
        let value = encoding.get(*key).ok_or(format!(
            "{}.{} is required for universal_graph type `{}`.",
            context, key, graph_type
        ))?;
        validate_graph_encoding_value_shape(value, &format!("{}.{}", context, key))?;
    }

    Ok(())
}

fn validate_graph_encoding_value_shape(value: &Value, context: &str) -> Result<(), String> {
    if value
        .as_str()
        .map(str::trim)
        .is_some_and(|text| !text.is_empty())
    {
        return Ok(());
    }
    if let Some(values) = value.as_array() {
        if values.is_empty() {
            return Err(format!("{} must not be an empty array.", context));
        }
        for (index, item) in values.iter().enumerate() {
            item.as_str()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .ok_or(format!(
                    "{}[{}] must be a non-empty string.",
                    context, index
                ))?;
        }
        return Ok(());
    }
    Err(format!(
        "{} must be a non-empty string or array of strings.",
        context
    ))
}

fn validate_graph_encoding_references(
    encoding: &serde_json::Map<String, Value>,
    column_ids: &[String],
    context: &str,
) -> Result<(), String> {
    for (key, value) in encoding {
        validate_graph_encoding_reference_value(key, value, column_ids, context)?;
    }
    Ok(())
}

fn validate_graph_encoding_reference_value(
    key: &str,
    value: &Value,
    column_ids: &[String],
    context: &str,
) -> Result<(), String> {
    if let Some(column_id) = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        if !column_ids.iter().any(|candidate| candidate == column_id) {
            return Err(format!(
                "{}.{} references missing data column `{}`.",
                context, key, column_id
            ));
        }
        return Ok(());
    }

    if let Some(values) = value.as_array() {
        for (index, item) in values.iter().enumerate() {
            let column_id = item
                .as_str()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .ok_or(format!(
                    "{}.{}[{}] must be a non-empty string.",
                    context, key, index
                ))?;
            if !column_ids.iter().any(|candidate| candidate == column_id) {
                return Err(format!(
                    "{}.{}[{}] references missing data column `{}`.",
                    context, key, index, column_id
                ));
            }
        }
    }

    Ok(())
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
            cells.as_object().ok_or(format!(
                "{}.cells must be an object when provided.",
                row_context
            ))?;
        }

        if let Some(children) = row.get("children") {
            let children = children.as_array().ok_or(format!(
                "{}.children must be an array when provided.",
                row_context
            ))?;
            validate_table_rows(children, &format!("{}.children", row_context))?;
        }
    }

    Ok(())
}

fn validate_rich_content_body(
    body: &str,
    table_ids: &[String],
    graph_ids: &[String],
) -> Result<(), String> {
    let mut active_fence: Option<RichContentFence> = None;

    for (line_index, line) in body.lines().enumerate() {
        let line_number = line_index + 1;
        let trimmed = line.trim();

        if let Some(fence) = active_fence.as_mut() {
            if trimmed == "```" {
                validate_rich_content_fence(fence, table_ids, graph_ids)?;
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

            if let Some(graph_id) = info_string.strip_prefix("universal_graph:") {
                let graph_id = graph_id.trim();
                if graph_id.is_empty() {
                    return Err(format!(
                        "Invalid embedded universal_graph block at line {}: expected ```universal_graph:<graph-id>.",
                        line_number
                    ));
                }
                active_fence = Some(RichContentFence {
                    kind: RichContentFenceKind::UniversalGraph(graph_id.to_string()),
                    start_line: line_number,
                    lines: Vec::new(),
                });
                continue;
            }

            if info_string.starts_with("universal_graph") {
                return Err(format!(
                    "Invalid embedded universal_graph block at line {}: expected ```universal_graph:<graph-id>.",
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
            RichContentFenceKind::UniversalGraph(graph_id) => format!(
                "Invalid embedded universal_graph block for graph `{}`: missing closing ``` for block starting at line {}.",
                graph_id, fence.start_line
            ),
        });
    }

    Ok(())
}

fn validate_rich_content_fence(
    fence: &RichContentFence,
    table_ids: &[String],
    graph_ids: &[String],
) -> Result<(), String> {
    match &fence.kind {
        RichContentFenceKind::Mermaid => validate_mermaid_fence(fence),
        RichContentFenceKind::StructuredData(table_id) => {
            validate_embedded_structured_data_fence(fence, table_id, table_ids)
        }
        RichContentFenceKind::UniversalGraph(graph_id) => {
            validate_embedded_universal_graph_fence(fence, graph_id, graph_ids)
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

fn validate_embedded_universal_graph_fence(
    fence: &RichContentFence,
    graph_id: &str,
    graph_ids: &[String],
) -> Result<(), String> {
    if fence.lines.iter().any(|line| !line.trim().is_empty()) {
        return Err(format!(
            "Embedded universal_graph block for graph `{}` should be empty. Define the graph in data.graphs and keep the fence body empty.",
            graph_id
        ));
    }

    if !graph_ids.iter().any(|candidate| candidate == graph_id) {
        return Err(format!(
            "Embedded universal_graph block references graph `{}`, but no matching entry exists in data.graphs.",
            graph_id
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
    warnings: Vec<String>,
}

fn attach_backend_callback_meta(meta: Option<Value>, callback: Option<Value>) -> Option<Value> {
    let Some(callback) = callback else {
        return meta;
    };
    let mut map = match meta {
        Some(Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    };
    map.insert("backendCallback".to_string(), callback);
    Some(Value::Object(map))
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
    let meta = attach_backend_callback_meta(
        arguments.get("meta").cloned(),
        arguments
            .get("backend_callback")
            .or_else(|| arguments.get("backendCallback"))
            .cloned(),
    );
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
    let warnings = collect_efficiency_warnings(&tool_name, &data);
    Ok(PushParams {
        session_id,
        tool_name,
        data,
        meta,
        timeout,
        warnings,
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
            let source = if renderer.scope == "universal" {
                "built-in"
            } else {
                "plugin"
            };
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

fn core_setup_question_group() -> Value {
    serde_json::json!({
        "plugin": "mcpviews-core",
        "questions": [
            {
                "id": "mcpviews_gronk_speak_mode",
                "question": "Enable Gronk Speak for MCPViews setup-persisted agent output style?",
                "description": "Choose the compression level for allowed outputs. Gronk Speak is direct language that cuts filler while preserving required facts.",
                "default_value": "off",
                "persist_as_rule_name": "mcpviews_gronk_speak_mode",
                "options": [
                    {
                        "value": "off",
                        "label": "Off",
                        "description": "Use normal assistant style unless the user explicitly asks for Gronk Speak.",
                        "persisted_rule": "MCPViews Gronk Speak mode is off by default. Use normal assistant style unless the user explicitly asks for Gronk Speak."
                    },
                    {
                        "value": "lite",
                        "label": "Lite",
                        "description": "Use short direct technical English; remove filler, hedging, preambles, and repeated summaries.",
                        "persisted_rule": "MCPViews Gronk Speak mode is lite. Where the selected Gronk scope allows it, use short direct technical English; cut filler, hedging, preambles, and repeated summaries while preserving required facts."
                    },
                    {
                        "value": "full",
                        "label": "Full",
                        "description": "Use compressed fragments, drop articles/connective fluff, and use bullets or -> for cause/effect.",
                        "persisted_rule": "MCPViews Gronk Speak mode is full. Where the selected Gronk scope allows it, use compressed fragments, drop articles and connective fluff, prefer bullets, and use -> for cause/effect while preserving required facts."
                    },
                    {
                        "value": "ultra",
                        "label": "Ultra",
                        "description": "Use maximum compression with terse fragments and obvious abbreviations only when clarity survives.",
                        "persisted_rule": "MCPViews Gronk Speak mode is ultra. Where the selected Gronk scope allows it, use maximum compression: terse fragments and obvious abbreviations only when clarity survives. Never sacrifice correctness or required facts."
                    }
                ]
            },
            {
                "id": "mcpviews_gronk_speak_scope",
                "question": "Where should Gronk Speak apply when the mode is enabled?",
                "description": "Choose which nonpublic outputs may use Gronk compression.",
                "default_value": "chat_status_only",
                "persist_as_rule_name": "mcpviews_gronk_speak_scope",
                "options": [
                    {
                        "value": "chat_status_only",
                        "label": "Chat/status only",
                        "description": "Apply only to assistant chat responses and progress updates.",
                        "persisted_rule": "MCPViews Gronk Speak scope is chat_status_only. When Gronk Speak mode is enabled, apply it only to assistant chat responses and progress updates. Never apply by default to public-facing artifacts: websites, emails, customer docs, PR descriptions/comments, published Ludflow docs, legal/medical/financial guidance, or user-facing copy. Preserve commands, file paths, line refs, citations, error text, warnings, uncertainty, API names, schema fields, code, JSON, and test results. User style instructions, renderer payload requirements, safety, and correctness outrank compression. Do not promise hidden reasoning-token savings; Gronk Speak mainly targets visible output and persisted context size."
                    },
                    {
                        "value": "internal_artifacts",
                        "label": "Internal artifacts",
                        "description": "Apply to chat/status plus private plans, specs, incident notes, and research docs.",
                        "persisted_rule": "MCPViews Gronk Speak scope is internal_artifacts. When Gronk Speak mode is enabled, apply it to assistant chat responses, progress updates, and private/internal plans, specs, incident notes, and research docs. Never apply by default to public-facing artifacts: websites, emails, customer docs, PR descriptions/comments, published Ludflow docs, legal/medical/financial guidance, or user-facing copy. Preserve commands, file paths, line refs, citations, error text, warnings, uncertainty, API names, schema fields, code, JSON, and test results. User style instructions, renderer payload requirements, safety, and correctness outrank compression. Do not promise hidden reasoning-token savings; Gronk Speak mainly targets visible output and persisted context size."
                    },
                    {
                        "value": "all_nonpublic",
                        "label": "All nonpublic",
                        "description": "Apply to any nonpublic output unless the user asks for polished prose.",
                        "persisted_rule": "MCPViews Gronk Speak scope is all_nonpublic. When Gronk Speak mode is enabled, apply it to any nonpublic output unless the user asks for polished prose. Never apply by default to public-facing artifacts: websites, emails, customer docs, PR descriptions/comments, published Ludflow docs, legal/medical/financial guidance, or user-facing copy. Preserve commands, file paths, line refs, citations, error text, warnings, uncertainty, API names, schema fields, code, JSON, and test results. User style instructions, renderer payload requirements, safety, and correctness outrank compression. Do not promise hidden reasoning-token savings; Gronk Speak mainly targets visible output and persisted context size."
                    }
                ]
            }
        ]
    })
}

pub(crate) fn collect_setup_questions(manifests: &[mcpviews_shared::PluginManifest]) -> Vec<Value> {
    let mut seen_plugins: HashSet<&str> = HashSet::new();
    let mut questions = vec![core_setup_question_group()];

    questions.extend(manifests.iter().filter_map(|manifest| {
        if !seen_plugins.insert(manifest.name.as_str()) || manifest.setup_questions.is_empty() {
            return None;
        }

        Some(serde_json::json!({
            "plugin": manifest.name,
            "questions": manifest.setup_questions,
        }))
    }));

    questions
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
        "rule": "When working with multi-org plugins, be aware of which organization the current token is scoped to. The init_session response includes org_tokens showing available organizations and token status per plugin: valid, expired_refreshable, expired_unrefreshable, or missing. If the user asks about data in a different org, include organization_id in tool call arguments. Treat expired_refreshable as configured while MCPViews refreshes it. If the token is missing or expired_unrefreshable, call start_plugin_auth with organization_id to authenticate."
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
    let mut relevant_renderers: std::collections::HashSet<String> =
        std::collections::HashSet::new();
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
    let mut seen_plugins: HashSet<&str> = HashSet::new();

    for manifest in manifests {
        if !seen_plugins.insert(manifest.name.as_str()) {
            continue;
        }
        if let Some(mcp) = &manifest.mcp {
            if let Some(auth) = &mcp.auth {
                let mut is_configured = auth.is_configured(&manifest.name);
                let auth_status = if matches!(auth, mcpviews_shared::PluginAuth::OAuth { .. }) {
                    let auth_dir = mcpviews_shared::auth_dir();
                    let org_statuses: Vec<_> =
                        mcpviews_shared::token_store::list_orgs(&auth_dir, &manifest.name)
                            .iter()
                            .map(|org_id| {
                                mcpviews_shared::token_store::token_status_for_org(
                                    &auth_dir,
                                    &manifest.name,
                                    org_id,
                                )
                            })
                            .collect();
                    if org_statuses
                        .iter()
                        .any(|status| {
                            matches!(
                                status,
                                mcpviews_shared::token_store::StoredTokenStatus::Valid
                                    | mcpviews_shared::token_store::StoredTokenStatus::ExpiredRefreshable
                            )
                        })
                    {
                        is_configured = true;
                    }
                    if org_statuses.iter().any(|status| {
                        *status == mcpviews_shared::token_store::StoredTokenStatus::Valid
                    }) {
                        "valid"
                    } else if org_statuses.iter().any(|status| {
                        *status
                            == mcpviews_shared::token_store::StoredTokenStatus::ExpiredRefreshable
                    }) {
                        "expired_refreshable"
                    } else if org_statuses.iter().any(|status| {
                        *status
                            == mcpviews_shared::token_store::StoredTokenStatus::ExpiredUnrefreshable
                    }) {
                        "expired_unrefreshable"
                    } else if is_configured {
                        "valid"
                    } else {
                        "missing"
                    }
                } else if is_configured {
                    "valid"
                } else {
                    "missing"
                };
                let mut status_entry = serde_json::json!({
                    "plugin": manifest.name,
                    "auth_type": auth.display_name(),
                    "auth_configured": is_configured,
                    "auth_status": auth_status,
                });

                if !is_configured {
                    if let mcpviews_shared::PluginAuth::OAuth { auth_url, .. } = auth {
                        if !auth.supports_email_code() {
                            status_entry.as_object_mut().unwrap().insert(
                                "auth_url".to_string(),
                                serde_json::Value::String(auth_url.clone()),
                            );
                        }
                        status_entry.as_object_mut().unwrap().insert(
                            "message".to_string(),
                            serde_json::Value::String(format!(
                                "Plugin '{}' requires authentication. Call start_plugin_auth; browser OAuth is only needed if auth_flow='browser' is explicitly requested.",
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
        "claude_code" => format!("Create or update `.claude/rules/mcpviews.md` in the project root containing all the rules below. Each rule should be a separate section with its name as a heading and its rule text as the body. Include `<!-- mcpviews-rules-version: {} -->` as the first line. This file will be automatically loaded by Claude Code as project-level rules. {}", RULES_VERSION, RULES_REFRESH_INSTRUCTION),

        "claude_desktop" => format!("For each rule below, create or update an individual memory using your memory capability. Use the title `mcpviews: <rule name>` and the rule text as the content. Include `mcpviews-rules-version: {}` in a separate memory titled `mcpviews: version`. Creating individual memories (rather than one combined memory) ensures each rule is retrievable independently and survives context window limits. {}", RULES_VERSION, RULES_REFRESH_INSTRUCTION),

        "codex" | "opencode" | "antigravity" => format!("Add or update the MCPViews section in `AGENTS.md` in the project root with all rules below. Each rule should be a separate section with its name as a heading and its rule text as the body. Include `<!-- mcpviews-rules-version: {} -->` as the first line of the MCPViews section. {}", RULES_VERSION, RULES_REFRESH_INSTRUCTION),

        "cursor" => format!("Create or update `.cursor/rules/mcpviews.mdc` in the project root containing all the rules below. Each rule should be a separate section with its name as a heading and its rule text as the body. Include `<!-- mcpviews-rules-version: {} -->` as the first line. This file is read by Cursor as project-level rules. {}", RULES_VERSION, RULES_REFRESH_INSTRUCTION),

        "windsurf" => format!("Add or update the MCPViews section in `.windsurfrules` in the project root with all rules below. Each rule should be a separate section with its name as a heading and its rule text as the body. Include `<!-- mcpviews-rules-version: {} -->` as the first line of the MCPViews section. {}", RULES_VERSION, RULES_REFRESH_INSTRUCTION),

        _ => format!("These rules should be persisted so they guide your behavior in future conversations. \
              Ask the user: \"I have received behavioral rules from MCPViews for its renderers and tools. \
              How would you like me to persist them? I can write them to a rules file in this project, \
              create memories, or use another method your platform supports.\" \
              Then follow the user's direction to commit the rules. Include version marker `mcpviews-rules-version: {}` so updates can be detected. {}", RULES_VERSION, RULES_REFRESH_INSTRUCTION),
    }
}

/// Extract lightweight tool summaries (name + description) from full tool definitions.
fn extract_tool_summaries(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .filter_map(|t| {
            let name = t.get("name")?.as_str()?;
            let description = t.get("description").and_then(|d| d.as_str()).unwrap_or("");
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
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
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
        "capabilities": ["rich-content", "rich-content-embeds", "structured-data", "universal-graph", "graph-analytics", "review", "discovery"],
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
            let index = manifest.registry_index.clone().unwrap_or_else(|| {
                auto_derive_registry_index(manifest, tool_cache.plugin_tools(idx))
            });
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
    let mapped_tools: std::collections::HashSet<&str> =
        manifest.renderers.keys().map(|s| s.as_str()).collect();

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
            tools
                .iter()
                .find(|t| t.get("name").and_then(|n| n.as_str()) == Some(&prefixed))
                .and_then(|t| t.get("description").and_then(|d| d.as_str()))
                .map(|d| {
                    let truncated: String = d.chars().take(80).collect();
                    if d.len() > 80 {
                        format!("{}...", truncated)
                    } else {
                        truncated
                    }
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
    let mut seen_plugins: HashSet<&str> = HashSet::new();
    manifests
        .iter()
        .enumerate()
        .filter_map(|(idx, manifest)| {
            if !seen_plugins.insert(manifest.name.as_str()) {
                return None;
            }

            let index = match &manifest.registry_index {
                Some(ri) => ri.clone(),
                None => {
                    let cached_tools = tool_cache.plugin_tools(idx);
                    auto_derive_registry_index(manifest, cached_tools)
                }
            };

            Some(serde_json::json!({
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
            }))
        })
        .collect()
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
                    let org_entries: Vec<Value> = orgs
                        .iter()
                        .map(|org_id| {
                            let status = mcpviews_shared::token_store::token_status_for_org(
                                &auth_dir,
                                &manifest.name,
                                org_id,
                            );
                            serde_json::json!({
                                "org_id": org_id,
                                "status": status.as_str(),
                                "refreshable": status.refreshable()
                            })
                        })
                        .collect();

                    result.insert(
                        manifest.name.clone(),
                        serde_json::json!({
                            "orgs": org_entries
                        }),
                    );
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

const RENDERER_SELECTION_RULE: &str = "When displaying content in MCPViews, choose the renderer based on data shape:\n\n- **rich_content**: Prose, explanations, diagrams (mermaid), code blocks, simple markdown tables (<10 rows), inline edit suggestions, embedded tables, embedded read-only universal_graph charts, plugin citations. Default choice for documents and explanations. Use push_review when content includes suggestions, embedded table changes, or read-only graph context for a review.\n- **structured_data**: Standalone tabular data with sort/filter/expand needs, hierarchical rows, or proposed changes requiring accept/reject review. Use push_review for change approval workflows. For substantive or risky MCP mutations, structured_data with push_review can give the user row-level approval; see the bulk_action_review rule.\n- **universal_graph**: Standalone read-only analytical chart/graph packs using semantic graph specs in data.graphs. Use for chart, hierarchy, network, flow, timeline, matrix, and distribution views when the main output is visual analysis rather than prose. Call the direct universal_graph tool when available, or push_content with tool_name universal_graph for compatibility.\n\nFor any review payload sent through push_review, visible titles, labels, table cells, and details must identify the document or entity being changed by human-readable name, title, path, or display label. Do not use an opaque backend ID as the only visible target; keep IDs only in stable row ids, citation metadata, or execution bookkeeping.\n\nPlugin tool output routes through rich_content with transformation rules defined in the plugin manifest. When uncertain, default to rich_content. Only use structured_data when the data is genuinely tabular with columns and rows and NOT embedded within a document. Use universal_graph when the main output is a visual analysis. Use rich_content with empty ```universal_graph:<graph-id> fences when graphs need prose, suggestions, citations, or review context.";

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

For larger embedded tables, first call `describe_tool("register_dataset")` if available, then call `register_dataset` with source objects or allowlisted local Markdown references. Never pass `sources` entries as JSON strings. Local Markdown paths must resolve under `~/.mcpviews/cache/dataset-references` or `MCPVIEWS_DATASET_REFERENCE_ROOTS`. Then embed a table with `dataRef` using the returned `dataset_id` and `query_token` instead of repeating all rows:
```json
{
  "id": "evidence_reviews",
  "name": "Evidence Reviews",
  "dataRef": {
    "dataset_id": "northstar-risk-control-2026-05",
    "query_token": "returned-query-token",
    "source_id": "reviews",
    "recipe": "review_rows"
  }
}
```

## Embedded universal_graph charts (rich_content display or review)

Embed read-only analytical charts within markdown using empty fenced code blocks. This works in plain rich_content pushes and in rich_content push_review payloads; graphs remain read-only review context and never carry approve/reject state.

````
Context paragraph explaining the graph.

```universal_graph:g1
```

Interpretation after the graph.
````

Include graph specs in `data.graphs`:
```json
{
  "body": "Context\n\n```universal_graph:g1\n```",
  "graphs": [{
    "id": "g1",
    "title": "Revenue by Month",
    "type": "line",
    "data": { "columns": [...], "rows": [...] },
    "encoding": { "x": "month", "y": "revenue" },
    "axes": { "x": "Month", "y": "Revenue in dollars" }
  }]
}
```

Embedded graph fences must be empty and must reference a matching entry in `data.graphs`. If multiple graphs participate in drilldowns, include the full graph registry in `data.graphs` and reference only the primary graph from the body. Graph embeds are read-only in V1; use standalone `universal_graph` or the direct `universal_graph` tool when the main output is a graph pack rather than a prose or review document.

For larger graph datasets, first call `describe_tool("register_dataset")` if available, then call `register_dataset` and pass `dataRef` with the returned `dataset_id` and `query_token` plus a named recipe (`count_by`, `group_sum`, `trend`, `heatmap_by_pair`, `funnel_from_counts`, `waterfall_from_deltas`, `select_rows`) instead of emitting all graph rows inline. For graph `dataRef` recipes, MCPViews infers common recipe params from the graph `encoding` (`x`, `y`, `value`, and `label`) when `dataRef.params` is omitted; for `group_sum` it also infers `outputField` from the visible y/value encoding so hydrated rows match the graph. Pass explicit params only when the transform should differ from the visible encoding. For prepared findings Markdown, use `kind: "markdown_json_blocks"` plus `path` only when the file is under `~/.mcpviews/cache/dataset-references` or `MCPVIEWS_DATASET_REFERENCE_ROOTS`.

## Combined review payload

When `push_review` includes suggestions and/or tables, the user submits a combined `rich_content_decisions` payload:
```json
{
  "suggestion_decisions": { "s1": { "status": "accept", "comment": "looks good" } },
  "table_decisions": { "t1": { "decisions": {...}, "modifications": {...}, "additions": {...} } }
}
```

These arrive as `suggestionDecisions` and `tableDecisions` in the `await_review` response.

## Review target labels

Every visible review target must be understandable to the user before they approve it. In `push_review` payloads, use the document or entity's human-readable name, title, path, or display label in titles, body text, suggestion context, table names, row cells, and Details columns. Do NOT use an opaque backend ID (document id, entity id, database id, UUID, etc.) as the only visible target. Keep those IDs only in stable row `id` values, citation metadata, hidden execution context, or tool arguments needed after approval. If only an ID is available, fetch or derive a display name before presenting the review.

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

const BULK_ACTION_REVIEW_RULE: &str = r#"Use `push_review` for MCP mutations only when review adds meaningful safety or control. Do not interrupt the user with a review for every small, clearly requested write.

## Trigger

Present a structured review before MCP mutations when any of these apply:
- **Substantive or risky batch**: the planned create, update, or delete calls materially affect multiple external resources, long-lived records, or user-visible state. Count alone is not a review trigger.
- **Destructive or hard-to-undo change**: delete, archive, merge, publish, send, apply, billing/payment, permission, credential, production-data, or cross-organization changes.
- **Ambiguous or user-editable batch**: the user should be able to accept/reject individual rows, adjust values, or confirm targets before execution.
- **High blast radius**: the change affects multiple named entities, customer-visible state, governance records, external communications, or long-lived files/documents.

Do not trigger a review for read-only discovery, search, list, get, preview, validation, formatting, test runs, or other non-mutating actions.

## Mandate

When the trigger applies, present all planned actions as `structured_data` via `push_review` before executing the reviewed mutations.

For low-risk MCP mutations that are explicitly requested, clearly named, and easy to undo, proceed directly and summarize what changed afterward. Routine low-risk creates and minor edits do not require a review just because several similar actions are planned. If the risk is unclear, ask a brief chat clarification before opening a review.

## Examples

Use `push_review` for:
- Archiving, deleting, merging, publishing, sending, payment, permission, credential, production-data, or cross-organization changes.
- Governance changes that move important DecidR/Ludflow state, such as decision status transitions plus document/audit updates.
- Batches where the user should accept or reject individual rows before execution.
- Ambiguous target changes, such as multiple matching documents, records, projects, or customer-visible entities.
- Any update that is hard to undo or could affect production/customer-visible state.

Skip `push_review` for:
- Creating a clearly requested, low-risk document, task, note, folder, category, or draft record.
- Minor edits like typo fixes, title cleanup, short addenda, metadata corrections, or small field updates.
- Several routine low-risk creates or edits when the user has explicitly named the targets and desired changes.
- Read-only search/list/get/preview/validation/test actions.
- Local Codex file edits through normal coding tools.

## Table structure

Use a single table with these columns:
- **Action** — the operation type: create, update, or delete
- **Entity Type** — what kind of resource (e.g., file, record, API endpoint)
- **Target** — the human-readable name, title, path, or display label of the resource being changed
- **Details** — brief description of what will be created/changed/removed

Do NOT put an opaque backend ID in the visible Target cell when the action affects a named document, entity, database record, issue, project, or similar object. Use the human-readable object name instead, and keep the backend ID only in stable row `id` values, hidden execution context, citation metadata, or the actual MCP tool arguments used after approval.

Mark each row's `change` field to visually distinguish operations:
- `"add"` for create actions (green)
- `"update"` for update actions (yellow)
- `"delete"` for delete actions (red strikethrough)

**Use hierarchical rows for parent-child operations.** When creating containers with contents (e.g., folders with documents, categories with items), nest child rows inside parent rows using the `children` array. Do NOT flatten everything into a single list with a "Parent" column — the renderer shows collapsible nested rows natively.

## Workflow

1. **Gather**: Collect the substantive, risky, destructive, ambiguous, or user-editable mutations before executing them
2. **Present**: Send them via `push_review` as a structured_data table — this returns immediately with a `session_id`
3. **Wait**: Call `await_review(session_id)` to wait for the user's decisions (accept/reject per row, possible cell edits). If it returns `pending` before the user decides, call `await_review` again with the same `session_id` — the session persists on the server
4. **Execute**: Only execute rows the user accepted, respecting any user edits to cell values
5. **Report**: Summarize what was executed and what was skipped

## Minor-action exception

If low-risk mutations are planned and the user already named the targets and desired changes, `push_review` is not required - proceed directly and summarize afterward.

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
- For large or repeated tables, call `describe_tool("register_dataset")` if available, then call `register_dataset` once with source objects or allowlisted local Markdown references. Do not stringify source objects. Use `tables[].dataRef` with the returned `dataset_id` and `query_token` plus recipe `review_rows` or `select_rows` instead of repeating every cell in the renderer payload.

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

`push_review` returns immediately with a `session_id`. Call `await_review(session_id)` to wait until the user submits. If it returns `pending` before the user decides, call `await_review` again — the session persists on the server.

Shows proposed changes with color-coded diffs. Users can accept/reject individual rows and columns, edit cell values, then submit. Use `change` fields to mark what was added, deleted, or updated.

Visible review cells must identify changed documents or entities by human-readable name, title, path, or display label. Do NOT make the user approve a row whose only visible target is an opaque backend ID. Row `id` values may remain stable internal keys for decision mapping; visible cells should carry the friendly target label.

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

**Bulk MCP actions**: Use push_review before MCP mutations when the batch is substantive or risky: high-impact, destructive, ambiguous, hard to undo, production/customer-visible, or needing row-level approval. Routine low-risk creates and minor edits do not require review when targets and requested changes are clear; count alone is not a review trigger. push_review returns a session_id; call await_review(session_id) to wait until the user decides. See the bulk_action_review rule for the full workflow and table structure.

## Data shape reference

- `tables[]`: Array of table objects, each with `id`, `name`, `columns[]`, `rows[]`
- `columns[]`: `{ id, name, change }` — change is null for read-only, "add"/"delete" for review
- `rows[]`: `{ id, cells, children }` — cells is `{ [colId]: { value, change } }`, children enables arbitrary nesting
- For read-only tables rendered via `push_content`, set all `change` values to null
- For approval flows rendered via `push_review`, set row/column/cell `change` values explicitly where changes exist
- **Always use `children` for parent-child relationships** — do not flatten hierarchies into extra columns
- Nested rows auto-expand to depth 2; deeper rows start collapsed"#;

const UNIVERSAL_GRAPH_RULE: &str = r#"Use universal_graph for read-only analytical charts and graphs that should be rendered by MCPViews instead of authored as custom code. If the hosted catalog is available, inspect `describe_tool("universal_graph")` for the current schema summary before constructing a complex graph pack.

## Choose the right call pattern

- Prefer the direct `universal_graph` tool for standalone graph packs and dashboards when it is available in the tool list.
- Use `push_content` + `universal_graph` as the compatibility form when direct renderer tools are unavailable.
- Embed graphs inside `rich_content` when prose, citations, suggestions, or review context needs inline visual support, using empty fenced blocks like:

````markdown
```universal_graph:revenue_by_month
```
````

and define the matching graph in `data.graphs`. Embedded graphs also work inside rich_content review payloads, but they are read-only context; review decisions still come from suggestions and structured_data tables.

## Payload shape

`data` must be a JSON object with `graphs`, an array of graph specs:

```json
{
  "title": "Optional dashboard title",
  "description": "Optional context",
  "graphs": [{
    "id": "revenue_by_month",
    "title": "Revenue by Month",
    "type": "line",
    "data": {
      "columns": [
        { "id": "month", "name": "Month", "type": "date" },
        { "id": "revenue", "name": "Revenue", "type": "number" }
      ],
      "rows": [
        { "month": "2026-01", "revenue": 120000 },
        { "month": "2026-02", "revenue": 142000 }
      ]
    },
    "encoding": { "x": "month", "y": "revenue" },
    "axes": {
      "x": { "label": "Month", "description": "Calendar month at period end" },
      "y": "Revenue in dollars"
    }
  }]
}
```

For large or reused datasets, call `describe_tool("register_dataset")` if available, then call `register_dataset` once and use `graphs[].dataRef` instead of inline `data.rows`. Do not stringify `sources` entries. When a local prepared findings Markdown file already contains fenced JSON chart data and lives under `~/.mcpviews/cache/dataset-references` or `MCPVIEWS_DATASET_REFERENCE_ROOTS`, register it with `kind: "markdown_json_blocks"` and a `path` instead of copying the rows:
```json
{
  "id": "risk_by_rule",
  "type": "bar",
  "dataRef": {
    "dataset_id": "northstar-risk-control-2026-05",
    "query_token": "returned-query-token",
    "source_id": "rule_evaluations",
    "recipe": "group_sum",
    "params": { "groupBy": "rule", "value": "riskScore" }
  },
  "encoding": { "x": "rule", "y": "value" }
}
```

Supported `dataRef.recipe` values are `select_rows`, `review_rows`, `count_by`, `group_sum`, `trend`, `heatmap_by_pair`, `funnel_from_counts`, and `waterfall_from_deltas`. The renderer fetches referenced rows from the MCPViews session cache and loads source rows on demand from the graph Data button. Every dataRef must include the `query_token` returned by `register_dataset`. For graph recipes, omit `dataRef.params` when the recipe should use the visible encoding fields; the renderer derives heatmap `x`/`y`/`value`, trend `x`/`y`, waterfall `label`/`value`, funnel `label`/`count`, and common group/count fields from `encoding`; `group_sum` also derives `outputField` from the graph's y/value encoding.

Supported V1 graph types: line, area, bar, stacked_bar, grouped_bar, scatter, bubble, combo, histogram, boxplot, heatmap, matrix, pie, donut, waterfall, funnel, gauge, radar, candlestick, timeline, gantt, tree, network, treemap, sunburst, sankey.

Optional per-graph `options` can include `xScale`/`yScale` (`auto`, `category`, `linear`, `time`), `maxVisibleItems` for dense summaries, `showAll: true` when a caller prefers complete but crowded marks, `otherBucket` (`separate`, `inline`, `hidden`) for dense categorical summaries, and `binCount` for histograms. Waterfall charts also support `showTotal: false` to omit the ending balance bar and `totalLabel` to name the ending balance. Scatter and bubble charts use numeric/time x-scales automatically when the x column supports them; categorical x is only for string dimensions. Even with `showAll`, labels may be sampled or culled to avoid overlap.

Optional per-graph `axes` can provide visible x/y axis context. Each axis can be a string label or an object with `label` and optional `description`. When omitted, supported charts derive axis titles from encoded column names.

Optional per-graph `role` can be `primary` (default) or `drilldown`. Drilldown graphs are hidden from the initial graph list but remain addressable from primary graph interactions, including rich-content embeds that carry multiple graph specs.

Optional per-graph `interactions` can include `details` (`titleField` plus `fields[]` to select tooltip/detail rows), `hover` (`auto` by default, or `none` to disable hover highlighting), `drilldowns[]` (`id`, `label`, `targetGraphId`, `trigger`, and `match` mapping from a current field or token like `node.label`/`link.source`/`link.target` to a target graph field), and `metricControls` for read-only swapping of `encoding.y` or `encoding.value` among validated numeric fields.

Dense graphs auto-summarize by default with visible disclosure, such as sampled axis ticks, top-N categories with a separated Other callout, dense pie/donut summaries, capped timeline/funnel rows, duplicate candlestick/time-key aggregation, aggregated network/sankey links, and source-table row-count notices. Very dense scatter/bubble, heatmap/matrix, network, and sankey views use compact native layers with sampled focus marks so all visual marks remain represented without thousands of DOM nodes. Full values remain inspectable through graph marks, visible custom tooltips, pinned detail panels, and the Data table. Bar, heatmap, and waterfall charts render compact numeric labels when there is enough room. Histogram `binCount` is clamped to a safe range. Gauges can read `encoding.min`/`encoding.max` fields, with `graph.min`/`graph.max` as fallback, and display under-limit or over-limit values with clamped arcs. Waterfalls treat the first row and optional ending row as balance bars, color intermediate decreases/increases separately, and connect cumulative movements. Funnels preserve a uniform side slope while using each stage's vertical thickness to encode relative value; exact stage values remain in labels, tooltips, pinned details, and source rows. Tree and sunburst hierarchy traversal is cycle-safe and stack-safe; extremely deep sunbursts disclose compressed thin rings. Sunburst uses `encoding.parent` when supplied and falls back to donut only when no hierarchy exists. Sankey data with cycles or self-links falls back to a network view because Sankey flow is acyclic.

Validation is strict: graph IDs must be unique, graph types must be supported, roles, axes, and options must use supported values, required encodings must be present for the selected type, encoding fields must reference existing `data.columns` IDs, required numeric/time row values must be valid, drilldowns must target existing graph IDs and fields, and metric controls must reference numeric fields. If a requested graph type is unsupported or required values are invalid, choose a supported type or repair the data and retry. If no supported graph honestly fits the data, provide an explanation plus structured_data table as a last resort.

V1 is read-only: use visible custom tooltips, legends, focus/highlight, click-to-pin detail panels, source-data inspection, declarative drilldowns, metric controls, and zoom/pan where useful. Always include axis labels/descriptions when numeric values need business context. Do not encode approve/reject review state in graphs."#;

fn builtin_renderer_definitions() -> Vec<RendererDef> {
    vec![
        RendererDef {
            name: "rich_content".into(),
            description: "Universal markdown display with mermaid diagrams, tables, code blocks, and citations. Use for any rich text content.".into(),
            scope: "universal".into(),
            tools: vec![],
            data_hint: Some(r#"{ "title": "Optional heading", "body": "Markdown with ```mermaid blocks, ```structured_data:t1 embeds, ```universal_graph:g1 embeds, and {{suggest:id=X}} markers", "instructionTemplate": { "id": "audit_only_evidence_review_v1", "variables": {} }, "suggestions": { "s1": { "old": "text", "new": "replacement" } }, "tables": [{ "id": "t1", "name": "Name", "columns": [...], "rows": [...] } or { "id": "t1", "name": "Name", "dataRef": { "dataset_id": "id", "query_token": "token", "recipe": "review_rows" } }], "graphs": [{ "id": "g1", "type": "line", "data": { "columns": [...], "rows": [...] }, "encoding": { "x": "field", "y": "field" } } or { "id": "g1", "type": "bar", "dataRef": { "dataset_id": "id", "query_token": "token", "recipe": "group_sum", "params": {} }, "encoding": { "x": "field", "y": "value" } }], "citations": { "plugin": [{ "index": 1, "source": "ludflow", "type": "code_unit", "id": "abc123", "label": "name" }] } } — data must be a JSON object, not a string. Use register_dataset + dataRef for large/repeated rows."#.into()),
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
            data_hint: Some(r#"{ "title": "Optional", "instructionTemplate": { "id": "audit_only_evidence_review_v1", "variables": {} }, "tables": [{ "id": "t1", "name": "Name", "columns": [{ "id": "c1", "name": "Col", "change": null|"add"|"delete" }], "rows": [{ "id": "r1", "cells": { "c1": { "value": "v", "change": null|"add"|"delete"|"update" } }, "children": [] }] } or { "id": "t1", "name": "Name", "dataRef": { "dataset_id": "id", "query_token": "token", "recipe": "review_rows" } }] }"#.into()),
            display_mode: None,
            invoke_schema: None,
            url_patterns: vec![],
            standalone: false,
            standalone_label: None,
            rule: Some(STRUCTURED_DATA_RULE.into()),
        },
        RendererDef {
            name: "universal_graph".into(),
            description: "Native read-only analytical graph renderer for standalone graph packs and rich_content embeds across chart, hierarchy, network, flow, timeline, matrix, and distribution views.".into(),
            scope: "universal".into(),
            tools: vec![],
            data_hint: Some(r#"{ "title": "Optional", "description": "Optional context", "instructionTemplate": { "id": "audit_only_evidence_review_v1", "variables": {} }, "graphs": [{ "id": "unique_graph_id", "title": "Optional graph title", "type": "line|bar|scatter|pie|donut|heatmap|matrix|histogram|boxplot|waterfall|funnel|gauge|radar|candlestick|timeline|gantt|tree|network|treemap|sunburst|sankey|combo", "role": "primary|drilldown", "data": { "columns": [{ "id": "field", "name": "Field", "type": "number|string|date" }], "rows": [{ "field": "value" }] }, "dataRef": { "dataset_id": "id", "query_token": "token", "source_id": "source", "recipe": "group_sum|count_by|trend|heatmap_by_pair|funnel_from_counts|waterfall_from_deltas|select_rows", "params": {} }, "encoding": { "x": "field", "y": "field", "label": "field", "parent": "field", "value": "field", "source": "field", "target": "field", "min": "field", "max": "field" }, "axes": { "x": { "label": "X axis label", "description": "Optional hover context" }, "y": "Y axis label" }, "options": { "xScale": "auto|category|linear|time", "yScale": "auto|category|linear|time", "maxVisibleItems": 24, "showAll": false, "otherBucket": "separate|inline|hidden", "binCount": 12, "showTotal": true, "totalLabel": "Ending total" }, "interactions": { "details": { "titleField": "field", "fields": ["field"] }, "hover": "auto", "drilldowns": [{ "id": "detail", "label": "Open detail", "targetGraphId": "detail_graph", "trigger": "mark", "match": { "source": "field", "targetField": "field" } }], "metricControls": { "target": "y|value", "fields": ["numeric_field"] } } }] }"#.into()),
            display_mode: None,
            invoke_schema: None,
            url_patterns: vec![],
            standalone: false,
            standalone_label: None,
            rule: Some(UNIVERSAL_GRAPH_RULE.into()),
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
    let current_persona_studio_installed = registry
        .manifests
        .iter()
        .any(|manifest| manifest.name == CURRENT_PERSONA_STUDIO_PLUGIN);

    for (idx, manifest) in registry.manifests.iter().enumerate() {
        if current_persona_studio_installed && manifest.name == LEGACY_PERSONA_STUDIO_PLUGIN {
            continue;
        }

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
    let hints = renderers
        .iter()
        .filter(|r| r.scope == "universal")
        .filter_map(|r| {
            r.data_hint
                .as_ref()
                .map(|h| format!("For {}: {}", r.name, h))
        })
        .collect::<Vec<_>>()
        .join(". ");
    format!(
        "{} {} For plugin renderer data shapes, call get_plugin_docs.",
        prefix, hints
    )
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
                Some("rich_content" | "structured_data" | "universal_graph")
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
    use crate::test_utils::test_app_state;
    use mcpviews_shared::{PluginAuth, PluginManifest, PluginMcpConfig};

    #[test]
    fn test_plugin_auth_http_error_detector_includes_permission_failures() {
        assert!(is_plugin_auth_http_error("Plugin returned HTTP 401"));
        assert!(is_plugin_auth_http_error("Plugin returned HTTP 403"));
        assert!(!is_plugin_auth_http_error("Plugin returned HTTP 500"));
        assert!(!is_plugin_auth_http_error(
            "Plugin error: Forbidden by workspace role"
        ));
    }

    fn make_manifest(
        name: &str,
        renderer_defs: Vec<RendererDef>,
        tool_rules: std::collections::HashMap<String, String>,
        mcp: Option<PluginMcpConfig>,
    ) -> PluginManifest {
        PluginManifest {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            standalone_group: None,
            standalone_group_label: None,
            renderers: std::collections::HashMap::new(),
            frame_origins: vec![],
            mcp,
            renderer_definitions: renderer_defs,
            tool_rules,
            no_auto_push: vec![],
            registry_index: None,
            download_url: None,
            prompt_definitions: vec![],
            plugin_rules: vec![],
            setup_questions: vec![],
        }
    }

    fn persona_lab_renderer(description: &str) -> RendererDef {
        RendererDef {
            name: "persona_lab".to_string(),
            description: description.to_string(),
            scope: "universal".to_string(),
            tools: vec![],
            data_hint: Some("{}".to_string()),
            rule: None,
            display_mode: None,
            invoke_schema: None,
            url_patterns: vec![],
            standalone: true,
            standalone_label: Some("Persona Studio".to_string()),
        }
    }

    #[test]
    fn test_available_renderers_prefers_current_persona_studio() {
        let (state, _dir) = test_app_state();
        state
            .install_plugin_from_manifest(
                make_manifest(
                    LEGACY_PERSONA_STUDIO_PLUGIN,
                    vec![persona_lab_renderer("Legacy Persona Studio")],
                    std::collections::HashMap::new(),
                    None,
                ),
                false,
            )
            .unwrap();
        state
            .install_plugin_from_manifest(
                make_manifest(
                    CURRENT_PERSONA_STUDIO_PLUGIN,
                    vec![persona_lab_renderer("Current Persona Studio")],
                    std::collections::HashMap::new(),
                    None,
                ),
                false,
            )
            .unwrap();

        let renderers = available_renderers(&state);
        let persona_renderers = renderers
            .iter()
            .filter(|renderer| renderer.name == "persona_lab")
            .collect::<Vec<_>>();

        assert_eq!(persona_renderers.len(), 1);
        assert_eq!(persona_renderers[0].description, "Current Persona Studio");
    }

    #[test]
    fn test_build_plugin_registry_dedupes_duplicate_plugin_manifests() {
        let mut first = make_manifest("ludflow", vec![], std::collections::HashMap::new(), None);
        first.registry_index = Some(mcpviews_shared::PluginRegistryIndex {
            summary: "Ludflow first".to_string(),
            tags: vec!["docs".to_string()],
            tool_groups: vec![],
            renderer_names: vec!["ludflow_app".to_string()],
        });

        let mut duplicate =
            make_manifest("ludflow", vec![], std::collections::HashMap::new(), None);
        duplicate.registry_index = Some(mcpviews_shared::PluginRegistryIndex {
            summary: "Ludflow duplicate".to_string(),
            tags: vec!["duplicate".to_string()],
            tool_groups: vec![],
            renderer_names: vec!["ludflow_app".to_string()],
        });

        let registry =
            build_plugin_registry(&[first, duplicate], &crate::tool_cache::ToolCache::new(2));

        assert_eq!(registry.len(), 1);
        assert_eq!(registry[0]["name"], "ludflow");
        assert_eq!(registry[0]["summary"], "Ludflow first");
    }

    // ─── collect_rules tests ───

    #[test]
    fn test_collect_rules_includes_renderer_selection() {
        let rules = collect_rules(&[], &[]);
        assert_eq!(rules.len(), 2);
        let sel = rules
            .iter()
            .find(|r| r["name"] == "renderer_selection")
            .expect("renderer_selection rule should exist");
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
        let sel = rules
            .iter()
            .find(|r| r["name"] == "renderer_selection")
            .expect("renderer_selection rule should exist");
        assert_eq!(sel["category"], "system");

        let rc = rules
            .iter()
            .find(|r| r["name"] == "rich_content_usage")
            .expect("rich_content_usage rule should exist");
        assert_eq!(rc["category"], "renderer");
        assert_eq!(rc["source"], "built-in");
        assert_eq!(rc["renderer"], "rich_content");
        assert_eq!(rc["rule"], "Always use rich_content for plans.");
        assert_eq!(rc["description"], "Universal markdown display");
        assert_eq!(rc["scope"], "universal");
        assert_eq!(
            rc["data_hint"],
            r#"{ "title": "heading", "body": "markdown" }"#
        );
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
        let sel = rules
            .iter()
            .find(|r| r["name"] == "renderer_selection")
            .expect("renderer_selection rule should exist");
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
        let cv = rules
            .iter()
            .find(|r| r["renderer"] == "custom_view")
            .expect("custom_view rule should exist");
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
        let sr = rules
            .iter()
            .find(|r| r["renderer"] == "search_results")
            .expect("search_results rule should exist");
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
        let tr = rules
            .iter()
            .find(|r| r["name"] == "sp__search_usage")
            .expect("sp__search_usage rule should exist");
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
        let tr = rules
            .iter()
            .find(|r| r["tool"] == "do_thing")
            .expect("do_thing rule should exist");
        assert_eq!(tr["name"], "do_thing_usage");
    }

    #[test]
    fn test_collect_setup_questions_prepends_core_gronk_questions() {
        let questions = collect_setup_questions(&[]);

        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0]["plugin"], "mcpviews-core");

        let core_questions = questions[0]["questions"].as_array().unwrap();
        assert_eq!(core_questions.len(), 2);
        assert_eq!(core_questions[0]["id"], "mcpviews_gronk_speak_mode");
        assert_eq!(core_questions[1]["id"], "mcpviews_gronk_speak_scope");
    }

    #[test]
    fn test_core_gronk_mode_question_has_tiered_options() {
        let questions = collect_setup_questions(&[]);
        let mode_question = &questions[0]["questions"][0];
        let options = mode_question["options"].as_array().unwrap();
        let values: Vec<&str> = options
            .iter()
            .map(|option| option["value"].as_str().unwrap())
            .collect();

        assert_eq!(mode_question["default_value"], "off");
        assert_eq!(values, vec!["off", "lite", "full", "ultra"]);
        assert_eq!(
            mode_question["persist_as_rule_name"],
            "mcpviews_gronk_speak_mode"
        );
        assert!(options[1]["persisted_rule"]
            .as_str()
            .unwrap()
            .contains("short direct technical English"));
        assert!(options[2]["persisted_rule"]
            .as_str()
            .unwrap()
            .contains("-> for cause/effect"));
        assert!(options[3]["persisted_rule"]
            .as_str()
            .unwrap()
            .contains("Never sacrifice correctness"));
    }

    #[test]
    fn test_core_gronk_scope_question_has_guardrails() {
        let questions = collect_setup_questions(&[]);
        let scope_question = &questions[0]["questions"][1];
        let options = scope_question["options"].as_array().unwrap();
        let values: Vec<&str> = options
            .iter()
            .map(|option| option["value"].as_str().unwrap())
            .collect();

        assert_eq!(scope_question["default_value"], "chat_status_only");
        assert_eq!(
            values,
            vec!["chat_status_only", "internal_artifacts", "all_nonpublic"]
        );
        assert_eq!(
            scope_question["persist_as_rule_name"],
            "mcpviews_gronk_speak_scope"
        );

        for option in options {
            let persisted_rule = option["persisted_rule"].as_str().unwrap();
            assert!(persisted_rule.contains("public-facing artifacts"));
            assert!(persisted_rule.contains("PR descriptions/comments"));
            assert!(persisted_rule.contains("Preserve commands"));
            assert!(persisted_rule.contains("renderer payload requirements"));
            assert!(persisted_rule.contains("visible output and persisted context size"));
        }
    }

    #[test]
    fn test_collect_setup_questions_includes_plugin_questions_after_core() {
        let mut manifest = make_manifest(
            "governance-plugin",
            vec![],
            std::collections::HashMap::new(),
            None,
        );
        manifest.setup_questions = vec![mcpviews_shared::SetupQuestion {
            id: "governance_mode".to_string(),
            question: "Use teammate approvals?".to_string(),
            description: None,
            options: vec![mcpviews_shared::SetupQuestionOption {
                value: "team".to_string(),
                label: "Yes".to_string(),
                description: None,
                persisted_rule: Some("Default governance mode is team.".to_string()),
            }],
            default_value: Some("team".to_string()),
            persist_as_rule_name: Some("governance_mode".to_string()),
        }];
        let empty_manifest = make_manifest(
            "empty-plugin",
            vec![],
            std::collections::HashMap::new(),
            None,
        );

        let questions = collect_setup_questions(&[manifest, empty_manifest]);

        assert_eq!(questions.len(), 2);
        assert_eq!(questions[0]["plugin"], "mcpviews-core");
        assert_eq!(questions[1]["plugin"], "governance-plugin");
        assert_eq!(questions[1]["questions"][0]["id"], "governance_mode");
        assert_eq!(
            questions[1]["questions"][0]["options"][0]["persisted_rule"],
            "Default governance mode is team."
        );
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
                    email_code_auth: None,
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
        assert!(status[0]["message"]
            .as_str()
            .unwrap()
            .contains("requires authentication"));
    }

    #[test]
    fn test_collect_plugin_auth_status_dedupes_duplicate_plugin_manifests() {
        let manifest = make_manifest(
            "ludflow",
            vec![],
            std::collections::HashMap::new(),
            Some(PluginMcpConfig {
                url: "http://localhost:8080".into(),
                auth: Some(PluginAuth::OAuth {
                    client_id: Some("client123".into()),
                    auth_url: "https://example.com/auth".into(),
                    token_url: "https://example.com/token".into(),
                    scopes: vec![],
                    email_code_auth: None,
                }),
                tool_prefix: "lf".into(),
            }),
        );

        let status = collect_plugin_auth_status(&[manifest.clone(), manifest]);

        assert_eq!(status.len(), 1);
        assert_eq!(status[0]["plugin"], "ludflow");
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
        assert!(instr.contains("setup_questions"));
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
            standalone_group: None,
            standalone_group_label: None,
            renderers,
            frame_origins: vec![],
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
            setup_questions: vec![],
        }
    }

    #[test]
    fn test_synthesize_with_tool_cache_data() {
        let mut renderers_map = std::collections::HashMap::new();
        renderers_map.insert("search_codebase".to_string(), "search_results".to_string());
        let manifest = make_manifest_with_renderers("ludflow", renderers_map, "ludflow__");

        let cached_tools = vec![serde_json::json!({
            "name": "ludflow__search_codebase",
            "description": "Search the codebase for matching code"
        })];

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

        let cached_tools = vec![serde_json::json!({
            "name": "ludflow__search_codebase",
            "description": "Search the codebase"
        })];

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
        assert!(instr.contains("update it rather than adding a duplicate"));
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
        assert_eq!(
            summaries[0]["description"],
            "Display rich markdown content in the MCPViews window."
        );
        // Should NOT include inputSchema
        assert!(summaries[0].get("inputSchema").is_none());
        assert_eq!(summaries[1]["name"], "push_review");
    }

    #[test]
    fn test_builtin_tool_definitions_include_direct_renderer_tools() {
        let renderers = builtin_renderer_definitions();
        let tools = builtin_tool_definitions(&renderers);
        let rich_content = tools
            .iter()
            .find(|t| t["name"] == "rich_content")
            .expect("rich_content tool should exist");
        let structured_data = tools
            .iter()
            .find(|t| t["name"] == "structured_data")
            .expect("structured_data tool should exist");
        let universal_graph = tools
            .iter()
            .find(|t| t["name"] == "universal_graph")
            .expect("universal_graph tool should exist");
        assert_eq!(rich_content["inputSchema"]["type"], "object");
        assert_eq!(
            structured_data["inputSchema"]["required"],
            serde_json::json!(["tables"])
        );
        assert_eq!(
            universal_graph["inputSchema"]["required"],
            serde_json::json!(["graphs"])
        );
        assert!(
            tools.iter().any(|tool| tool["name"] == "push_content"),
            "push_content compatibility alias should remain available locally"
        );
    }

    #[test]
    fn test_filter_hosted_model_facing_tools_hides_push_content_alias() {
        let filtered = filter_hosted_model_facing_tools(vec![
            serde_json::json!({ "name": "rich_content" }),
            serde_json::json!({ "name": "structured_data" }),
            serde_json::json!({ "name": "universal_graph" }),
            serde_json::json!({ "name": "push_content" }),
            serde_json::json!({ "name": "push_review" }),
        ]);
        let tool_names = filtered
            .iter()
            .filter_map(|tool| tool.get("name").and_then(|value| value.as_str()))
            .collect::<Vec<_>>();
        assert!(tool_names.contains(&"rich_content"));
        assert!(tool_names.contains(&"structured_data"));
        assert!(tool_names.contains(&"universal_graph"));
        assert!(tool_names.contains(&"push_review"));
        assert!(!tool_names.contains(&"push_content"));
    }

    #[test]
    fn test_build_core_hosted_connector_prefers_direct_renderer_tools() {
        let connector = build_core_hosted_connector(&[
            serde_json::json!({ "name": "rich_content" }),
            serde_json::json!({ "name": "structured_data" }),
            serde_json::json!({ "name": "universal_graph" }),
            serde_json::json!({ "name": "push_review" }),
            serde_json::json!({ "name": "describe_connector" }),
        ])
        .expect("core connector should exist");

        let presentation_tools = connector["toolGroups"][0]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool.get("name").and_then(|value| value.as_str()))
            .collect::<Vec<_>>();

        assert!(presentation_tools.contains(&"rich_content"));
        assert!(presentation_tools.contains(&"structured_data"));
        assert!(presentation_tools.contains(&"universal_graph"));
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

        assert_eq!(
            direct_names,
            vec!["rich_content", "structured_data", "universal_graph"]
        );

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
    fn test_builtin_rules_include_universal_graph_agent_discovery_guidance() {
        let renderers = builtin_renderer_definitions();
        let rules = collect_builtin_rules(&renderers);
        let graph_rule = rules
            .iter()
            .find(|rule| rule["name"] == "universal_graph_usage")
            .expect("universal_graph_usage rule should be present");
        let text = graph_rule["rule"].as_str().unwrap();

        assert!(text.contains("direct `universal_graph` tool"));
        assert!(text.contains("rich_content review payloads"));
        assert!(text.contains("axis labels/descriptions"));
        assert!(text.contains("uniform side slope"));
        assert!(text.contains("vertical thickness"));
        assert!(text.contains("visible custom tooltips"));
        assert!(text.contains("Data table"));
    }

    #[test]
    fn test_rules_version_and_persistence_marker_are_updated() {
        assert_eq!(RULES_VERSION, "18");
        let instructions = persistence_instructions("codex");
        assert!(instructions.contains("mcpviews-rules-version: 18"));
        assert!(instructions.contains("Add or update the MCPViews section in `AGENTS.md`"));
        assert!(instructions.contains("missing from the persisted rules"));
    }

    #[test]
    fn test_review_rules_require_human_readable_targets() {
        let renderers = builtin_renderer_definitions();
        let rules = collect_builtin_rules(&renderers);

        let renderer_selection = rules
            .iter()
            .find(|rule| rule["name"] == "renderer_selection")
            .expect("renderer_selection rule should exist");
        let bulk_action_review = rules
            .iter()
            .find(|rule| rule["name"] == "bulk_action_review")
            .expect("bulk_action_review rule should exist");
        let structured_data = rules
            .iter()
            .find(|rule| rule["name"] == "structured_data_usage")
            .expect("structured_data_usage rule should exist");

        assert!(renderer_selection["rule"]
            .as_str()
            .unwrap()
            .contains("human-readable name"));
        assert!(bulk_action_review["rule"]
            .as_str()
            .unwrap()
            .contains("Do NOT put an opaque backend ID"));
        assert!(bulk_action_review["rule"]
            .as_str()
            .unwrap()
            .contains("Do not interrupt the user with a review for every small"));
        assert!(bulk_action_review["rule"]
            .as_str()
            .unwrap()
            .contains("Count alone is not a review trigger"));
        assert!(bulk_action_review["rule"]
            .as_str()
            .unwrap()
            .contains("Routine low-risk creates and minor edits do not require a review"));
        assert!(bulk_action_review["rule"]
            .as_str()
            .unwrap()
            .contains("Destructive or hard-to-undo change"));
        assert!(bulk_action_review["rule"]
            .as_str()
            .unwrap()
            .contains("Ambiguous or user-editable batch"));
        assert!(structured_data["rule"]
            .as_str()
            .unwrap()
            .contains("Visible review cells"));
    }

    #[test]
    fn test_push_review_tool_definition_requires_human_readable_targets() {
        let renderers = builtin_renderer_definitions();
        let tools = builtin_registry::builtin_tool_definitions(&renderers);
        let push_review = tools
            .iter()
            .find(|tool| tool["name"] == "push_review")
            .expect("push_review tool should exist");

        let description = push_review["description"].as_str().unwrap();
        assert!(description.contains("human-readable names"));
        assert!(description.contains("opaque backend IDs"));
    }

    #[test]
    fn test_universal_graph_tool_definition_describes_agent_facing_features() {
        let renderers = builtin_renderer_definitions();
        let tools = builtin_registry::builtin_tool_definitions(&renderers);
        let graph_tool = tools
            .iter()
            .find(|tool| tool["name"] == "universal_graph")
            .expect("universal_graph tool should exist");

        let description = graph_tool["description"].as_str().unwrap();
        let graphs_description = graph_tool["inputSchema"]["properties"]["graphs"]["description"]
            .as_str()
            .unwrap();

        assert!(description.contains("standalone graph packs"));
        assert!(description.contains("rich_content embeds"));
        assert!(graphs_description.contains("axes provide x/y labels"));
        assert!(graphs_description.contains("interactions may include details"));
        assert!(graphs_description.contains("Dense graphs auto-summarize"));
        assert!(graphs_description.contains("funnels use uniform side slope"));
    }

    #[test]
    fn test_build_core_hosted_connector_uses_registry_group_metadata() {
        let renderers = builtin_renderer_definitions();
        let available_tools =
            extract_tool_summaries(&builtin_registry::builtin_tool_definitions(&renderers));
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
    fn test_core_hosted_connector_exposes_graph_breadcrumb_capabilities() {
        let renderers = builtin_renderer_definitions();
        let available_tools = extract_tool_summaries_with_schema(
            &builtin_registry::builtin_tool_definitions(&renderers),
        );
        let connector =
            build_core_hosted_connector(&available_tools).expect("core connector should exist");

        let capabilities = connector["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>();
        assert!(capabilities.contains(&"universal-graph"));
        assert!(capabilities.contains(&"graph-analytics"));
        assert!(capabilities.contains(&"rich-content-embeds"));

        let presentation = connector["toolGroups"]
            .as_array()
            .unwrap()
            .iter()
            .find(|group| group["name"] == "Presentation")
            .expect("Presentation group should exist");
        assert!(presentation["hint"]
            .as_str()
            .unwrap()
            .contains("graph packs"));

        let tool_names = presentation["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool.get("name").and_then(|value| value.as_str()))
            .collect::<Vec<_>>();
        assert!(tool_names.contains(&"rich_content"));
        assert!(tool_names.contains(&"structured_data"));
        assert!(tool_names.contains(&"universal_graph"));
        assert!(tool_names.contains(&"push_review"));
        assert!(tool_names.contains(&"await_review"));
        assert!(tool_names.contains(&"push_check"));
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
        let tools = vec![serde_json::json!({ "name": "no_desc_tool" })];
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

        state
            .install_plugin_from_manifest(manifest_v1, false)
            .unwrap();
        {
            let registry = state.plugin_registry.lock().unwrap();
            assert_eq!(registry.manifests.len(), 1);
        }

        let mut manifest_v2 = crate::test_utils::test_manifest("upsert-plugin");
        manifest_v2.version = "2.0.0".to_string();
        state
            .install_plugin_from_manifest(manifest_v2, false)
            .unwrap();

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
        assert_eq!(
            result.unwrap_err(),
            "Missing required parameter: manifest_json"
        );
    }

    // ─── schema description tests ───

    #[test]
    fn test_install_plugin_schema_download_url_description() {
        let tools = builtin_tool_definitions(&[]);
        let install_tool = tools
            .iter()
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
        tool_rules.insert(
            "search_codebase".to_string(),
            "Use search for queries.".to_string(),
        );
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
        let manifest = make_manifest(
            "test-plugin",
            vec![],
            std::collections::HashMap::new(),
            None,
        );
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
        let manifest = make_manifest(
            "test-plugin",
            vec![],
            std::collections::HashMap::new(),
            None,
        );
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
        let group = index
            .tool_groups
            .iter()
            .find(|g| g.tools.contains(&"search_codebase".to_string()))
            .unwrap();
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
        let manifest = make_manifest(
            "test-plugin",
            vec![],
            std::collections::HashMap::new(),
            None,
        );
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
        let manifest = make_manifest(
            "test-plugin",
            vec![],
            std::collections::HashMap::new(),
            None,
        );
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
        let mut manifest = make_manifest(
            "test-plugin",
            vec![],
            std::collections::HashMap::new(),
            None,
        );
        manifest.version = "3.0.0".to_string();
        let entry = mcpviews_shared::RegistryEntry {
            name: "test-plugin".to_string(),
            version: "2.0.0".to_string(),
            description: "Test".to_string(),
            author: None,
            homepage: None,
            manifest: make_manifest(
                "test-plugin",
                vec![],
                std::collections::HashMap::new(),
                None,
            ),
            tags: vec![],
            download_url: None,
            manifest_url: None,
        };
        let updates = collect_plugin_updates(&[manifest], &[entry]);
        assert!(updates.is_empty());
    }

    #[test]
    fn test_collect_plugin_updates_no_matching_entry() {
        let manifest = make_manifest(
            "test-plugin",
            vec![],
            std::collections::HashMap::new(),
            None,
        );
        let updates = collect_plugin_updates(&[manifest], &[]);
        assert!(updates.is_empty());
    }

    // ─── update_plugins tool definition test ───

    #[test]
    fn test_update_plugins_tool_defined() {
        let renderers = builtin_renderer_definitions();
        let tools = builtin_tool_definitions(&renderers);
        let update_tool = tools.iter().find(|t| t["name"] == "update_plugins");
        assert!(
            update_tool.is_some(),
            "update_plugins tool should be defined"
        );
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
        assert!(schema["properties"]["auth_flow"].is_object());
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
                    email_code_auth: None,
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
            tempfile::tempdir().unwrap().keep(),
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
        store
            .save_preferences(
                "auto-plugin",
                &mcpviews_shared::PluginPreferences {
                    update_policy: "always".to_string(),
                    update_policy_version: None,
                    update_policy_source: "chat".to_string(),
                },
            )
            .unwrap();
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
        store
            .save_preferences(
                "skip-plugin",
                &mcpviews_shared::PluginPreferences {
                    update_policy: "skip".to_string(),
                    update_policy_version: Some("2.0.0".to_string()),
                    update_policy_source: "chat".to_string(),
                },
            )
            .unwrap();
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
        store
            .save_preferences(
                "skip-plugin",
                &mcpviews_shared::PluginPreferences {
                    update_policy: "skip".to_string(),
                    update_policy_version: Some("2.0.0".to_string()),
                    update_policy_source: "chat".to_string(),
                },
            )
            .unwrap();
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
        store
            .save_preferences(
                "always-plugin",
                &mcpviews_shared::PluginPreferences {
                    update_policy: "always".to_string(),
                    update_policy_version: None,
                    update_policy_source: "chat".to_string(),
                },
            )
            .unwrap();
        store
            .save_preferences(
                "skip-plugin",
                &mcpviews_shared::PluginPreferences {
                    update_policy: "skip".to_string(),
                    update_policy_version: Some("2.0.0".to_string()),
                    update_policy_source: "chat".to_string(),
                },
            )
            .unwrap();
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
    fn test_extract_push_params_accepts_backend_callback_outside_renderer_meta() {
        let args = serde_json::json!({
            "tool_name": "structured_data",
            "data": {"tables": []},
            "meta": {"key": "val"},
            "backend_callback": {
                "url": "https://example.test/reviews/1",
                "token": "secret-token"
            }
        });
        let params = extract_push_params(&args, true).unwrap();
        assert_eq!(
            params.meta,
            Some(serde_json::json!({
                "key": "val",
                "backendCallback": {
                    "url": "https://example.test/reviews/1",
                    "token": "secret-token"
                }
            }))
        );
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
    fn test_extract_push_params_warns_for_large_inline_renderer_rows() {
        let rows = (0..201)
            .map(|index| {
                serde_json::json!({
                    "id": format!("row_{}", index),
                    "cells": {
                        "name": { "value": format!("Row {}", index), "change": null }
                    },
                    "children": []
                })
            })
            .collect::<Vec<_>>();
        let args = serde_json::json!({
            "tool_name": "structured_data",
            "data": {
                "tables": [{
                    "id": "large",
                    "name": "Large",
                    "columns": [{ "id": "name", "name": "Name", "change": null }],
                    "rows": rows
                }]
            }
        });

        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.warnings.len(), 1);
        assert!(params.warnings[0].contains("201 inline table rows"));
        assert!(params.warnings[0].contains("tables[].dataRef"));
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
    fn test_extract_push_params_infers_universal_graph_when_tool_name_is_missing() {
        let args = serde_json::json!({
            "data": {
                "title": "Revenue Trend",
                "graphs": [{
                    "id": "revenue_by_month",
                    "title": "Revenue by Month",
                    "type": "line",
                    "data": {
                        "columns": [
                            { "id": "month", "name": "Month", "type": "date" },
                            { "id": "revenue", "name": "Revenue", "type": "number" }
                        ],
                        "rows": [
                            { "month": "2026-01", "revenue": 120000 },
                            { "month": "2026-02", "revenue": 142000 }
                        ]
                    },
                    "encoding": { "x": "month", "y": "revenue" },
                    "options": {
                        "xScale": "time",
                        "yScale": "linear",
                        "maxVisibleItems": 24,
                        "showAll": false
                    }
                }]
            }
        });
        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.tool_name, "universal_graph");
    }

    #[test]
    fn test_extract_push_params_rejects_invalid_universal_graph_options() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "revenue_by_month",
                    "type": "line",
                    "data": {
                        "columns": [
                            { "id": "month", "name": "Month", "type": "date" },
                            { "id": "revenue", "name": "Revenue", "type": "number" }
                        ],
                        "rows": [{ "month": "2026-01", "revenue": 120000 }]
                    },
                    "encoding": { "x": "month", "y": "revenue" },
                    "options": {
                        "xScale": "log",
                        "maxVisibleItems": 0
                    }
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("xScale `log` is not supported"));
    }

    #[test]
    fn test_extract_push_params_accepts_universal_graph_dense_options() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "histogram_dense",
                    "type": "histogram",
                    "data": {
                        "columns": [{ "id": "value", "name": "Value", "type": "number" }],
                        "rows": [{ "value": 1 }, { "value": 2 }, { "value": 3 }]
                    },
                    "encoding": { "value": "value" },
                    "options": {
                        "binCount": 120,
                        "otherBucket": "hidden",
                        "showAll": true,
                        "showTotal": false,
                        "totalLabel": "Residual"
                    }
                }]
            }
        });
        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.tool_name, "universal_graph");
    }

    #[test]
    fn test_extract_push_params_rejects_invalid_universal_graph_waterfall_options() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "risk_waterfall",
                    "type": "waterfall",
                    "data": {
                        "columns": [
                            { "id": "driver", "name": "Driver" },
                            { "id": "risk", "name": "Risk", "type": "number" }
                        ],
                        "rows": [{ "driver": "Opening", "risk": 96 }]
                    },
                    "encoding": { "label": "driver", "value": "risk" },
                    "options": {
                        "showTotal": false,
                        "totalLabel": ""
                    }
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("totalLabel must not be empty"));
    }

    #[test]
    fn test_extract_push_params_rejects_invalid_universal_graph_show_total_option() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "risk_waterfall",
                    "type": "waterfall",
                    "data": {
                        "columns": [
                            { "id": "driver", "name": "Driver" },
                            { "id": "risk", "name": "Risk", "type": "number" }
                        ],
                        "rows": [{ "driver": "Opening", "risk": 96 }]
                    },
                    "encoding": { "label": "driver", "value": "risk" },
                    "options": { "showTotal": "yes" }
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("showTotal must be a boolean"));
    }

    #[test]
    fn test_extract_push_params_accepts_universal_graph_axis_labels() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "revenue_by_segment",
                    "type": "bar",
                    "data": {
                        "columns": [
                            { "id": "segment", "name": "Segment" },
                            { "id": "revenue", "name": "Revenue", "type": "number" }
                        ],
                        "rows": [{ "segment": "Enterprise", "revenue": 120 }]
                    },
                    "encoding": { "x": "segment", "y": "revenue" },
                    "axes": {
                        "x": { "label": "Customer segment", "description": "CRM commercial segment" },
                        "y": "ARR in thousands of dollars"
                    }
                }]
            }
        });
        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.tool_name, "universal_graph");
    }

    #[test]
    fn test_extract_push_params_rejects_invalid_universal_graph_axis_label() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "revenue_by_segment",
                    "type": "bar",
                    "data": {
                        "columns": [
                            { "id": "segment", "name": "Segment" },
                            { "id": "revenue", "name": "Revenue", "type": "number" }
                        ],
                        "rows": [{ "segment": "Enterprise", "revenue": 120 }]
                    },
                    "encoding": { "x": "segment", "y": "revenue" },
                    "axes": { "z": "Not supported" }
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("axes.z is not supported"));
    }

    #[test]
    fn test_extract_push_params_accepts_universal_graph_interactions() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [
                    {
                        "id": "overview",
                        "type": "bar",
                        "data": {
                            "columns": [
                                { "id": "segment", "name": "Segment" },
                                { "id": "revenue", "name": "Revenue", "type": "number" },
                                { "id": "risk", "name": "Risk", "type": "number" }
                            ],
                            "rows": [
                                { "segment": "Enterprise", "revenue": 120, "risk": 18 },
                                { "segment": "SMB", "revenue": 80, "risk": 29 }
                            ]
                        },
                        "encoding": { "x": "segment", "y": "revenue" },
                        "interactions": {
                            "details": { "titleField": "segment", "fields": ["segment", { "field": "revenue", "label": "ARR" }] },
                            "hover": "auto",
                            "metricControls": { "target": "y", "fields": ["revenue", "risk"] },
                            "drilldowns": [{
                                "id": "accounts",
                                "label": "View accounts",
                                "targetGraphId": "detail",
                                "trigger": "mark",
                                "match": { "source": "segment", "targetField": "segment" }
                            }]
                        }
                    },
                    {
                        "id": "detail",
                        "role": "drilldown",
                        "type": "bar",
                        "data": {
                            "columns": [
                                { "id": "account", "name": "Account" },
                                { "id": "segment", "name": "Segment" },
                                { "id": "arr", "name": "ARR", "type": "number" }
                            ],
                            "rows": [{ "account": "Northstar", "segment": "Enterprise", "arr": 75 }]
                        },
                        "encoding": { "x": "account", "y": "arr" }
                    }
                ]
            }
        });
        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.tool_name, "universal_graph");
    }

    #[test]
    fn test_extract_push_params_rejects_invalid_universal_graph_drilldown_target() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "overview",
                    "type": "bar",
                    "data": {
                        "columns": [
                            { "id": "segment", "name": "Segment" },
                            { "id": "revenue", "name": "Revenue", "type": "number" }
                        ],
                        "rows": [{ "segment": "Enterprise", "revenue": 120 }]
                    },
                    "encoding": { "x": "segment", "y": "revenue" },
                    "interactions": {
                        "drilldowns": [{
                            "id": "missing",
                            "targetGraphId": "missing_detail",
                            "match": { "source": "segment", "targetField": "segment" }
                        }]
                    }
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("targetGraphId references missing graph `missing_detail`"));
    }

    #[test]
    fn test_extract_push_params_rejects_invalid_universal_graph_metric_field() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "overview",
                    "type": "bar",
                    "data": {
                        "columns": [
                            { "id": "segment", "name": "Segment" },
                            { "id": "revenue", "name": "Revenue", "type": "number" }
                        ],
                        "rows": [{ "segment": "Enterprise", "revenue": 120 }]
                    },
                    "encoding": { "x": "segment", "y": "revenue" },
                    "interactions": {
                        "metricControls": { "target": "y", "fields": ["segment", "revenue"] }
                    }
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("segment"));
        assert!(err.contains("numeric field"));
    }

    #[test]
    fn test_extract_push_params_rejects_invalid_universal_graph_numeric_rows() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "bad_scatter",
                    "type": "scatter",
                    "data": {
                        "columns": [
                            { "id": "x", "name": "X", "type": "number" },
                            { "id": "y", "name": "Y", "type": "number" }
                        ],
                        "rows": [{ "x": 1, "y": "not a number" }]
                    },
                    "encoding": { "x": "x", "y": "y" },
                    "options": { "xScale": "linear" }
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("bad_scatter"));
        assert!(err.contains("type `scatter`"));
        assert!(err.contains("data.rows[0].y"));
        assert!(err.contains("finite number"));
    }

    #[test]
    fn test_extract_push_params_rejects_invalid_universal_graph_time_rows() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "bad_timeline",
                    "type": "timeline",
                    "data": {
                        "columns": [
                            { "id": "task", "name": "Task" },
                            { "id": "start", "name": "Start", "type": "date" },
                            { "id": "end", "name": "End", "type": "date" }
                        ],
                        "rows": [{ "task": "Build", "start": "not a date", "end": "2026-01-31" }]
                    },
                    "encoding": { "label": "task", "start": "start", "end": "end" }
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("bad_timeline"));
        assert!(err.contains("type `timeline`"));
        assert!(err.contains("data.rows[0].start"));
        assert!(err.contains("parseable date/time"));
    }

    #[test]
    fn test_extract_push_params_rejects_reversed_universal_graph_timeline_rows() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "backwards_timeline",
                    "type": "timeline",
                    "data": {
                        "columns": [
                            { "id": "task", "name": "Task" },
                            { "id": "start", "name": "Start", "type": "date" },
                            { "id": "end", "name": "End", "type": "date" }
                        ],
                        "rows": [{ "task": "Build", "start": "2026-02-10", "end": "2026-01-01" }]
                    },
                    "encoding": { "label": "task", "start": "start", "end": "end" }
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("backwards_timeline"));
        assert!(err.contains("type `timeline`"));
        assert!(err.contains("data.rows[0].end"));
        assert!(err.contains("greater than or equal to start"));
    }

    #[test]
    fn test_extract_push_params_rejects_universal_graph_missing_network_endpoint() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "bad_network",
                    "type": "network",
                    "data": {
                        "columns": [
                            { "id": "source", "name": "Source" },
                            { "id": "target", "name": "Target" }
                        ],
                        "rows": [{ "source": "A", "target": null }]
                    },
                    "encoding": { "source": "source", "target": "target" }
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("bad_network"));
        assert!(err.contains("type `network`"));
        assert!(err.contains("data.rows[0].target"));
        assert!(err.contains("must be non-empty"));
    }

    #[test]
    fn test_extract_push_params_accepts_valid_universal_graph_renderer_payload() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "title": "Revenue Trend",
                "graphs": [{
                    "id": "revenue_by_month",
                    "title": "Revenue by Month",
                    "type": "line",
                    "data": {
                        "columns": [
                            { "id": "month", "name": "Month", "type": "date" },
                            { "id": "revenue", "name": "Revenue", "type": "number" }
                        ],
                        "rows": [
                            { "month": "2026-01", "revenue": 120000 },
                            { "month": "2026-02", "revenue": 142000 }
                        ]
                    },
                    "encoding": { "x": "month", "y": "revenue" }
                }]
            }
        });
        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.tool_name, "universal_graph");
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
    fn test_extract_push_params_rejects_missing_embedded_universal_graph() {
        let args = serde_json::json!({
            "tool_name": "rich_content",
            "data": {
                "title": "Missing graph",
                "body": "Context\n\n```universal_graph:revenue_by_month\n```"
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("revenue_by_month"));
        assert!(err.contains("data.graphs"));
    }

    #[test]
    fn test_extract_push_params_rejects_non_empty_embedded_universal_graph() {
        let args = serde_json::json!({
            "tool_name": "rich_content",
            "data": {
                "title": "Graph body should be empty",
                "body": "Context\n\n```universal_graph:revenue_by_month\ncustom code\n```",
                "graphs": [{
                    "id": "revenue_by_month",
                    "title": "Revenue by Month",
                    "type": "line",
                    "data": {
                        "columns": [
                            { "id": "month", "name": "Month", "type": "date" },
                            { "id": "revenue", "name": "Revenue", "type": "number" }
                        ],
                        "rows": [{ "month": "2026-01", "revenue": 120000 }]
                    },
                    "encoding": { "x": "month", "y": "revenue" }
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("should be empty"));
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
    fn test_extract_push_params_accepts_valid_rich_content_universal_graph_embed() {
        let args = serde_json::json!({
            "tool_name": "rich_content",
            "data": {
                "title": "Revenue Plan",
                "body": "Here is the trend.\n\n```universal_graph:revenue_by_month\n```",
                "graphs": [{
                    "id": "revenue_by_month",
                    "title": "Revenue by Month",
                    "type": "line",
                    "data": {
                        "columns": [
                            { "id": "month", "name": "Month", "type": "date" },
                            { "id": "revenue", "name": "Revenue", "type": "number" }
                        ],
                        "rows": [
                            { "month": "2026-01", "revenue": 120000 },
                            { "month": "2026-02", "revenue": 142000 }
                        ]
                    },
                    "encoding": { "x": "month", "y": "revenue" }
                }]
            }
        });
        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.tool_name, "rich_content");
    }

    #[test]
    fn test_extract_push_params_rejects_invalid_universal_graph_type() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "map_1",
                    "type": "choropleth",
                    "data": {
                        "columns": [{ "id": "region", "name": "Region" }],
                        "rows": [{ "region": "West" }]
                    },
                    "encoding": { "label": "region", "value": "region" }
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("choropleth"));
        assert!(err.contains("Supported universal_graph types"));
    }

    #[test]
    fn test_extract_push_params_rejects_duplicate_universal_graph_ids() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [
                    {
                        "id": "revenue",
                        "type": "bar",
                        "data": {
                            "columns": [
                                { "id": "month", "name": "Month" },
                                { "id": "revenue", "name": "Revenue" }
                            ],
                            "rows": [{ "month": "Jan", "revenue": 10 }]
                        },
                        "encoding": { "x": "month", "y": "revenue" }
                    },
                    {
                        "id": "revenue",
                        "type": "bar",
                        "data": {
                            "columns": [
                                { "id": "month", "name": "Month" },
                                { "id": "revenue", "name": "Revenue" }
                            ],
                            "rows": [{ "month": "Feb", "revenue": 12 }]
                        },
                        "encoding": { "x": "month", "y": "revenue" }
                    }
                ]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("duplicate graph id `revenue`"));
    }

    #[test]
    fn test_extract_push_params_rejects_universal_graph_missing_required_encoding() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "revenue",
                    "type": "bar",
                    "data": {
                        "columns": [
                            { "id": "month", "name": "Month" },
                            { "id": "revenue", "name": "Revenue" }
                        ],
                        "rows": [{ "month": "Jan", "revenue": 10 }]
                    },
                    "encoding": { "x": "month" }
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("encoding.y is required"));
    }

    #[test]
    fn test_extract_push_params_rejects_universal_graph_missing_column_reference() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "revenue",
                    "type": "line",
                    "data": {
                        "columns": [{ "id": "month", "name": "Month" }],
                        "rows": [{ "month": "Jan", "revenue": 10 }]
                    },
                    "encoding": { "x": "month", "y": "revenue" }
                }]
            }
        });
        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("references missing data column `revenue`"));
    }

    #[test]
    fn test_validate_direct_renderer_payload_ignores_reserved_meta_fields() {
        let mut args = serde_json::json!({
            "title": "Architecture",
            "body": "```mermaid\nflowchart TD\n  A[Browser] --> B[API]\n```",
            "meta": {
                "threadId": "thread-1",
                "chatOutputSource": "tribex-ai-thread-result",
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

    #[test]
    fn test_extract_push_params_accepts_structured_data_data_ref_table() {
        let args = serde_json::json!({
            "tool_name": "structured_data",
            "data": {
                "tables": [{
                    "id": "actions",
                    "name": "Actions",
                    "dataRef": {
                        "dataset_id": "dataset-1",
                        "query_token": "token-1",
                        "recipe": "review_rows"
                    }
                }]
            }
        });

        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(
            params.data["tables"][0]["dataRef"]["dataset_id"],
            "dataset-1"
        );
    }

    #[test]
    fn test_extract_push_params_accepts_universal_graph_data_ref() {
        let args = serde_json::json!({
            "tool_name": "universal_graph",
            "data": {
                "graphs": [{
                    "id": "risk_by_rule",
                    "title": "Risk By Rule",
                    "type": "bar",
                    "dataRef": {
                        "dataset_id": "dataset-1",
                        "query_token": "token-1",
                        "recipe": "group_sum",
                        "params": { "groupBy": "rule", "value": "score" }
                    },
                    "encoding": { "x": "rule", "y": "value" }
                }]
            }
        });

        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(params.data["graphs"][0]["dataRef"]["recipe"], "group_sum");
    }

    #[test]
    fn test_extract_push_params_rejects_unknown_data_ref_recipe() {
        let args = serde_json::json!({
            "tool_name": "structured_data",
            "data": {
                "tables": [{
                    "id": "actions",
                    "dataRef": {
                        "dataset_id": "dataset-1",
                        "query_token": "token-1",
                        "recipe": "invented_recipe"
                    }
                }]
            }
        });

        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("invented_recipe"));
    }

    #[test]
    fn test_extract_push_params_rejects_data_ref_without_query_token() {
        let args = serde_json::json!({
            "tool_name": "structured_data",
            "data": {
                "tables": [{
                    "id": "actions",
                    "dataRef": {
                        "dataset_id": "dataset-1",
                        "recipe": "review_rows"
                    }
                }]
            }
        });

        let err = extract_push_params(&args, false).unwrap_err();
        assert!(err.contains("query_token"));
    }

    #[test]
    fn test_extract_push_params_accepts_instruction_template() {
        let args = serde_json::json!({
            "tool_name": "rich_content",
            "data": {
                "title": "Review",
                "body": "Review body.",
                "instructionTemplate": {
                    "id": "audit_only_evidence_review_v1",
                    "variables": { "reviewer": "Risk committee" }
                }
            }
        });

        let params = extract_push_params(&args, false).unwrap();
        assert_eq!(
            params.data["instructionTemplate"]["id"],
            "audit_only_evidence_review_v1"
        );
    }
}
