use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{timeout, Duration};

use crate::http_server::AsyncAppState;
use crate::plugin::{oauth_token_needs_preemptive_refresh, try_refresh_oauth, OAuthRefreshInfo};
use crate::state::AppState;

const DEFAULT_PLUGIN_INIT_CONTEXT_TIMEOUT_MS: u64 = 1_200;

#[derive(Debug, Clone)]
struct PluginInitContextProvider {
    plugin_name: String,
    mcp_url: String,
    auth: Option<mcpviews_shared::PluginAuth>,
    config: mcpviews_shared::PluginInitContext,
}

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

async fn gather_startup_session_data(
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> (Vec<Value>, Vec<Value>, Value, Value) {
    super::ensure_registry_fresh(state).await;

    let state_guard = state.lock().await;
    let registry = state_guard.inner.plugin_registry.lock().unwrap();
    let cached_registry = state_guard.inner.latest_registry.lock().unwrap();
    let store = state_guard.inner.plugin_store();
    let plugin_status = super::collect_plugin_auth_status(&registry.manifests);
    let org_tokens = super::collect_org_tokens(&registry.manifests);
    let plugin_updates = super::collect_plugin_updates(&registry.manifests, &cached_registry);
    let plugin_update_actions = super::evaluate_update_preferences(&plugin_updates, store);

    (
        plugin_status,
        plugin_updates,
        plugin_update_actions,
        org_tokens,
    )
}

fn include_runtime_context(arguments: &Value) -> bool {
    arguments
        .get("include_runtime_context")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn runtime_context_status(
    include_runtime_context: bool,
    agent_type: &str,
    project_path: Option<&str>,
) -> Value {
    if include_runtime_context {
        return serde_json::json!({
            "mode": "full",
            "instruction": "Full runtime breadcrumbs were included because include_runtime_context was true. For task-specific details, still prefer describe_connector, describe_tool, get_plugin_docs, and get_plugin_prompt over carrying unrelated docs."
        });
    }

    let mut full_context_arguments = serde_json::Map::new();
    full_context_arguments.insert("include_runtime_context".to_string(), Value::Bool(true));
    if agent_type != "generic" {
        full_context_arguments.insert(
            "agent_type".to_string(),
            Value::String(agent_type.to_string()),
        );
    }
    if let Some(project_path) = project_path {
        full_context_arguments.insert(
            "project_path".to_string(),
            Value::String(project_path.to_string()),
        );
    }

    serde_json::json!({
        "mode": "lean",
        "omitted": ["rules", "plugin_registry"],
        "instruction": "Default init_session is lean: startup-rule reconciliation, auth/update status, org token summary, and compact plugin-provided init context only. Lazy-load broader runtime/plugin context when needed.",
        "full_context_request": {
            "tool": "init_session",
            "arguments": Value::Object(full_context_arguments)
        },
        "lazy_tools": ["describe_connector", "describe_tool", "describe_tool_group", "get_plugin_docs", "get_plugin_prompt"]
    })
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
    let include_runtime_context = include_runtime_context(&arguments);

    let startup_rule_actions =
        startup_rule_actions_for_project(agent_type, project_path, state).await?;
    let app_state = {
        let state_guard = state.lock().await;
        state_guard.inner.clone()
    };
    if let Some(project_path) = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Ok(mut active_project_path) = app_state.active_project_path.lock() {
            *active_project_path = Some(PathBuf::from(project_path));
        }
    }
    let plugin_contexts = collect_plugin_init_contexts(&app_state).await;

    let mut response = if include_runtime_context {
        let (
            rules,
            plugin_status,
            plugin_registry,
            plugin_updates,
            plugin_update_actions,
            org_tokens,
        ) = gather_slim_session_data(state).await;
        let mut response = serde_json::json!({
            "rules": rules,
            "plugin_registry": plugin_registry,
            "rules_update": {
                "current_version": super::RULES_VERSION,
                "instruction": "Runtime MCPViews rules are session breadcrumbs only. Do not persist the `rules` array, plugin_rules, renderer rules, DecidR/Ludflow workflow guidance, setup questions, plugin docs, or tool docs into native startup rule files. Reconcile only `startup_rule_actions` into harness-native startup rules, then record state with save_startup_rule_state."
            },
            "plugin_status": plugin_status,
            "org_tokens": org_tokens,
            "plugin_updates": plugin_updates,
            "plugin_update_actions": plugin_update_actions,
        });
        response["runtime_context"] = runtime_context_status(true, agent_type, project_path);
        response
    } else {
        let (plugin_status, plugin_updates, plugin_update_actions, org_tokens) =
            gather_startup_session_data(state).await;
        let mut response = serde_json::json!({
            "plugin_status": plugin_status,
            "org_tokens": org_tokens,
            "plugin_updates": plugin_updates,
            "plugin_update_actions": plugin_update_actions,
        });
        response["runtime_context"] = runtime_context_status(false, agent_type, project_path);
        response
    };

    let response_obj = response.as_object_mut().unwrap();
    response_obj.insert(
        "rules_version".to_string(),
        serde_json::json!(super::RULES_VERSION),
    );
    response_obj.insert(
        "persistence_instructions".to_string(),
        serde_json::json!(super::persistence_instructions(agent_type)),
    );
    response_obj.insert("startup_rule_actions".to_string(), startup_rule_actions);
    response_obj.insert("plugin_contexts".to_string(), plugin_contexts);
    let compact_context_defaults = {
        let registry = app_state.plugin_registry.lock().unwrap();
        crate::context_layer::collect_compact_project_context_defaults(
            project_path,
            &registry.manifests,
            &app_state.auth_dir,
        )
    };
    if !compact_context_defaults.is_null() {
        response_obj.insert("context_defaults".to_string(), compact_context_defaults);
    }

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&response).unwrap()
        }]
    }))
}

