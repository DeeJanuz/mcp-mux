use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::AsyncAppState;

async fn gather_session_data(
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> (Vec<Value>, Vec<Value>, Vec<Value>, Vec<Value>) {
    let all_tools = super::list_tools(state).await;
    let available_tools = super::extract_tool_summaries(&all_tools);

    let state_guard = state.lock().await;
    let all_renderers = super::available_renderers(&state_guard.inner);
    let registry = state_guard.inner.plugin_registry.lock().unwrap();
    let store = state_guard.inner.plugin_store();
    let rules = super::collect_rules(&all_renderers, &registry.manifests);
    let plugin_status = super::collect_plugin_auth_status(&registry.manifests);
    let setup_questions = super::collect_setup_questions(&registry.manifests, store);
    (rules, plugin_status, available_tools, setup_questions)
}

async fn gather_slim_session_data(
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> (Vec<Value>, Vec<Value>, Vec<Value>, Vec<Value>, Value, Value) {
    super::ensure_registry_fresh(state).await;

    let state_guard = state.lock().await;
    let all_renderers = super::available_renderers(&state_guard.inner);
    let registry = state_guard.inner.plugin_registry.lock().unwrap();
    let cached_registry = state_guard.inner.latest_registry.lock().unwrap();
    let store = state_guard.inner.plugin_store();
    let mut rules = super::collect_builtin_rules(&all_renderers);
    rules.extend(super::collect_saved_setup_rules(&registry.manifests, store));
    let plugin_status = super::collect_plugin_auth_status(&registry.manifests);
    let org_tokens = super::collect_org_tokens(&registry.manifests);
    let plugin_registry = super::build_plugin_registry(&registry.manifests, &registry.tool_cache);
    let plugin_updates = super::collect_plugin_updates(&registry.manifests, &cached_registry);

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
    let project_path = arguments.get("project_path").and_then(|v| v.as_str());

    let (rules, plugin_status, plugin_registry, plugin_updates, plugin_update_actions, org_tokens) =
        gather_slim_session_data(state).await;
    let startup_rule_actions =
        startup_rule_actions_for_project(agent_type, project_path, state).await?;

    let mut response = serde_json::json!({
        "rules": rules,
        "rules_version": super::RULES_VERSION,
        "plugin_status": plugin_status,
        "org_tokens": org_tokens,
        "persistence_instructions": super::persistence_instructions(agent_type),
        "plugin_registry": plugin_registry,
        "plugin_updates": plugin_updates,
        "plugin_update_actions": plugin_update_actions,
        "startup_rule_actions": startup_rule_actions,
    });

    response.as_object_mut().unwrap().insert(
        "rules_update".to_string(),
        serde_json::json!({
            "current_version": super::RULES_VERSION,
            "instruction": "Runtime MCPViews rules are session breadcrumbs only. Do not persist the `rules` array, plugin_rules, renderer rules, DecidR/Ludflow workflow guidance, setup questions, plugin docs, or tool docs into native startup rule files. Reconcile only `startup_rule_actions` into harness-native startup rules, then record state with save_startup_rule_state."
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
        "claude_code" => "Install or update only entries returned in `startup_rule_actions.needs_install` and `startup_rule_actions.auto_update` into `.claude/rules/mcpviews-startup.md`, then call `save_startup_rule_state`. Do not persist runtime MCPViews rules or plugin_rules.".to_string(),
        "claude_desktop" => "Create or update only startup-rule memories for entries returned in `startup_rule_actions.needs_install` and `startup_rule_actions.auto_update`, then call `save_startup_rule_state`. Do not persist runtime MCPViews rules or plugin_rules.".to_string(),
        "cursor" => "Install or update only entries returned in `startup_rule_actions.needs_install` and `startup_rule_actions.auto_update` into `.cursor/rules/mcpviews-startup.mdc`, then call `save_startup_rule_state`. Do not persist runtime MCPViews rules or plugin_rules.".to_string(),
        "codex" | "opencode" | "antigravity" => "Install or update only entries returned in `startup_rule_actions.needs_install` and `startup_rule_actions.auto_update` in the managed `## MCPViews Startup Rules` block of the `AGENTS.md` at the supplied `project_path`, then call `save_startup_rule_state`. Use `startup_rule_actions.native_rule_file_path` as the exact target. If an old `<!-- mcpviews-rules-version: ... -->` MCPViews block exists, replace that managed block with startup rules only. If `startup_rule_actions.codex_rule_file_context.warnings` mentions parent-only or nested AGENTS files, follow that warning before treating rules as installed. Do not persist runtime MCPViews rules or plugin_rules.".to_string(),
        "windsurf" => "Install or update only entries returned in `startup_rule_actions.needs_install` and `startup_rule_actions.auto_update` in `.windsurfrules`, then call `save_startup_rule_state`. Do not persist runtime MCPViews rules or plugin_rules.".to_string(),
        _ => "Ask the user which native startup-rule mechanism to use for entries returned in `startup_rule_actions.needs_install` and `startup_rule_actions.auto_update`, then call `save_startup_rule_state`. Do not persist runtime MCPViews rules or plugin_rules.".to_string(),
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
    let project_path = arguments.get("project_path").and_then(|v| v.as_str());

    let (rules, plugin_status, available_tools, setup_questions) = gather_session_data(state).await;
    let startup_rule_actions =
        startup_rule_actions_for_project(agent_type, project_path, state).await?;

    let response = serde_json::json!({
        "rules": rules,
        "rules_version": super::RULES_VERSION,
        "plugin_status": plugin_status,
        "setup_questions": setup_questions,
        "setup_question_instructions": super::SETUP_QUESTION_INSTRUCTIONS,
        "startup_rule_actions": startup_rule_actions,
        "persistence_instructions": super::persistence_instructions(agent_type),
        "setup_instructions": setup_instructions(agent_type),
        "rules_update": {
            "current_version": super::RULES_VERSION,
            "instruction": "Do not persist this setup response's runtime `rules` array into native startup rule files. Use only `startup_rule_actions` for native startup-rule installation/update, and keep plugin_rules as runtime workflow breadcrumbs."
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

async fn startup_rule_actions_for_project(
    agent_type: &str,
    project_path: Option<&str>,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let Some(project_path) = project_path else {
        return Ok(project_path_required_startup_rule_actions());
    };

    let (manifests, store) = {
        let state_guard = state.lock().await;
        let registry = state_guard.inner.plugin_registry.lock().unwrap();
        (
            registry.manifests.clone(),
            state_guard.inner.plugin_store().clone(),
        )
    };
    let project_path = PathBuf::from(project_path);
    let config = super::startup_rules::load_or_create_project_config(&project_path)?;
    let resolved_rules = super::startup_rules::resolve_all_startup_rules(&manifests, &store);
    let config_path = super::startup_rules::project_config_path(&project_path);
    let mut actions = super::startup_rules::evaluate_startup_rule_actions(&config, &resolved_rules);
    actions["project_path"] = serde_json::json!(project_path.display().to_string());
    actions["config_path"] = serde_json::json!(config_path.display().to_string());
    if matches!(agent_type, "codex" | "opencode" | "antigravity") {
        let native_rule_file_path = project_path.join(super::startup_rules::CODEX_NATIVE_RULE_FILE);
        let existing_native_rule_file = std::fs::read_to_string(&native_rule_file_path).ok();
        actions["native_rule_file"] =
            serde_json::json!(super::startup_rules::CODEX_NATIVE_RULE_FILE);
        actions["native_rule_file_path"] =
            serde_json::json!(native_rule_file_path.display().to_string());
        actions["native_rule_block"] = serde_json::json!(
            super::startup_rules::build_codex_startup_rules_block_for_project(
                &config,
                &resolved_rules,
                existing_native_rule_file.as_deref(),
            )
        );
        actions["codex_rule_file_context"] =
            super::startup_rules::codex_native_rule_context(&project_path);
        actions["native_rule_block_instruction"] = serde_json::json!(
            format!(
                "For Codex-style agents, install/update the returned `## MCPViews Startup Rules` block in `{}` for the supplied project_path. Replace any managed `## MCPViews` block containing `<!-- mcpviews-rules-version: ... -->` in that file. Preserve user-authored content outside managed MCPViews blocks. The block must contain startup rules only. Do not treat a parent AGENTS.md install as sufficient for a nested Codex project; rerun setup with the nested project_path and install there too.",
                native_rule_file_path.display()
            )
        );
    }
    Ok(actions)
}

fn project_path_required_startup_rule_actions() -> Value {
    serde_json::json!({
        "status": "project_path_required",
        "needs_install": [],
        "auto_update": [],
        "suppressed": [],
        "current": [],
        "orphaned": [],
        "instruction": "No project_path was provided. Rerun init_session or mcpviews_setup with project_path set to the current project root before treating startup rules as reconciled. Startup rules cannot be evaluated against mcpviews-init.json without a project_path."
    })
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
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        });

    let tools_filter: Option<Vec<String>> =
        arguments
            .get("tools")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            });

    let renderers_filter: Option<Vec<String>> = arguments
        .get("renderers")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        });

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
            let cached_tools = registry.tool_cache.plugin_tools(
                registry
                    .manifests
                    .iter()
                    .position(|m| m.name == plugin_name)
                    .unwrap_or(0),
            );
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
        groups_filter.as_deref(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_missing_project_path_requires_project_specific_init() {
        let actions = project_path_required_startup_rule_actions();

        assert_eq!(actions["status"], "project_path_required");
        assert!(actions["needs_install"].as_array().unwrap().is_empty());
        assert!(actions["instruction"]
            .as_str()
            .unwrap()
            .contains("Rerun init_session or mcpviews_setup with project_path"));
    }

    #[test]
    fn test_setup_instructions_are_startup_rule_only() {
        let instructions = setup_instructions("codex");

        assert!(instructions.contains("startup_rule_actions.needs_install"));
        assert!(instructions.contains("MCPViews Startup Rules"));
        assert!(instructions.contains("native_rule_file_path"));
        assert!(instructions.contains("save_startup_rule_state"));
        assert!(!instructions.contains("renderer rules"));
        assert!(!instructions.contains("all rules below"));
    }
}
