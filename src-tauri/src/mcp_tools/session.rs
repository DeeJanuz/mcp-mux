use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::AsyncAppState;

async fn gather_session_data(
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> (Vec<Value>, Vec<Value>, Vec<Value>) {
    let all_tools = super::list_tools(state).await;
    let available_tools = super::extract_tool_summaries(&all_tools);

    let state_guard = state.lock().await;
    let all_renderers = super::available_renderers(&state_guard.inner);
    let registry = state_guard.inner.plugin_registry.lock().unwrap();
    let rules = super::collect_rules(&all_renderers, &registry.manifests);
    let plugin_status = super::collect_plugin_auth_status(&registry.manifests);
    (rules, plugin_status, available_tools)
}

async fn gather_slim_session_data(
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> (Vec<Value>, Vec<Value>, Vec<Value>, Vec<Value>, Value, Value) {
    super::ensure_registry_fresh(state).await;

    let state_guard = state.lock().await;
    let all_renderers = super::available_renderers(&state_guard.inner);
    let registry = state_guard.inner.plugin_registry.lock().unwrap();
    let cached_registry = state_guard.inner.latest_registry.lock().unwrap();
    let rules = super::collect_builtin_rules(&all_renderers);
    let plugin_status = super::collect_plugin_auth_status(&registry.manifests);
    let org_tokens = super::collect_org_tokens(&registry.manifests);
    let plugin_registry = super::build_plugin_registry(&registry.manifests, &registry.tool_cache);
    let plugin_updates = super::collect_plugin_updates(&registry.manifests, &cached_registry);

    let store = state_guard.inner.plugin_store();
    let plugin_update_actions = super::evaluate_update_preferences(&plugin_updates, store);

    (
        rules,
        plugin_status,
        plugin_registry,
        plugin_updates,
        plugin_update_actions,
        org_tokens,
    )
}

pub(super) async fn call_init_session(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let agent_type = arguments
        .get("agent_type")
        .and_then(|v| v.as_str())
        .unwrap_or("generic");

    let (rules, plugin_status, plugin_registry, plugin_updates, plugin_update_actions, org_tokens) =
        gather_slim_session_data(state).await;

    let mut response = serde_json::json!({
        "rules": rules,
        "rules_version": super::RULES_VERSION,
        "plugin_status": plugin_status,
        "org_tokens": org_tokens,
        "persistence_instructions": super::persistence_instructions(agent_type),
        "plugin_registry": plugin_registry,
        "plugin_updates": plugin_updates,
        "plugin_update_actions": plugin_update_actions,
    });

    response.as_object_mut().unwrap().insert(
        "rules_update".to_string(),
        serde_json::json!({
            "current_version": super::RULES_VERSION,
            "instruction": format!(
                "Check if your persisted MCPViews rules file contains `mcpviews-rules-version: {}`. \
                 If the version is missing or different, refresh persisted rules by running `mcpviews_setup` \
                 for the current agent type, because this slim init_session response only includes built-in \
                 rules. Use `get_plugin_docs` for plugin-specific details during a task, or `mcpviews_setup` \
                 when installed or updated plugins add rule details that are missing from persisted rules. \
                 Update the existing MCPViews rules section rather than appending a duplicate.",
                super::RULES_VERSION
            )
        }),
    );

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&response).unwrap()
        }]
    }))
}