fn plugin_init_context_fail_open(status: &str, message: Option<String>) -> Value {
    let mut context = serde_json::json!({
        "status": status,
    });
    if let Some(message) = message {
        context["message"] = Value::String(message);
    }
    context
}

fn parse_plugin_result_payload(result: &Value) -> Option<Value> {
    if result.get("data").is_some() {
        return Some(result.clone());
    }

    if let Some(structured) = result.get("structuredContent") {
        return Some(structured.clone());
    }

    let content = result.get("content")?.as_array()?;
    for item in content {
        if item.get("type").and_then(|v| v.as_str()) != Some("text") {
            continue;
        }
        let text = item.get("text").and_then(|v| v.as_str())?;
        if let Ok(parsed) = serde_json::from_str::<Value>(text) {
            return Some(parsed);
        }
    }
    None
}

fn normalize_plugin_init_context_payload(payload: Value) -> Value {
    payload.get("data").cloned().unwrap_or(payload)
}

fn plugin_token_is_context_usable(
    auth_dir: &Path,
    plugin_name: &str,
    org_id: &str,
    expired_unrefreshable: &mut bool,
) -> bool {
    let status = mcpviews_shared::token_store::token_status_for_org(auth_dir, plugin_name, org_id);
    match status {
        mcpviews_shared::token_store::StoredTokenStatus::Valid
        | mcpviews_shared::token_store::StoredTokenStatus::ExpiredRefreshable => true,
        mcpviews_shared::token_store::StoredTokenStatus::ExpiredUnrefreshable => {
            *expired_unrefreshable = true;
            false
        }
        mcpviews_shared::token_store::StoredTokenStatus::Missing => false,
    }
}

fn select_plugin_org_for_context_from_dir(
    plugin_name: &str,
    auth_dir: &Path,
) -> Result<String, Value> {
    let orgs = mcpviews_shared::token_store::list_orgs(auth_dir, plugin_name);
    if orgs.is_empty() {
        return Err(plugin_init_context_fail_open(
            "auth_missing",
            Some(format!(
                "{} has no MCPViews organization token.",
                plugin_name
            )),
        ));
    }

    let mut expired_unrefreshable = false;
    if let Some(default_org) = mcpviews_shared::token_store::load_default_org(auth_dir, plugin_name)
    {
        if orgs.contains(&default_org)
            && plugin_token_is_context_usable(
                auth_dir,
                plugin_name,
                &default_org,
                &mut expired_unrefreshable,
            )
        {
            return Ok(default_org);
        }
    }

    for org_id in &orgs {
        if plugin_token_is_context_usable(auth_dir, plugin_name, org_id, &mut expired_unrefreshable)
        {
            return Ok(org_id.clone());
        }
    }

    Err(plugin_init_context_fail_open(
        if expired_unrefreshable {
            "auth_unavailable"
        } else {
            "auth_missing"
        },
        Some(format!(
            "{} auth is not currently usable for init-session context.",
            plugin_name
        )),
    ))
}

fn select_plugin_org_for_context(plugin_name: &str) -> Result<String, Value> {
    let auth_dir = mcpviews_shared::auth_dir();
    select_plugin_org_for_context_from_dir(plugin_name, &auth_dir)
}

