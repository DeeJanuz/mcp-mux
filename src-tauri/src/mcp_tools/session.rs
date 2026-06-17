use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{timeout, Duration};

use crate::http_server::AsyncAppState;
use crate::plugin::{
    apply_tool_cache, fetch_plugin_tools, oauth_token_needs_preemptive_refresh, try_refresh_oauth,
    OAuthRefreshInfo,
};

const DECIDR_PLUGIN_NAME: &str = "decidr";
const DECIDR_ACTIVE_WORK_SESSIONS_TOOL: &str = "decidr__get_active_work_sessions";
const DECIDR_CONTEXT_TIMEOUT_MS: u64 = 1_200;

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
        "instruction": "Default init_session is lean: startup-rule reconciliation, auth/update status, org token summary, and compact ephemeral plugin context only. Lazy-load broader runtime/plugin context when needed.",
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
    let decidr_context = collect_decidr_plugin_context(state).await;

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
    response_obj.insert(
        "plugin_contexts".to_string(),
        serde_json::json!({
            "decidr": decidr_context,
        }),
    );

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&response).unwrap()
        }]
    }))
}

fn decidr_capture_defaults() -> Value {
    serde_json::json!({
        "ttl_hours": 24,
        "archive_retention_days": 60,
        "stored_content": "compact_summary_and_refs_only",
        "raw_transcript_storage": false,
        "capture_cadence": "milestone_or_end_turn",
        "background_saver": "preferred_with_inline_fallback",
        "logging_review": "mcpviews_structured_table_per_row_approval"
    })
}

fn decidr_capture_instruction() -> &'static str {
    "Use lazy always-on DecidR Active Work Sessions for cross-agent handoff. Do not create empty sessions during init. After milestones and end turns, spawn a background saver when supported; otherwise do a short inline save. Store compact summaries, next steps, blockers, decisions made, and artifact refs/previews only; do not store raw transcript. For multi-item DecidR logging, use an MCPViews structured review table and execute accepted rows only. Do not edit native rule files without explicit approval."
}

fn decidr_fail_open_context(status: &str, message: Option<String>) -> Value {
    let mut context = serde_json::json!({
        "status": status,
        "activeWorkSessions": [],
        "latestFeedback": [],
        "preferences": null,
        "capture_defaults": decidr_capture_defaults(),
        "instruction": decidr_capture_instruction(),
    });
    if let Some(message) = message {
        context["message"] = Value::String(message);
    }
    context
}

fn parse_plugin_result_payload(result: &Value) -> Option<Value> {
    if result.get("data").is_some() || result.get("activeWorkSessions").is_some() {
        return Some(result.clone());
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

fn normalize_decidr_context_payload(payload: Value, organization_id: &str) -> Value {
    let mut data = payload
        .get("data")
        .cloned()
        .unwrap_or_else(|| payload.clone());

    if !data.is_object() {
        return decidr_fail_open_context(
            "error",
            Some("DecidR active-session response was not an object.".to_string()),
        );
    }

    let obj = data.as_object_mut().unwrap();
    obj.entry("status".to_string())
        .or_insert_with(|| Value::String("available".to_string()));
    obj.entry("activeWorkSessions".to_string())
        .or_insert_with(|| Value::Array(vec![]));
    obj.entry("latestFeedback".to_string())
        .or_insert_with(|| Value::Array(vec![]));
    obj.entry("capture_defaults".to_string())
        .or_insert_with(decidr_capture_defaults);
    obj.entry("instruction".to_string())
        .or_insert_with(|| Value::String(decidr_capture_instruction().to_string()));
    obj.insert(
        "organization_id".to_string(),
        Value::String(organization_id.to_string()),
    );
    data
}

fn decidr_token_is_context_usable(
    auth_dir: &Path,
    org_id: &str,
    expired_unrefreshable: &mut bool,
) -> bool {
    let status =
        mcpviews_shared::token_store::token_status_for_org(auth_dir, DECIDR_PLUGIN_NAME, org_id);
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

fn select_decidr_org_for_context_from_dir(auth_dir: &Path) -> Result<String, Value> {
    let orgs = mcpviews_shared::token_store::list_orgs(auth_dir, DECIDR_PLUGIN_NAME);
    if orgs.is_empty() {
        return Err(decidr_fail_open_context(
            "auth_missing",
            Some("DecidR has no MCPViews organization token.".to_string()),
        ));
    }

    let mut expired_unrefreshable = false;
    if let Some(default_org) =
        mcpviews_shared::token_store::load_default_org(auth_dir, DECIDR_PLUGIN_NAME)
    {
        if orgs.contains(&default_org)
            && decidr_token_is_context_usable(auth_dir, &default_org, &mut expired_unrefreshable)
        {
            return Ok(default_org);
        }
    }

    for org_id in &orgs {
        if decidr_token_is_context_usable(auth_dir, org_id, &mut expired_unrefreshable) {
            return Ok(org_id.clone());
        }
    }

    Err(decidr_fail_open_context(
        if expired_unrefreshable {
            "auth_unavailable"
        } else {
            "auth_missing"
        },
        Some("DecidR auth is not currently usable for init-session context.".to_string()),
    ))
}

fn select_decidr_org_for_context() -> Result<String, Value> {
    let auth_dir = mcpviews_shared::auth_dir();
    select_decidr_org_for_context_from_dir(&auth_dir)
}

fn decidr_oauth_info_for_org(
    plugin_name: &str,
    auth: &Option<mcpviews_shared::PluginAuth>,
    organization_id: &str,
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
            org_id: Some(organization_id.to_string()),
        }),
        _ => None,
    }
}