pub(crate) fn setup_instructions(agent_type: &str) -> String {
    match agent_type {
        "claude_code" => "Add or update a rule in `.claude/rules/mcpviews-init.md` containing: 'IMPORTANT: At the start of every conversation, chat session, or interaction, call the `init_session` MCP tool to initialize MCPViews and get current renderer definitions, behavioral rules, plugin auth status, and the list of available tools. This must happen every time — not just once.' If this rule already exists, update the existing MCPViews rule rather than adding a duplicate, especially when setup is rerun after installed plugins add or change rule details.".to_string(),
        "claude_desktop" => "Create or update a memory: 'IMPORTANT: At the start of every conversation, chat session, or interaction, call the `init_session` MCP tool to initialize MCPViews and get current renderer definitions, rules, and the list of available tools. This must happen every time — not just once.' If this memory already exists, update the existing MCPViews memory rather than adding a duplicate, especially when setup is rerun after installed plugins add or change rule details.".to_string(),
        "cursor" => "Add or update `.cursor/rules/mcpviews-init.mdc`: 'IMPORTANT: At the start of every conversation, chat session, or interaction, call the `init_session` MCP tool to initialize MCPViews and get current renderer definitions, rules, and the list of available tools. This must happen every time — not just once.' If this rule already exists, update the existing MCPViews rule rather than adding a duplicate, especially when setup is rerun after installed plugins add or change rule details.".to_string(),
        "codex" | "opencode" | "antigravity" => "Add or update the MCPViews section in `AGENTS.md`: 'IMPORTANT: At the start of every conversation, chat session, or interaction, call the `init_session` MCP tool to initialize MCPViews and get current renderer definitions, rules, and the list of available tools. This must happen every time — not just once.' If this section already exists, update it rather than adding a duplicate, especially when setup is rerun after installed plugins add or change rule details.".to_string(),
        "windsurf" => "Add or update the MCPViews section in `.windsurfrules`: 'IMPORTANT: At the start of every conversation, chat session, or interaction, call the `init_session` MCP tool to initialize MCPViews and get current renderer definitions, rules, and the list of available tools. This must happen every time — not just once.' If this section already exists, update it rather than adding a duplicate, especially when setup is rerun after installed plugins add or change rule details.".to_string(),
        _ => "Ask the user how to persist or update a rule that calls `init_session` at the start of every conversation, chat session, or interaction — not just once, but every time. If an MCPViews rule already exists, update that existing rule instead of adding a duplicate, especially when setup is rerun after installed plugins add or change rule details.".to_string(),
    }
}

pub(super) async fn call_mcpviews_setup(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let agent_type = arguments
        .get("agent_type")
        .and_then(|v| v.as_str())
        .unwrap_or("generic");

    let (rules, plugin_status, available_tools) = gather_session_data(state).await;

    let response = serde_json::json!({
        "rules": rules,
        "rules_version": super::RULES_VERSION,
        "plugin_status": plugin_status,
        "persistence_instructions": super::persistence_instructions(agent_type),
        "setup_instructions": setup_instructions(agent_type),
        "rules_update": {
            "current_version": super::RULES_VERSION,
            "instruction": "If persisted MCPViews rules already exist, update the existing MCPViews section or memories with this setup response when the version marker is missing/different or when installed/updated plugins add rule details that are absent. Do not append duplicate MCPViews rules."
        },
        "available_tools": available_tools,
    });

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&response).unwrap()
        }]
    }))
}

pub(super) async fn call_get_plugin_docs(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let plugin_name = arguments
        .get("plugin")
        .and_then(|v| v.as_str())
        .ok_or("Missing required parameter: plugin")?;

    let groups_filter: Option<Vec<String>> = arguments
        .get("groups")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());

    let tools_filter: Option<Vec<String>> = arguments
        .get("tools")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());

    let renderers_filter: Option<Vec<String>> = arguments
        .get("renderers")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());

    let state_guard = state.lock().await;
    let all_renderers = super::available_renderers(&state_guard.inner);
    let registry = state_guard.inner.plugin_registry.lock().unwrap();

    let (_, manifest) = registry
        .find_plugin_by_name(plugin_name)
        .ok_or_else(|| format!("Plugin '{}' not found", plugin_name))?;

    let mut expanded_tools: Vec<String> = Vec::new();
    if let Some(groups) = &groups_filter {
        if let Some(ri) = &manifest.registry_index {
            for group in &ri.tool_groups {
                if groups.iter().any(|g| g.eq_ignore_ascii_case(&group.name)) {
                    expanded_tools.extend(group.tools.clone());
                }
            }
        }
        if manifest.registry_index.is_none() {
            let cached_tools = registry
                .tool_cache
                .plugin_tools(registry.manifests.iter().position(|m| m.name == plugin_name).unwrap_or(0));
            let derived = super::auto_derive_registry_index(manifest, cached_tools);
            for group in &derived.tool_groups {
                if groups.iter().any(|g| g.eq_ignore_ascii_case(&group.name)) {
                    expanded_tools.extend(group.tools.clone());
                }
            }
        }
    }

    let final_tool_filter = if expanded_tools.is_empty() {
        tools_filter.as_deref()
    } else {
        if let Some(extra) = &tools_filter {
            expanded_tools.extend(extra.clone());
        }
        Some(expanded_tools.as_slice())
    };

    let rules = super::collect_plugin_rules(
        &all_renderers,
        manifest,
        final_tool_filter,
        renderers_filter.as_deref(),
    );

    let response = serde_json::json!({
        "plugin": plugin_name,
        "rules": rules,
    });

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&response).unwrap()
        }]
    }))
}