fn plugin_oauth_info_for_context(
    plugin_name: &str,
    auth: &Option<mcpviews_shared::PluginAuth>,
    organization_id: Option<&str>,
) -> Option<OAuthRefreshInfo> {
    match auth.as_ref()? {
        mcpviews_shared::PluginAuth::OAuth {
            client_id,
            token_url,
            ..
        } => Some(OAuthRefreshInfo {
            plugin_name: plugin_name.to_string(),
            token_url: token_url.clone(),
            client_id: client_id.clone(),
            org_id: organization_id.map(str::to_string),
        }),
        _ => None,
    }
}

fn plugin_auth_header_for_context(
    plugin_name: &str,
    auth: &Option<mcpviews_shared::PluginAuth>,
    organization_id: Option<&str>,
) -> Option<String> {
    match (auth.as_ref(), organization_id) {
        (Some(auth), Some(org_id)) => auth.resolve_header_for_org(plugin_name, org_id),
        (Some(auth), None) => auth.resolve_header(plugin_name),
        (None, _) => None,
    }
}

async fn collect_plugin_init_contexts(app_state: &Arc<AppState>) -> Value {
    let providers = {
        let registry = app_state.plugin_registry.lock().unwrap();
        registry
            .manifests
            .iter()
            .filter_map(|manifest| {
                let config = manifest.init_context.clone()?;
                let mcp = manifest.mcp.clone()?;
                Some(PluginInitContextProvider {
                    plugin_name: manifest.name.clone(),
                    mcp_url: mcp.url,
                    auth: mcp.auth,
                    config,
                })
            })
            .collect::<Vec<_>>()
    };

    let mut contexts = serde_json::Map::new();
    for provider in providers {
        let context = collect_plugin_init_context(app_state, &provider).await;
        contexts.insert(provider.plugin_name.clone(), context);
    }
    Value::Object(contexts)
}

async fn collect_plugin_init_context(
    app_state: &Arc<AppState>,
    provider: &PluginInitContextProvider,
) -> Value {
    let timeout_ms = provider
        .config
        .timeout_ms
        .unwrap_or(DEFAULT_PLUGIN_INIT_CONTEXT_TIMEOUT_MS);
    match timeout(
        Duration::from_millis(timeout_ms),
        collect_plugin_init_context_inner(app_state, provider),
    )
    .await
    {
        Err(_) => plugin_init_context_fail_open(
            "timeout",
            Some(format!(
                "Timed out reading {} init-session context.",
                provider.plugin_name
            )),
        ),
        Ok(context) => context,
    }
}

async fn collect_plugin_init_context_inner(
    app_state: &Arc<AppState>,
    provider: &PluginInitContextProvider,
) -> Value {
    let mut argument_map = match provider.config.arguments.clone() {
        Value::Object(map) => map,
        _ => {
            return plugin_init_context_fail_open(
                "configuration_error",
                Some(format!(
                    "{} init_context.arguments must be an object.",
                    provider.plugin_name
                )),
            );
        }
    };

    let organization_id = if provider.config.inject_organization_id {
        match select_plugin_org_for_context(&provider.plugin_name) {
            Ok(org_id) => Some(org_id),
            Err(context) => return context,
        }
    } else {
        None
    };

    if let Some(org_id) = organization_id.as_ref() {
        argument_map.insert("organization_id".to_string(), Value::String(org_id.clone()));
    }
    let arguments = Value::Object(argument_map);

    let (mut auth_header, oauth_info, client) = {
        let auth_header = plugin_auth_header_for_context(
            &provider.plugin_name,
            &provider.auth,
            organization_id.as_deref(),
        );
        let oauth_info = plugin_oauth_info_for_context(
            &provider.plugin_name,
            &provider.auth,
            organization_id.as_deref(),
        );
        (auth_header, oauth_info, app_state.http_client.clone())
    };
    if auth_header.is_none()
        || oauth_info
            .as_ref()
            .map(oauth_token_needs_preemptive_refresh)
            .unwrap_or(false)
    {
        if let Some(oauth) = &oauth_info {
            if let Some(bearer) = try_refresh_oauth(oauth, &client).await {
                auth_header = Some(bearer);
            }
        }
    }

    let call = super::plugin_proxy::proxy_plugin_tool_call(
        &client,
        &provider.mcp_url,
        auth_header.as_deref(),
        &provider.config.tool,
        &arguments,
    );

    match call.await {
        Err(error) => plugin_init_context_fail_open("error", Some(error)),
        Ok(result) => match parse_plugin_result_payload(&result) {
            Some(payload) => normalize_plugin_init_context_payload(payload),
            None => plugin_init_context_fail_open(
                "error",
                Some(format!(
                    "Could not parse {} init-session context response.",
                    provider.plugin_name
                )),
            ),
        },
    }
}