async fn ensure_decidr_work_session_tool_cached(
    state: &Arc<TokioMutex<AsyncAppState>>,
    organization_id: &str,
) -> bool {
    let (idx, mcp_url, mut auth_header, oauth_info, client) = {
        let state_guard = state.lock().await;
        let registry = state_guard.inner.plugin_registry.lock().unwrap();
        let client = state_guard.inner.http_client.clone();
        let Some((idx, manifest)) = registry.find_plugin_by_name(DECIDR_PLUGIN_NAME) else {
            return false;
        };
        let Some(mcp) = manifest.mcp.as_ref() else {
            return false;
        };
        let has_tool = registry
            .tool_cache
            .plugin_tools(idx)
            .map(|tools| {
                tools.iter().any(|tool| {
                    tool.get("name").and_then(|value| value.as_str())
                        == Some(DECIDR_ACTIVE_WORK_SESSIONS_TOOL)
                })
            })
            .unwrap_or(false);
        if has_tool {
            return true;
        }

        let auth_header = mcp
            .auth
            .as_ref()
            .and_then(|auth| auth.resolve_header_for_org(DECIDR_PLUGIN_NAME, organization_id));
        let oauth_info = decidr_oauth_info_for_org(DECIDR_PLUGIN_NAME, &mcp.auth, organization_id);
        (idx, mcp.url.clone(), auth_header, oauth_info, client)
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

    match fetch_plugin_tools(&client, &mcp_url, auth_header.as_deref()).await {
        Ok(tools) => apply_tool_cache(state, idx, tools).await,
        Err(error) => {
            eprintln!("{}", error);
            return false;
        }
    }

    let state_guard = state.lock().await;
    let registry = state_guard.inner.plugin_registry.lock().unwrap();
    let Some((idx, _)) = registry.find_plugin_by_name(DECIDR_PLUGIN_NAME) else {
        return false;
    };
    registry
        .tool_cache
        .plugin_tools(idx)
        .map(|tools| {
            tools.iter().any(|tool| {
                tool.get("name").and_then(|value| value.as_str())
                    == Some(DECIDR_ACTIVE_WORK_SESSIONS_TOOL)
            })
        })
        .unwrap_or(false)
}

async fn collect_decidr_plugin_context(state: &Arc<TokioMutex<AsyncAppState>>) -> Value {
    match timeout(
        Duration::from_millis(DECIDR_CONTEXT_TIMEOUT_MS),
        collect_decidr_plugin_context_inner(state),
    )
    .await
    {
        Err(_) => decidr_fail_open_context(
            "timeout",
            Some("Timed out reading DecidR active-session context.".to_string()),
        ),
        Ok(context) => context,
    }
}

async fn collect_decidr_plugin_context_inner(state: &Arc<TokioMutex<AsyncAppState>>) -> Value {
    let organization_id = match select_decidr_org_for_context() {
        Ok(org_id) => org_id,
        Err(context) => return context,
    };

    if !ensure_decidr_work_session_tool_cached(state, &organization_id).await {
        return decidr_fail_open_context(
            "tool_unavailable",
            Some("DecidR active work-session tool is not available.".to_string()),
        );
    }

    let arguments = serde_json::json!({
        "organization_id": organization_id,
        "format": "compact",
        "limit": 3,
        "include_guidance": true,
    });

    let (plugin_info, client) = super::plugin_proxy::lookup_plugin_tool(
        DECIDR_ACTIVE_WORK_SESSIONS_TOOL,
        &arguments,
        state,
    )
    .await;
    let Some(info) = plugin_info else {
        return decidr_fail_open_context(
            "tool_unavailable",
            Some("DecidR active work-session tool lookup failed.".to_string()),
        );
    };

    let call = super::plugin_proxy::proxy_plugin_tool_call(
        &client,
        &info.mcp_url,
        info.auth_header.as_deref(),
        &info.unprefixed_name,
        &arguments,
    );

    match call.await {
        Err(error) => decidr_fail_open_context("error", Some(error)),
        Ok(result) => match parse_plugin_result_payload(&result) {
            Some(payload) => normalize_decidr_context_payload(payload, &organization_id),
            None => decidr_fail_open_context(
                "error",
                Some("Could not parse DecidR active-session response.".to_string()),
            ),
        },
    }
}

pub(crate) fn setup_instructions(agent_type: &str) -> String {
    const REPORT_CURRENT_RULES: &str = " When startup_rule_actions.status is current, report the active startup_rule_actions.current titles and rule_ids so the user can verify which startup rules are loaded; do not summarize this as only no changes needed.";
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
    fn test_parse_plugin_result_payload_from_mcp_text() {
        let result = serde_json::json!({
            "content": [{
                "type": "text",
                "text": "{\"data\":{\"status\":\"available\",\"activeWorkSessions\":[{\"id\":\"ws_1\"}]}}"
            }]
        });

        let parsed = parse_plugin_result_payload(&result).expect("payload should parse");

        assert_eq!(parsed["data"]["status"], "available");
        assert_eq!(parsed["data"]["activeWorkSessions"][0]["id"], "ws_1");
    }

    #[test]
    fn test_normalize_decidr_context_payload_adds_defaults() {
        let normalized = normalize_decidr_context_payload(
            serde_json::json!({
                "data": {
                    "activeWorkSessions": []
                }
            }),
            "org_1",
        );

        assert_eq!(normalized["status"], "available");
        assert_eq!(normalized["organization_id"], "org_1");
        assert_eq!(normalized["capture_defaults"]["ttl_hours"], 24);
        assert!(normalized["instruction"]
            .as_str()
            .unwrap()
            .contains("Do not create empty sessions during init"));
    }

    #[test]
    fn test_decidr_fail_open_context_shape() {
        let context = decidr_fail_open_context("timeout", Some("slow".to_string()));

        assert_eq!(context["status"], "timeout");
        assert_eq!(context["message"], "slow");
        assert!(context["activeWorkSessions"].as_array().unwrap().is_empty());
        assert_eq!(context["capture_defaults"]["archive_retention_days"], 60);
    }

    #[test]
    fn test_select_decidr_org_prefers_default_token() {
        let dir = tempfile::tempdir().unwrap();
        let token = mcpviews_shared::token_store::StoredToken {
            access_token: "token".to_string(),
            refresh_token: None,
            expires_at: Some(4_102_444_800),
        };
        mcpviews_shared::token_store::store_token_for_org(
            dir.path(),
            DECIDR_PLUGIN_NAME,
            "org_a_sorted_first",
            &token,
        )
        .unwrap();
        mcpviews_shared::token_store::store_token_for_org(
            dir.path(),
            DECIDR_PLUGIN_NAME,
            "org_z_default",
            &token,
        )
        .unwrap();
        mcpviews_shared::token_store::set_default_org(
            dir.path(),
            DECIDR_PLUGIN_NAME,
            "org_z_default",
        )
        .unwrap();

        let selected = select_decidr_org_for_context_from_dir(dir.path()).unwrap();

        assert_eq!(selected, "org_z_default");
    }

    #[test]
    fn test_select_decidr_org_falls_back_when_default_unusable() {
        let dir = tempfile::tempdir().unwrap();
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
            DECIDR_PLUGIN_NAME,
            "org_a_default",
            &expired_unrefreshable,
        )
        .unwrap();
        mcpviews_shared::token_store::store_token_for_org(
            dir.path(),
            DECIDR_PLUGIN_NAME,
            "org_b_valid",
            &valid_token,
        )
        .unwrap();
        mcpviews_shared::token_store::set_default_org(
            dir.path(),
            DECIDR_PLUGIN_NAME,
            "org_a_default",
        )
        .unwrap();

        let selected = select_decidr_org_for_context_from_dir(dir.path()).unwrap();

        assert_eq!(selected, "org_b_valid");
    }

    #[test]
    fn test_decidr_oauth_info_uses_selected_org() {
        let auth = Some(mcpviews_shared::PluginAuth::OAuth {
            auth_url: "https://auth.example.test".to_string(),
            token_url: "https://token.example.test".to_string(),
            client_id: Some("client_1".to_string()),
            scopes: vec![],
            email_code_auth: None,
        });

        let info = decidr_oauth_info_for_org(DECIDR_PLUGIN_NAME, &auth, "org_selected")
            .expect("OAuth info");

        assert_eq!(info.plugin_name, DECIDR_PLUGIN_NAME);
        assert_eq!(info.org_id.as_deref(), Some("org_selected"));
        assert_eq!(info.client_id.as_deref(), Some("client_1"));
    }
}