pub(crate) fn setup_instructions(agent_type: &str) -> String {
    const REPORT_CURRENT_RULES: &str = " When startup_rule_actions.status is cleanup_required, replace the managed native startup-rule block with the returned block so orphaned rules are removed from the agent-visible file; do not reinstall orphaned rules. When startup_rule_actions.status is current, report the active startup_rule_actions.current titles and rule_ids so the user can verify which startup rules are loaded; do not summarize this as only no changes needed.";
    match agent_type {
        "claude_code" => format!("Install or update only entries returned in `startup_rule_actions.needs_install` and `startup_rule_actions.auto_update` into `.claude/rules/mcpviews-startup.md`, then call `save_startup_rule_state`. Do not persist runtime MCPViews rules or plugin_rules.{REPORT_CURRENT_RULES}"),
        "claude_desktop" => format!("Create or update only startup-rule memories for entries returned in `startup_rule_actions.needs_install` and `startup_rule_actions.auto_update`, then call `save_startup_rule_state`. Do not persist runtime MCPViews rules or plugin_rules.{REPORT_CURRENT_RULES}"),
        "cursor" => format!("Install or update only entries returned in `startup_rule_actions.needs_install` and `startup_rule_actions.auto_update` into `.cursor/rules/mcpviews-startup.mdc`, then call `save_startup_rule_state`. Do not persist runtime MCPViews rules or plugin_rules.{REPORT_CURRENT_RULES}"),
        "codex" | "opencode" | "antigravity" => format!("Install or update only entries returned in `startup_rule_actions.needs_install` and `startup_rule_actions.auto_update` in the managed `## MCPViews Startup Rules` block of the `AGENTS.md` at the supplied `project_path`, then call `save_startup_rule_state`. Use `startup_rule_actions.native_rule_file_path` as the exact target. If an old `<!-- mcpviews-rules-version: ... -->` MCPViews block exists, replace that managed block with startup rules only. If `startup_rule_actions.codex_rule_file_context.warnings` mentions parent-only or nested AGENTS files, follow that warning before treating rules as installed. Do not persist runtime MCPViews rules or plugin_rules.{REPORT_CURRENT_RULES}"),
        "windsurf" => format!("Install or update only entries returned in `startup_rule_actions.needs_install` and `startup_rule_actions.auto_update` in `.windsurfrules`, then call `save_startup_rule_state`. Do not persist runtime MCPViews rules or plugin_rules.{REPORT_CURRENT_RULES}"),
        _ => format!("Ask the user which native startup-rule mechanism to use for entries returned in `startup_rule_actions.needs_install` and `startup_rule_actions.auto_update`, then call `save_startup_rule_state`. Do not persist runtime MCPViews rules or plugin_rules.{REPORT_CURRENT_RULES}"),
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

    let response = build_mcpviews_setup_response(
        agent_type,
        Value::Array(rules),
        Value::Array(plugin_status),
        Value::Array(available_tools),
        Value::Array(setup_questions),
        startup_rule_actions,
    );

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&response).unwrap()
        }]
    }))
}

fn build_mcpviews_setup_response(
    agent_type: &str,
    rules: Value,
    plugin_status: Value,
    available_tools: Value,
    setup_questions: Value,
    startup_rule_actions: Value,
) -> Value {
    serde_json::json!({
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
    })
}

async fn startup_rule_actions_for_project(
    agent_type: &str,
    project_path: Option<&str>,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let app_state = {
        let state_guard = state.lock().await;
        state_guard.inner.clone()
    };
    startup_rule_actions_for_project_state(agent_type, project_path, &app_state)
}

fn startup_rule_actions_for_project_state(
    agent_type: &str,
    project_path: Option<&str>,
    app_state: &Arc<AppState>,
) -> Result<Value, String> {
    let Some(project_path) = project_path else {
        return Ok(project_path_required_startup_rule_actions());
    };

    let (manifests, store) = {
        let registry = app_state.plugin_registry.lock().unwrap();
        (registry.manifests.clone(), app_state.plugin_store().clone())
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
        super::startup_rules::filter_startup_rule_actions_to_codex_file_orphans(
            &mut actions,
            existing_native_rule_file.as_deref(),
        );
        actions["native_rule_file"] =
            serde_json::json!(super::startup_rules::CODEX_NATIVE_RULE_FILE);
        actions["native_rule_file_path"] =
            serde_json::json!(native_rule_file_path.display().to_string());
        let codex_context = super::startup_rules::codex_native_rule_context(&project_path);
        if should_include_codex_native_rule_block(&actions, &codex_context) {
            actions["native_rule_block"] = serde_json::json!(
                super::startup_rules::build_codex_startup_rules_block_for_project(
                    &config,
                    &resolved_rules,
                    existing_native_rule_file.as_deref(),
                )
            );
            actions["native_rule_block_instruction"] = serde_json::json!(
                format!(
                    "For Codex-style agents, install/update the returned `## MCPViews Startup Rules` block in `{}` for the supplied project_path. Replace any managed `## MCPViews` block containing `<!-- mcpviews-rules-version: ... -->` in that file. Preserve user-authored content outside managed MCPViews blocks. The block must contain startup rules only. Do not treat a parent AGENTS.md install as sufficient for a nested Codex project; rerun setup with the nested project_path and install there too.",
                    native_rule_file_path.display()
                )
            );
        } else {
            actions["native_rule_block_omitted"] = serde_json::json!({
                "reason": "startup_rules_current",
                "instruction": "Native startup rules are already current for this project. MCPViews omits native_rule_block in current state to reduce init_session context. Report the active startup_rule_actions.current titles and rule_ids so the user can verify which startup rules are loaded."
            });
        }
        actions["codex_rule_file_context"] = codex_context;
    }
    Ok(actions)
}

fn should_include_codex_native_rule_block(actions: &Value, codex_context: &Value) -> bool {
    let project_rule_file = codex_context
        .get("project_rule_file")
        .and_then(Value::as_object);
    let contains_startup_rules = project_rule_file
        .and_then(|file| file.get("contains_mcpviews_startup_rules"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let contains_legacy_rules = project_rule_file
        .and_then(|file| file.get("contains_legacy_mcpviews_rules"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    actions
        .get("status")
        .and_then(Value::as_str)
        .map(|status| status != "current")
        .unwrap_or(true)
        || !contains_startup_rules
        || contains_legacy_rules
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
    use crate::mcp_tools::startup_rules;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

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
    fn test_init_session_runtime_context_defaults_to_lean() {
        assert!(!include_runtime_context(&serde_json::json!({})));
        assert!(include_runtime_context(&serde_json::json!({
            "include_runtime_context": true
        })));

        let lean = runtime_context_status(false, "codex", Some("/tmp/project"));
        assert_eq!(lean["mode"], "lean");
        assert!(lean["omitted"]
            .as_array()
            .unwrap()
            .contains(&Value::String("plugin_registry".to_string())));
        assert_eq!(
            lean["full_context_request"]["arguments"]["include_runtime_context"],
            true
        );
        assert_eq!(
            lean["full_context_request"]["arguments"]["agent_type"],
            "codex"
        );
        assert_eq!(
            lean["full_context_request"]["arguments"]["project_path"],
            "/tmp/project"
        );

        let full = runtime_context_status(true, "codex", Some("/tmp/project"));
        assert_eq!(full["mode"], "full");
    }

    #[test]
    fn test_codex_native_rule_block_omitted_only_when_current_and_present() {
        let current_actions = serde_json::json!({ "status": "current" });
        let current_context = serde_json::json!({
            "project_rule_file": {
                "contains_mcpviews_startup_rules": true,
                "contains_legacy_mcpviews_rules": false
            }
        });
        assert!(!should_include_codex_native_rule_block(
            &current_actions,
            &current_context
        ));

        let needs_install_actions = serde_json::json!({ "status": "needs_install" });
        assert!(should_include_codex_native_rule_block(
            &needs_install_actions,
            &current_context
        ));

        let legacy_context = serde_json::json!({
            "project_rule_file": {
                "contains_mcpviews_startup_rules": true,
                "contains_legacy_mcpviews_rules": true
            }
        });
        assert!(should_include_codex_native_rule_block(
            &current_actions,
            &legacy_context
        ));

        let missing_context = serde_json::json!({
            "project_rule_file": {
                "contains_mcpviews_startup_rules": false,
                "contains_legacy_mcpviews_rules": false
            }
        });
        assert!(should_include_codex_native_rule_block(
            &current_actions,
            &missing_context
        ));
    }

    #[test]
    fn test_setup_instructions_are_startup_rule_only() {
        let instructions = setup_instructions("codex");

        assert!(instructions.contains("startup_rule_actions.needs_install"));
        assert!(instructions.contains("MCPViews Startup Rules"));
        assert!(instructions.contains("native_rule_file_path"));
        assert!(instructions.contains("save_startup_rule_state"));
        assert!(instructions.contains("startup_rule_actions.current titles"));
        assert!(!instructions.contains("renderer rules"));
        assert!(!instructions.contains("all rules below"));
    }

    #[test]
    fn test_setup_actions_cleanup_removed_decidr_rule_converges_after_apply() {
        let (app_state, _temp_store) = crate::test_utils::test_app_state();
        let project = tempfile::tempdir().unwrap();
        let project_path = project.path().display().to_string();
        let resolved = startup_rules::resolve_all_startup_rules(&[], app_state.plugin_store());
        let core_rules = resolved
            .iter()
            .filter(|rule| rule.plugin == startup_rules::CORE_STARTUP_RULE_PLUGIN)
            .collect::<Vec<_>>();
        assert!(core_rules
            .iter()
            .any(|rule| { rule.rule_id == startup_rules::CORE_INIT_SESSION_PROJECT_PATH_RULE_ID }));
        assert!(core_rules
            .iter()
            .any(|rule| { rule.rule_id == startup_rules::CORE_PUSH_PLANS_TO_MCPVIEWS_RULE_ID }));

        let core_rule_blocks = core_rules
            .iter()
            .map(|rule| {
                format!(
                    "\
<!-- mcpviews-startup-rule: plugin={} rule_id={} version={} hash={} -->

### {}

{}

",
                    rule.plugin, rule.rule_id, rule.version, rule.hash, rule.title, rule.rule
                )
            })
            .collect::<String>();

        let locations = serde_json::json!([{
            "agent_type": "codex",
            "path": "AGENTS.md",
            "label": "Project AGENTS.md"
        }]);
        let stale_agents = format!(
            "\
# AGENTS.md

## MCPViews Startup Rules

<!-- mcpviews-startup-rules-schema: 1 -->

{}
<!-- mcpviews-startup-rule: plugin=decidr rule_id=decidr_work_session_bootstrap version=2 hash=sha256:old-work-session -->

### DecidR Work Session Bootstrap

Old temporary work session rule.
",
            core_rule_blocks
        );
        std::fs::write(project.path().join("AGENTS.md"), stale_agents).unwrap();

        for core_rule in core_rules {
            startup_rules::save_startup_rule_state_from_args(serde_json::json!({
                "project_path": project_path,
                "plugin": core_rule.plugin,
                "rule_id": core_rule.rule_id,
                "rule_version": core_rule.version,
                "rule_hash": core_rule.hash,
                "locations": locations.clone()
            }))
            .unwrap();
        }
        startup_rules::save_startup_rule_state_from_args(serde_json::json!({
            "project_path": project_path,
            "plugin": "decidr",
            "rule_id": "decidr_work_session_bootstrap",
            "rule_version": "2",
            "rule_hash": "sha256:old-work-session",
            "locations": locations
        }))
        .unwrap();

        let actions =
            startup_rule_actions_for_project_state("codex", Some(&project_path), &app_state)
                .unwrap();
        assert_eq!(actions["status"], "cleanup_required");
        assert_eq!(actions["orphaned"].as_array().unwrap().len(), 1);
        let replacement = actions["native_rule_block"].as_str().unwrap();
        assert!(replacement.contains("plugin=mcpviews-core rule_id=init_session_project_path"));
        assert!(replacement.contains("plugin=mcpviews-core rule_id=push_plans_to_mcpviews"));
        assert!(!replacement.contains("decidr_work_session_bootstrap"));
        assert!(!replacement.contains("DecidR Work Session Bootstrap"));
        assert!(actions["native_rule_block_instruction"]
            .as_str()
            .unwrap()
            .contains("install/update"));
        assert!(setup_instructions("codex").contains("cleanup_required"));
        let setup_response = build_mcpviews_setup_response(
            "codex",
            serde_json::json!([]),
            serde_json::json!([]),
            serde_json::json!([]),
            serde_json::json!([]),
            actions.clone(),
        );
        assert_eq!(
            setup_response["startup_rule_actions"]["status"],
            "cleanup_required"
        );
        assert!(setup_response["startup_rule_actions"]["native_rule_block"]
            .as_str()
            .unwrap()
            .contains("plugin=mcpviews-core rule_id=init_session_project_path"));
        assert!(setup_response["startup_rule_actions"]["native_rule_block"]
            .as_str()
            .unwrap()
            .contains("plugin=mcpviews-core rule_id=push_plans_to_mcpviews"));
        assert!(!setup_response["startup_rule_actions"]["native_rule_block"]
            .as_str()
            .unwrap()
            .contains("decidr_work_session_bootstrap"));
        assert!(setup_response["setup_instructions"]
            .as_str()
            .unwrap()
            .contains("cleanup_required"));
        assert!(setup_response["rules_update"]["instruction"]
            .as_str()
            .unwrap()
            .contains("Use only `startup_rule_actions`"));

        std::fs::write(project.path().join("AGENTS.md"), replacement).unwrap();
        let current_actions =
            startup_rule_actions_for_project_state("codex", Some(&project_path), &app_state)
                .unwrap();
        assert_eq!(current_actions["status"], "current");
        assert_eq!(current_actions["orphaned"].as_array().unwrap().len(), 0);
        assert!(current_actions.get("native_rule_block").is_none());
        assert_eq!(
            current_actions["native_rule_block_omitted"]["reason"],
            "startup_rules_current"
        );
    }

    #[test]
    fn test_parse_plugin_result_payload_from_mcp_text() {
        let result = serde_json::json!({
            "content": [{
                "type": "text",
                "text": "{\"data\":{\"status\":\"available\",\"recentDecisions\":[{\"id\":\"dec_1\"}]}}"
            }]
        });

        let parsed = parse_plugin_result_payload(&result).expect("payload should parse");

        assert_eq!(parsed["data"]["status"], "available");
        assert_eq!(parsed["data"]["recentDecisions"][0]["id"], "dec_1");
    }

    #[test]
    fn test_parse_plugin_result_payload_from_structured_content() {
        let result = serde_json::json!({
            "structuredContent": {
                "status": "available",
                "items": []
            }
        });

        let parsed = parse_plugin_result_payload(&result).expect("payload should parse");

        assert_eq!(parsed["status"], "available");
    }

    #[test]
    fn test_normalize_plugin_init_context_payload_extracts_data_only() {
        let normalized = normalize_plugin_init_context_payload(serde_json::json!({
            "data": {
                "status": "available",
                "recentDecisions": []
            },
            "meta": {
                "debug": true
            }
        }));

        assert_eq!(normalized["status"], "available");
        assert!(normalized.get("meta").is_none());
    }

    #[test]
    fn test_plugin_init_context_fail_open_context_shape() {
        let context = plugin_init_context_fail_open("timeout", Some("slow".to_string()));

        assert_eq!(context["status"], "timeout");
        assert_eq!(context["message"], "slow");
        assert_eq!(context.as_object().unwrap().len(), 2);
    }

    #[test]
    fn test_select_plugin_org_prefers_default_token() {
        let dir = tempfile::tempdir().unwrap();
        let plugin_name = "context-plugin";
        let token = mcpviews_shared::token_store::StoredToken {
            access_token: "token".to_string(),
            refresh_token: None,
            expires_at: Some(4_102_444_800),
        };
        mcpviews_shared::token_store::store_token_for_org(
            dir.path(),
            plugin_name,
            "org_a_sorted_first",
            &token,
        )
        .unwrap();
        mcpviews_shared::token_store::store_token_for_org(
            dir.path(),
            plugin_name,
            "org_z_default",
            &token,
        )
        .unwrap();
        mcpviews_shared::token_store::set_default_org(dir.path(), plugin_name, "org_z_default")
            .unwrap();

        let selected = select_plugin_org_for_context_from_dir(plugin_name, dir.path()).unwrap();

        assert_eq!(selected, "org_z_default");
    }

    #[test]
    fn test_select_plugin_org_falls_back_when_default_unusable() {
        let dir = tempfile::tempdir().unwrap();
        let plugin_name = "context-plugin";
        let valid_token = mcpviews_shared::token_store::StoredToken {
            access_token: "token".to_string(),
            refresh_token: None,
            expires_at: Some(4_102_444_800),
        };
        let expired_unrefreshable = mcpviews_shared::token_store::StoredToken {
            access_token: "old".to_string(),
            refresh_token: None,
            expires_at: Some(1),
        };
        mcpviews_shared::token_store::store_token_for_org(
            dir.path(),
            plugin_name,
            "org_a_default",
            &expired_unrefreshable,
        )
        .unwrap();
        mcpviews_shared::token_store::store_token_for_org(
            dir.path(),
            plugin_name,
            "org_b_valid",
            &valid_token,
        )
        .unwrap();
        mcpviews_shared::token_store::set_default_org(dir.path(), plugin_name, "org_a_default")
            .unwrap();

        let selected = select_plugin_org_for_context_from_dir(plugin_name, dir.path()).unwrap();

        assert_eq!(selected, "org_b_valid");
    }

    #[test]
    fn test_plugin_oauth_info_uses_selected_org() {
        let auth = Some(mcpviews_shared::PluginAuth::OAuth {
            auth_url: "https://auth.example.test".to_string(),
            token_url: "https://token.example.test".to_string(),
            client_id: Some("client_1".to_string()),
            scopes: vec![],
            email_code_auth: None,
        });

        let info = plugin_oauth_info_for_context("context-plugin", &auth, Some("org_selected"))
            .expect("OAuth info");

        assert_eq!(info.plugin_name, "context-plugin");
        assert_eq!(info.org_id.as_deref(), Some("org_selected"));
        assert_eq!(info.client_id.as_deref(), Some("client_1"));
    }

    async fn mock_init_context_mcp_handler(
        axum::extract::State(call_count): axum::extract::State<Arc<AtomicUsize>>,
        axum::Json(body): axum::Json<Value>,
    ) -> axum::Json<Value> {
        call_count.fetch_add(1, Ordering::SeqCst);
        let id = body.get("id").cloned().unwrap_or(Value::Null);
        match body.get("method").and_then(Value::as_str) {
            Some("initialize") => axum::Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "serverInfo": {
                        "name": "mock-decidr",
                        "version": "1.0.0"
                    }
                }
            })),
            Some("notifications/initialized") => axum::Json(serde_json::json!({
                "jsonrpc": "2.0",
                "result": {}
            })),
            Some("tools/list") => axum::Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "tools": [{
                        "name": "get_init_context",
                        "description": "Return compact init context.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {}
                        }
                    }]
                }
            })),
            Some("tools/call") => {
                let params = body.get("params").cloned().unwrap_or(Value::Null);
                let name = params.get("name").and_then(Value::as_str);
                let arguments = params
                    .get("arguments")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                if name != Some("get_init_context") || arguments.contains_key("organization_id") {
                    return axum::Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32602,
                            "message": "unexpected init-context call"
                        }
                    }));
                }

                axum::Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "content": [{
                            "type": "text",
                            "text": serde_json::json!({
                                "data": {
                                    "status": "available",
                                    "windowHours": 24,
                                    "recentDecisions": [{
                                        "id": "dec_1",
                                        "title": "Frontend mockup plan",
                                        "description": "Build the application front-end mockup."
                                    }],
                                    "instruction": "Call get_decision for a relevant recent decision match."
                                }
                            }).to_string()
                        }]
                    }
                }))
            }
            _ => axum::Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": "unknown method"
                }
            })),
        }
    }

    #[tokio::test]
    async fn test_collect_plugin_init_contexts_calls_manifest_provider_without_tool_list_warmup() {
        let call_count = Arc::new(AtomicUsize::new(0));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = axum::Router::new()
            .route("/", axum::routing::post(mock_init_context_mcp_handler))
            .with_state(call_count.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let (app_state, _temp_dir) = crate::test_utils::test_app_state();
        let mut manifest = crate::test_utils::test_manifest("decidr");
        manifest.mcp = Some(mcpviews_shared::PluginMcpConfig {
            url: format!("http://{addr}/"),
            auth: None,
            tool_prefix: "decidr__".to_string(),
        });
        manifest.init_context = Some(mcpviews_shared::PluginInitContext {
            tool: "get_init_context".to_string(),
            timeout_ms: Some(1_200),
            inject_organization_id: false,
            arguments: serde_json::json!({}),
        });
        app_state
            .plugin_registry
            .lock()
            .unwrap()
            .add_plugin(manifest)
            .unwrap();

        let contexts = collect_plugin_init_contexts(&app_state).await;
        server.abort();

        let decidr = contexts.get("decidr").expect("decidr init context");
        assert_eq!(decidr["status"], "available");
        assert_eq!(decidr["windowHours"], 24);
        assert_eq!(decidr["recentDecisions"][0]["id"], "dec_1");
        assert_eq!(
            decidr["recentDecisions"][0]["title"],
            "Frontend mockup plan"
        );
        assert!(decidr.get("activeWorkSessions").is_none());
        assert!(decidr["recentDecisions"][0].get("context").is_none());
        assert_eq!(call_count.load(Ordering::SeqCst), 1);
    }
}
