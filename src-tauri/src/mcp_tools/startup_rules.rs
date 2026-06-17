use mcpviews_shared::{
    plugin_store::PluginStore, PluginManifest, StartupRule, StartupRuleCondition,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

pub(crate) const PROJECT_CONFIG_FILE: &str = "mcpviews-init.json";
pub(crate) const STARTUP_RULES_SCHEMA_VERSION: u32 = 1;
pub(crate) const CODEX_STARTUP_RULES_HEADING: &str = "## MCPViews Startup Rules";
pub(crate) const CORE_STARTUP_RULE_PLUGIN: &str = "mcpviews-core";
pub(crate) const CORE_INIT_SESSION_PROJECT_PATH_RULE_ID: &str = "init_session_project_path";
pub(crate) const CODEX_NATIVE_RULE_FILE: &str = "AGENTS.md";
const PROJECT_CONFIG_SCHEMA_VERSION: u32 = 1;
const CORE_INIT_SESSION_PROJECT_PATH_RULE_VERSION: &str = "1";
const CORE_INIT_SESSION_PROJECT_PATH_RULE_TITLE: &str = "MCPViews Session Init";
const CORE_INIT_SESSION_PROJECT_PATH_RULE_DESCRIPTION: &str =
    "Core startup rule that makes init_session project-specific before substantial work.";
const CORE_INIT_SESSION_PROJECT_PATH_RULE: &str = "\
At the start of every new agent session in this project, call the MCPViews `init_session` tool before substantial work. Pass `agent_type` for the current harness and `project_path` as the absolute path of this Codex project root or current working directory.

If an initial `init_session` call omitted `project_path`, rerun `init_session` with `project_path` before treating startup rules as reconciled. Use the root for this actual Codex session, not a parent workspace, unless the session really starts at that parent.

This is only a startup bootstrap rule. Do not copy MCPViews runtime `rules`, `plugin_rules`, renderer rules, DecidR/Ludflow workflow guidance, setup questions, plugin docs, or tool docs into this native rule file.";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct StartupRuleLocation {
    pub agent_type: String,
    pub path: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct StartupRuleState {
    pub plugin: String,
    pub rule_id: String,
    pub rule_version: String,
    pub rule_hash: String,
    #[serde(default)]
    pub locations: Vec<StartupRuleLocation>,
    #[serde(default)]
    pub do_not_install: bool,
    #[serde(default)]
    pub do_not_update: bool,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct ProjectStartupRulesConfig {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub startup_rules: BTreeMap<String, StartupRuleState>,
}

impl Default for ProjectStartupRulesConfig {
    fn default() -> Self {
        Self {
            schema_version: PROJECT_CONFIG_SCHEMA_VERSION,
            startup_rules: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedStartupRule {
    pub key: String,
    pub plugin: String,
    pub rule_id: String,
    pub version: String,
    pub title: String,
    pub description: Option<String>,
    pub rule: String,
    pub hash: String,
    pub should_prompt_install: bool,
}

fn default_schema_version() -> u32 {
    PROJECT_CONFIG_SCHEMA_VERSION
}

pub(crate) fn startup_rule_key(plugin: &str, rule_id: &str) -> String {
    format!("{}:{}", plugin, rule_id)
}

pub(crate) fn startup_rule_hash(rule: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(rule.as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

pub(crate) fn project_config_path(project_path: &Path) -> PathBuf {
    project_path.join(PROJECT_CONFIG_FILE)
}

pub(crate) fn load_or_create_project_config(
    project_path: &Path,
) -> Result<ProjectStartupRulesConfig, String> {
    if !project_path.is_dir() {
        return Err(format!(
            "Project path '{}' does not exist or is not a directory.",
            project_path.display()
        ));
    }

    let path = project_config_path(project_path);
    if !path.exists() {
        let config = ProjectStartupRulesConfig::default();
        save_project_config(project_path, &config)?;
        return Ok(config);
    }

    let content = std::fs::read_to_string(&path).map_err(|error| {
        format!(
            "Failed to read MCPViews project config '{}': {}",
            path.display(),
            error
        )
    })?;
    serde_json::from_str::<ProjectStartupRulesConfig>(&content).map_err(|error| {
        format!(
            "Failed to parse MCPViews project config '{}': {}",
            path.display(),
            error
        )
    })
}

pub(crate) fn save_project_config(
    project_path: &Path,
    config: &ProjectStartupRulesConfig,
) -> Result<(), String> {
    if !project_path.is_dir() {
        return Err(format!(
            "Project path '{}' does not exist or is not a directory.",
            project_path.display()
        ));
    }

    let path = project_config_path(project_path);
    let json = serde_json::to_string_pretty(config)
        .map_err(|error| format!("Failed to serialize MCPViews project config: {}", error))?;
    std::fs::write(&path, json).map_err(|error| {
        format!(
            "Failed to write MCPViews project config '{}': {}",
            path.display(),
            error
        )
    })
}

pub(crate) fn resolve_all_startup_rules(
    manifests: &[PluginManifest],
    store: &PluginStore,
) -> Vec<ResolvedStartupRule> {
    let mut rules = vec![core_init_session_project_path_rule()];
    rules.extend(resolve_startup_rules(manifests, store));
    rules
}

fn core_init_session_project_path_rule() -> ResolvedStartupRule {
    ResolvedStartupRule {
        key: startup_rule_key(
            CORE_STARTUP_RULE_PLUGIN,
            CORE_INIT_SESSION_PROJECT_PATH_RULE_ID,
        ),
        plugin: CORE_STARTUP_RULE_PLUGIN.to_string(),
        rule_id: CORE_INIT_SESSION_PROJECT_PATH_RULE_ID.to_string(),
        version: CORE_INIT_SESSION_PROJECT_PATH_RULE_VERSION.to_string(),
        title: CORE_INIT_SESSION_PROJECT_PATH_RULE_TITLE.to_string(),
        description: Some(CORE_INIT_SESSION_PROJECT_PATH_RULE_DESCRIPTION.to_string()),
        rule: CORE_INIT_SESSION_PROJECT_PATH_RULE.to_string(),
        hash: startup_rule_hash(CORE_INIT_SESSION_PROJECT_PATH_RULE),
        should_prompt_install: true,
    }
}

pub(crate) fn resolve_startup_rules(
    manifests: &[PluginManifest],
    store: &PluginStore,
) -> Vec<ResolvedStartupRule> {
    let mut rules = Vec::new();

    for manifest in manifests {
        let prefs = store.load_preferences(&manifest.name);
        for startup_rule in &manifest.startup_rules {
            let Some(rule_text) = resolve_rule_text(startup_rule, &prefs) else {
                continue;
            };
            if !conditions_match(startup_rule.conditions.as_slice(), &prefs) {
                continue;
            }

            let should_prompt_install = should_prompt_install(startup_rule, &prefs);
            rules.push(ResolvedStartupRule {
                key: startup_rule_key(&manifest.name, &startup_rule.id),
                plugin: manifest.name.clone(),
                rule_id: startup_rule.id.clone(),
                version: startup_rule.version.clone(),
                title: startup_rule.title.clone(),
                description: startup_rule.description.clone(),
                hash: startup_rule_hash(&rule_text),
                rule: rule_text,
                should_prompt_install,
            });
        }
    }

    rules
}

fn resolve_rule_text(
    startup_rule: &StartupRule,
    prefs: &mcpviews_shared::PluginPreferences,
) -> Option<String> {
    if let Some(rule) = startup_rule
        .rule
        .as_deref()
        .map(str::trim)
        .filter(|rule| !rule.is_empty())
    {
        return Some(rule.to_string());
    }

    let source = startup_rule.source.as_ref()?;
    if source.source_type != "setup_question" {
        return None;
    }

    prefs
        .setup_answers
        .get(&source.question_id)
        .and_then(|answer| answer.persisted_rule.as_deref())
        .map(str::trim)
        .filter(|rule| !rule.is_empty())
        .map(str::to_string)
}

fn conditions_match(
    conditions: &[StartupRuleCondition],
    prefs: &mcpviews_shared::PluginPreferences,
) -> bool {
    conditions.iter().all(|condition| {
        let Some(answer) = prefs.setup_answers.get(&condition.question_id) else {
            return false;
        };

        if !condition.values.is_empty()
            && !condition.values.iter().any(|value| value == &answer.value)
        {
            return false;
        }

        if condition
            .not_values
            .iter()
            .any(|value| value == &answer.value)
        {
            return false;
        }

        true
    })
}

fn should_prompt_install(
    startup_rule: &StartupRule,
    prefs: &mcpviews_shared::PluginPreferences,
) -> bool {
    let Some(source) = startup_rule.source.as_ref() else {
        return true;
    };

    if source.source_type != "setup_question" || source.skip_install_values.is_empty() {
        return true;
    }

    let Some(answer) = prefs.setup_answers.get(&source.question_id) else {
        return false;
    };

    !source
        .skip_install_values
        .iter()
        .any(|value| value == &answer.value)
}

pub(crate) fn evaluate_startup_rule_actions(
    config: &ProjectStartupRulesConfig,
    resolved_rules: &[ResolvedStartupRule],
) -> Value {
    let mut needs_install = Vec::new();
    let mut auto_update = Vec::new();
    let mut suppressed = Vec::new();
    let mut current = Vec::new();
    let mut orphaned = Vec::new();
    let resolved_keys = resolved_rules
        .iter()
        .map(|rule| rule.key.as_str())
        .collect::<BTreeSet<_>>();

    for rule in resolved_rules {
        match config.startup_rules.get(&rule.key) {
            None => {
                if rule.should_prompt_install {
                    needs_install.push(rule_action(rule, None, None, true));
                } else {
                    suppressed.push(rule_action(
                        rule,
                        None,
                        Some("fresh_install_suppressed_by_setup_answer"),
                        false,
                    ));
                }
            }
            Some(state) if state.do_not_install && state.locations.is_empty() => {
                suppressed.push(rule_action(
                    rule,
                    Some(state),
                    Some("do_not_install"),
                    false,
                ));
            }
            Some(state) if state.rule_version == rule.version && state.rule_hash == rule.hash => {
                current.push(rule_action(rule, Some(state), None, false));
            }
            Some(state) if state.do_not_update => {
                suppressed.push(rule_action(rule, Some(state), Some("do_not_update"), false));
            }
            Some(state) => {
                auto_update.push(rule_action(rule, Some(state), None, true));
            }
        }
    }

    for (key, state) in &config.startup_rules {
        if !resolved_keys.contains(key.as_str()) {
            orphaned.push(serde_json::json!({
                "key": key,
                "state": state,
                "reason": "not_returned_by_current_startup_rules"
            }));
        }
    }

    let status = if !needs_install.is_empty() {
        "needs_install"
    } else if !auto_update.is_empty() {
        "auto_update"
    } else {
        "current"
    };

    serde_json::json!({
        "status": status,
        "needs_install": needs_install,
        "auto_update": auto_update,
        "suppressed": suppressed,
        "current": current,
        "orphaned": orphaned,
        "instruction": "Install or update only startup_rule_actions.needs_install and startup_rule_actions.auto_update using the agent-native rule mechanism for the current harness, then call save_startup_rule_state with recorded file locations. When status is current, report the active startup_rule_actions.current titles and rule_ids so the user can verify which startup rules are loaded; do not summarize this as only no changes needed. Do not persist runtime rules, plugin_rules, renderer rules, DecidR/Ludflow workflow guidance, setup questions, plugin docs, or tool docs into native startup rule files. If a user declines installation, call save_startup_rule_state with do_not_install=true so MCPViews does not ask again. If a user declines updates for an installed rule, call save_startup_rule_state with do_not_update=true."
    })
}

pub(crate) fn build_codex_startup_rules_block_for_project(
    config: &ProjectStartupRulesConfig,
    resolved_rules: &[ResolvedStartupRule],
    existing_document: Option<&str>,
) -> String {
    let preserved_rules = existing_document
        .and_then(existing_codex_startup_rule_blocks)
        .unwrap_or_default();
    let mut block = format!(
        "{}\n\n<!-- mcpviews-startup-rules-schema: {} -->\n\n",
        CODEX_STARTUP_RULES_HEADING, STARTUP_RULES_SCHEMA_VERSION
    );

    for rule in resolved_rules {
        match config.startup_rules.get(&rule.key) {
            Some(state) if state.do_not_install && state.locations.is_empty() => continue,
            Some(state) if state.do_not_update => {
                if let Some(existing_block) = preserved_rules.get(&rule.key) {
                    block.push_str(existing_block.trim());
                    block.push_str("\n\n");
                }
                continue;
            }
            None if !rule.should_prompt_install => continue,
            _ => push_codex_startup_rule_block(&mut block, rule),
        }
    }

    block.trim_end().to_string() + "\n"
}

pub(crate) fn build_codex_startup_rules_block(rules: &[ResolvedStartupRule]) -> String {
    let mut block = format!(
        "{}\n\n<!-- mcpviews-startup-rules-schema: {} -->\n\n",
        CODEX_STARTUP_RULES_HEADING, STARTUP_RULES_SCHEMA_VERSION
    );

    for rule in rules {
        push_codex_startup_rule_block(&mut block, rule);
    }

    block.trim_end().to_string() + "\n"
}

fn push_codex_startup_rule_block(block: &mut String, rule: &ResolvedStartupRule) {
    block.push_str(&format!(
        "<!-- mcpviews-startup-rule: plugin={} rule_id={} version={} hash={} -->\n\n### {}\n\n{}\n\n",
        rule.plugin,
        rule.rule_id,
        rule.version,
        rule.hash,
        rule.title,
        rule.rule.trim()
    ));
}

fn existing_codex_startup_rule_blocks(document: &str) -> Option<BTreeMap<String, String>> {
    let (start, end) = find_heading_section(document, CODEX_STARTUP_RULES_HEADING)?;
    let section = &document[start..end];
    let mut blocks = BTreeMap::new();
    let marker = "<!-- mcpviews-startup-rule:";
    let mut search_from = 0;

    while let Some(relative_start) = section[search_from..].find(marker) {
        let block_start = search_from + relative_start;
        let after_marker = block_start + marker.len();
        let block_end = section[after_marker..]
            .find(marker)
            .map(|offset| after_marker + offset)
            .unwrap_or(section.len());
        let block = section[block_start..block_end].trim();

        if let Some((plugin, rule_id)) = parse_codex_startup_rule_marker(block) {
            blocks.insert(startup_rule_key(&plugin, &rule_id), block.to_string());
        }

        search_from = block_end;
    }

    Some(blocks)
}

fn parse_codex_startup_rule_marker(block: &str) -> Option<(String, String)> {
    let line = block.lines().next()?.trim();
    if !line.starts_with("<!-- mcpviews-startup-rule:") {
        return None;
    }

    let marker_body = line
        .trim_start_matches("<!--")
        .trim_end_matches("-->")
        .trim()
        .strip_prefix("mcpviews-startup-rule:")?
        .trim();
    let mut plugin = None;
    let mut rule_id = None;

    for part in marker_body.split_whitespace() {
        if let Some(value) = part.strip_prefix("plugin=") {
            plugin = Some(value.to_string());
        } else if let Some(value) = part.strip_prefix("rule_id=") {
            rule_id = Some(value.to_string());
        }
    }

    Some((plugin?, rule_id?))
}

pub(crate) fn replace_managed_startup_rules_section(
    document: &str,
    replacement_block: &str,
) -> String {
    let Some((start, end)) = find_managed_section(document) else {
        let mut result = document.trim_end().to_string();
        if !result.is_empty() {
            result.push_str("\n\n");
        }
        result.push_str(replacement_block.trim_end());
        result.push('\n');
        return result;
    };

    let mut result = String::new();
    result.push_str(document[..start].trim_end());
    if !result.is_empty() {
        result.push_str("\n\n");
    }
    result.push_str(replacement_block.trim_end());
    if end < document.len() {
        result.push_str("\n\n");
        result.push_str(document[end..].trim_start_matches('\n'));
    } else {
        result.push('\n');
    }
    result
}

pub(crate) fn codex_native_rule_context(project_path: &Path) -> Value {
    let target_path = project_path.join(CODEX_NATIVE_RULE_FILE);
    let project_rule_file = codex_rule_file_summary(&target_path);
    let ancestor_rule_files = ancestor_codex_rule_files(project_path);
    let nested_rule_files = nested_codex_rule_files(project_path, 3, 50);
    let mut warnings = Vec::new();

    let project_has_startup = project_rule_file
        .get("contains_mcpviews_startup_rules")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let ancestor_startup_paths = ancestor_rule_files
        .iter()
        .filter(|file| {
            file.get("contains_mcpviews_startup_rules")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .filter_map(|file| file.get("path").and_then(Value::as_str))
        .collect::<Vec<_>>();
    let nested_without_startup = nested_rule_files
        .iter()
        .filter(|file| {
            !file
                .get("contains_mcpviews_startup_rules")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .filter_map(|file| file.get("path").and_then(Value::as_str))
        .collect::<Vec<_>>();

    if !project_has_startup && !ancestor_startup_paths.is_empty() {
        warnings.push(format!(
            "MCPViews startup rules exist in ancestor AGENTS.md file(s): {}. Install or update the returned block in '{}' for this Codex project root; saved Codex projects may not load parent AGENTS files as startup rules.",
            ancestor_startup_paths.join(", "),
            target_path.display()
        ));
    }

    if !nested_rule_files.is_empty() {
        warnings.push(format!(
            "Nested AGENTS.md files exist under '{}'. If a fresh Codex session starts in one of those nested project roots, rerun init_session/mcpviews_setup with that nested path as project_path and install the startup block there too.",
            project_path.display()
        ));
    }

    if project_has_startup && !nested_without_startup.is_empty() {
        warnings.push(format!(
            "Some nested AGENTS.md files do not contain MCPViews startup rules: {}. Parent installation alone may not affect sessions opened directly in those nested projects.",
            nested_without_startup.join(", ")
        ));
    }

    serde_json::json!({
        "target_rule_file": target_path.display().to_string(),
        "project_rule_file": project_rule_file,
        "ancestor_rule_files": ancestor_rule_files,
        "nested_rule_files": nested_rule_files,
        "warnings": warnings,
        "instruction": format!(
            "Install/update the managed MCPViews startup block in '{}' for this exact project_path. Do not rely on a parent AGENTS.md when Codex is running from a nested saved project.",
            target_path.display()
        )
    })
}

fn ancestor_codex_rule_files(project_path: &Path) -> Vec<Value> {
    let mut files = Vec::new();
    let mut current = project_path.parent();
    while let Some(parent) = current {
        let path = parent.join(CODEX_NATIVE_RULE_FILE);
        if path.exists() {
            files.push(codex_rule_file_summary(&path));
        }
        current = parent.parent();
    }
    files
}

fn nested_codex_rule_files(project_path: &Path, max_depth: usize, limit: usize) -> Vec<Value> {
    let mut files = Vec::new();
    collect_nested_codex_rule_files(project_path, project_path, max_depth, limit, &mut files);
    files
}

fn collect_nested_codex_rule_files(
    root: &Path,
    current: &Path,
    remaining_depth: usize,
    limit: usize,
    files: &mut Vec<Value>,
) {
    if remaining_depth == 0 || files.len() >= limit {
        return;
    }

    let Ok(entries) = std::fs::read_dir(current) else {
        return;
    };

    for entry in entries.flatten() {
        if files.len() >= limit {
            break;
        }
        let path = entry.path();
        if !path.is_dir() || should_skip_codex_scan_dir(&path) {
            continue;
        }

        let agent_path = path.join(CODEX_NATIVE_RULE_FILE);
        if agent_path.exists() && agent_path != root.join(CODEX_NATIVE_RULE_FILE) {
            files.push(codex_rule_file_summary(&agent_path));
        }

        collect_nested_codex_rule_files(root, &path, remaining_depth - 1, limit, files);
    }
}

fn should_skip_codex_scan_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };

    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "dist" | "build" | "out" | "release" | "coverage"
        )
}

fn codex_rule_file_summary(path: &Path) -> Value {
    let content = std::fs::read_to_string(path).unwrap_or_default();
    serde_json::json!({
        "path": path.display().to_string(),
        "exists": path.exists(),
        "contains_mcpviews_startup_rules": content.contains("mcpviews-startup-rules-schema"),
        "contains_legacy_mcpviews_rules": content.contains("mcpviews-rules-version"),
        "contains_gronk_speak": content.contains("GronkSpeak"),
    })
}

fn find_managed_section(document: &str) -> Option<(usize, usize)> {
    find_heading_section(document, CODEX_STARTUP_RULES_HEADING)
        .or_else(|| find_legacy_mcpviews_rules_section(document))
}

fn find_heading_section(document: &str, heading: &str) -> Option<(usize, usize)> {
    let start = if document.starts_with(heading) {
        0
    } else {
        document.find(&format!("\n{}", heading))? + 1
    };
    let after_heading = start + heading.len();
    let end = document[after_heading..]
        .find("\n## ")
        .map(|offset| after_heading + offset)
        .unwrap_or(document.len());
    Some((start, end))
}

fn find_legacy_mcpviews_rules_section(document: &str) -> Option<(usize, usize)> {
    let marker = document.find("<!-- mcpviews-rules-version:")?;
    let start = document[..marker]
        .rfind("\n## ")
        .map(|index| index + 1)
        .unwrap_or(0);
    let end = document[marker..]
        .find("\n## ")
        .map(|offset| marker + offset)
        .unwrap_or(document.len());
    Some((start, end))
}

fn rule_action(
    rule: &ResolvedStartupRule,
    state: Option<&StartupRuleState>,
    reason: Option<&str>,
    include_rule_text: bool,
) -> Value {
    let mut action = serde_json::json!({
        "key": rule.key,
        "plugin": rule.plugin,
        "rule_id": rule.rule_id,
        "title": rule.title,
        "description": rule.description,
        "rule_version": rule.version,
        "rule_hash": rule.hash,
    });

    if include_rule_text {
        action["rule"] = Value::String(rule.rule.clone());
    }

    if let Some(reason) = reason {
        action["reason"] = Value::String(reason.to_string());
    }

    if let Some(state) = state {
        action["state"] = serde_json::json!(state);
    }

    action
}

pub(crate) fn save_startup_rule_state_from_args(arguments: Value) -> Result<Value, String> {
    let project_path = arguments
        .get("project_path")
        .and_then(|value| value.as_str())
        .ok_or("Missing required parameter: project_path")?;
    let plugin = arguments
        .get("plugin")
        .and_then(|value| value.as_str())
        .ok_or("Missing required parameter: plugin")?;
    let rule_id = arguments
        .get("rule_id")
        .and_then(|value| value.as_str())
        .ok_or("Missing required parameter: rule_id")?;
    let rule_version = arguments
        .get("rule_version")
        .and_then(|value| value.as_str())
        .ok_or("Missing required parameter: rule_version")?;
    let rule_hash = arguments
        .get("rule_hash")
        .and_then(|value| value.as_str())
        .ok_or("Missing required parameter: rule_hash")?;

    let locations = parse_locations(arguments.get("locations"))?;
    let do_not_install = arguments
        .get("do_not_install")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let do_not_update = arguments
        .get("do_not_update")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let project_path = PathBuf::from(project_path);
    let mut config = load_or_create_project_config(&project_path)?;
    let key = startup_rule_key(plugin, rule_id);
    let state = StartupRuleState {
        plugin: plugin.to_string(),
        rule_id: rule_id.to_string(),
        rule_version: rule_version.to_string(),
        rule_hash: rule_hash.to_string(),
        locations,
        do_not_install,
        do_not_update,
        updated_at: Some(chrono::Utc::now().to_rfc3339()),
    };
    config.startup_rules.insert(key.clone(), state.clone());
    save_project_config(&project_path, &config)?;

    Ok(serde_json::json!({
        "status": "saved",
        "project_path": project_path.display().to_string(),
        "key": key,
        "state": state,
        "message": "Startup rule state saved. MCPViews did not write agent-native rule files; it only recorded the project ledger."
    }))
}

fn parse_locations(value: Option<&Value>) -> Result<Vec<StartupRuleLocation>, String> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    serde_json::from_value(value.clone())
        .map_err(|error| format!("Invalid locations array for startup rule state: {}", error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use mcpviews_shared::{
        PluginPreferences, SetupPreferenceAnswer, StartupRule, StartupRuleCondition,
        StartupRuleSource,
    };

    fn manifest_with_rule(startup_rule: StartupRule) -> PluginManifest {
        PluginManifest {
            name: "test-plugin".to_string(),
            version: "1.0.0".to_string(),
            standalone_group: None,
            standalone_group_label: None,
            renderers: std::collections::HashMap::new(),
            frame_origins: vec![],
            mcp: None,
            renderer_definitions: vec![],
            tool_rules: std::collections::HashMap::new(),
            no_auto_push: vec![],
            registry_index: None,
            download_url: None,
            prompt_definitions: vec![],
            plugin_rules: vec![],
            plugin_rule_definitions: vec![],
            startup_rules: vec![startup_rule],
            setup_questions: vec![],
        }
    }

    fn static_rule(id: &str, version: &str, rule: &str) -> StartupRule {
        StartupRule {
            id: id.to_string(),
            version: version.to_string(),
            title: "Test startup rule".to_string(),
            description: Some("Loads before session start.".to_string()),
            rule: Some(rule.to_string()),
            source: None,
            conditions: vec![],
        }
    }

    #[test]
    fn test_project_config_create_load_and_migrate_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let config = load_or_create_project_config(dir.path()).unwrap();
        assert_eq!(config.schema_version, 1);
        assert!(project_config_path(dir.path()).exists());

        std::fs::write(
            project_config_path(dir.path()),
            r#"{ "startup_rules": {} }"#,
        )
        .unwrap();
        let migrated = load_or_create_project_config(dir.path()).unwrap();
        assert_eq!(migrated.schema_version, 1);
        assert!(migrated.startup_rules.is_empty());
    }

    #[test]
    fn test_evaluate_startup_rule_actions_missing_current_stale_and_suppressed() {
        let rule = ResolvedStartupRule {
            key: "test-plugin:rule".to_string(),
            plugin: "test-plugin".to_string(),
            rule_id: "rule".to_string(),
            version: "1".to_string(),
            title: "Rule".to_string(),
            description: None,
            rule: "Do the thing.".to_string(),
            hash: startup_rule_hash("Do the thing."),
            should_prompt_install: true,
        };

        let empty = ProjectStartupRulesConfig::default();
        let actions = evaluate_startup_rule_actions(&empty, &[rule.clone()]);
        assert_eq!(actions["needs_install"].as_array().unwrap().len(), 1);
        assert_eq!(
            actions["needs_install"].as_array().unwrap()[0]["rule"],
            "Do the thing."
        );

        let mut config = ProjectStartupRulesConfig::default();
        config.startup_rules.insert(
            rule.key.clone(),
            StartupRuleState {
                plugin: rule.plugin.clone(),
                rule_id: rule.rule_id.clone(),
                rule_version: rule.version.clone(),
                rule_hash: rule.hash.clone(),
                locations: vec![StartupRuleLocation {
                    agent_type: "codex".to_string(),
                    path: "AGENTS.md".to_string(),
                    label: "MCPViews startup rule".to_string(),
                }],
                do_not_install: false,
                do_not_update: false,
                updated_at: None,
            },
        );
        let actions = evaluate_startup_rule_actions(&config, &[rule.clone()]);
        assert_eq!(actions["current"].as_array().unwrap().len(), 1);
        assert!(actions["current"].as_array().unwrap()[0]
            .get("rule")
            .is_none());
        assert_eq!(
            actions["current"].as_array().unwrap()[0]["rule_hash"],
            rule.hash
        );

        config.startup_rules.get_mut(&rule.key).unwrap().rule_hash = "sha256:old".to_string();
        let actions = evaluate_startup_rule_actions(&config, &[rule.clone()]);
        assert_eq!(actions["auto_update"].as_array().unwrap().len(), 1);
        assert_eq!(
            actions["auto_update"].as_array().unwrap()[0]["rule"],
            "Do the thing."
        );

        config
            .startup_rules
            .get_mut(&rule.key)
            .unwrap()
            .do_not_update = true;
        let actions = evaluate_startup_rule_actions(&config, &[rule.clone()]);
        assert_eq!(
            actions["suppressed"].as_array().unwrap()[0]["reason"],
            "do_not_update"
        );

        let mut declined = ProjectStartupRulesConfig::default();
        declined.startup_rules.insert(
            rule.key.clone(),
            StartupRuleState {
                plugin: rule.plugin.clone(),
                rule_id: rule.rule_id.clone(),
                rule_version: rule.version.clone(),
                rule_hash: rule.hash.clone(),
                locations: vec![],
                do_not_install: true,
                do_not_update: false,
                updated_at: None,
            },
        );
        let actions = evaluate_startup_rule_actions(&declined, &[rule]);
        assert_eq!(
            actions["suppressed"].as_array().unwrap()[0]["reason"],
            "do_not_install"
        );
    }

    #[test]
    fn test_save_startup_rule_state_records_locations_without_writing_rules() {
        let dir = tempfile::tempdir().unwrap();
        let hash = startup_rule_hash("Use terse output.");
        let result = save_startup_rule_state_from_args(serde_json::json!({
            "project_path": dir.path().display().to_string(),
            "plugin": "mcpviews-gronk-speak",
            "rule_id": "gronk_mode",
            "rule_version": "1",
            "rule_hash": hash,
            "locations": [{
                "agent_type": "codex",
                "path": "AGENTS.md",
                "label": "MCPViews startup rule"
            }]
        }))
        .unwrap();

        assert_eq!(result["status"], "saved");
        let config = load_or_create_project_config(dir.path()).unwrap();
        let state = config
            .startup_rules
            .get("mcpviews-gronk-speak:gronk_mode")
            .unwrap();
        assert_eq!(state.locations[0].path, "AGENTS.md");
        assert!(!dir.path().join("AGENTS.md").exists());
    }

    #[test]
    fn test_setup_sourced_startup_rule_skips_off_fresh_install_but_updates_existing() {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::with_dir(dir.path().join("plugins"));
        let startup_rule = StartupRule {
            id: "gronk_mode".to_string(),
            version: "1".to_string(),
            title: "Gronk mode".to_string(),
            description: None,
            rule: None,
            source: Some(StartupRuleSource {
                source_type: "setup_question".to_string(),
                question_id: "mode".to_string(),
                skip_install_values: vec!["off".to_string()],
            }),
            conditions: vec![],
        };
        let manifest = manifest_with_rule(startup_rule);
        let mut prefs = PluginPreferences::default();
        prefs.setup_answers.insert(
            "mode".to_string(),
            SetupPreferenceAnswer {
                value: "off".to_string(),
                persist_as_rule_name: Some("gronk_mode".to_string()),
                persisted_rule: Some("Gronk mode is off.".to_string()),
                source: "chat".to_string(),
                plugin_version: Some("1.0.0".to_string()),
                updated_at: None,
            },
        );
        store.save_preferences("test-plugin", &prefs).unwrap();

        let resolved = resolve_startup_rules(&[manifest], &store);
        assert_eq!(resolved.len(), 1);
        assert!(!resolved[0].should_prompt_install);

        let actions =
            evaluate_startup_rule_actions(&ProjectStartupRulesConfig::default(), &resolved);
        assert_eq!(
            actions["suppressed"].as_array().unwrap()[0]["reason"],
            "fresh_install_suppressed_by_setup_answer"
        );

        let mut installed = ProjectStartupRulesConfig::default();
        installed.startup_rules.insert(
            resolved[0].key.clone(),
            StartupRuleState {
                plugin: resolved[0].plugin.clone(),
                rule_id: resolved[0].rule_id.clone(),
                rule_version: "0".to_string(),
                rule_hash: "sha256:old".to_string(),
                locations: vec![StartupRuleLocation {
                    agent_type: "codex".to_string(),
                    path: "AGENTS.md".to_string(),
                    label: "MCPViews startup rule".to_string(),
                }],
                do_not_install: false,
                do_not_update: false,
                updated_at: None,
            },
        );
        let actions = evaluate_startup_rule_actions(&installed, &resolved);
        assert_eq!(actions["auto_update"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_setup_sourced_startup_rule_conditions_gate_companion_rules() {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::with_dir(dir.path().join("plugins"));
        let startup_rule = StartupRule {
            id: "gronk_scope".to_string(),
            version: "1".to_string(),
            title: "Gronk scope".to_string(),
            description: None,
            rule: None,
            source: Some(StartupRuleSource {
                source_type: "setup_question".to_string(),
                question_id: "scope".to_string(),
                skip_install_values: vec![],
            }),
            conditions: vec![StartupRuleCondition {
                question_id: "mode".to_string(),
                values: vec![],
                not_values: vec!["off".to_string()],
            }],
        };
        let manifest = manifest_with_rule(startup_rule);
        let mut prefs = PluginPreferences::default();
        prefs.setup_answers.insert(
            "mode".to_string(),
            SetupPreferenceAnswer {
                value: "off".to_string(),
                persist_as_rule_name: Some("gronk_mode".to_string()),
                persisted_rule: Some("Gronk mode is off.".to_string()),
                source: "chat".to_string(),
                plugin_version: Some("1.0.0".to_string()),
                updated_at: None,
            },
        );
        prefs.setup_answers.insert(
            "scope".to_string(),
            SetupPreferenceAnswer {
                value: "chat".to_string(),
                persist_as_rule_name: Some("gronk_scope".to_string()),
                persisted_rule: Some("Gronk scope is chat.".to_string()),
                source: "chat".to_string(),
                plugin_version: Some("1.0.0".to_string()),
                updated_at: None,
            },
        );
        store.save_preferences("test-plugin", &prefs).unwrap();
        assert!(resolve_startup_rules(&[manifest.clone()], &store).is_empty());

        let mut prefs = store.load_preferences("test-plugin");
        prefs.setup_answers.get_mut("mode").unwrap().value = "lite".to_string();
        store.save_preferences("test-plugin", &prefs).unwrap();
        assert_eq!(resolve_startup_rules(&[manifest], &store).len(), 1);
    }

    #[test]
    fn test_static_startup_rule_resolves() {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::with_dir(dir.path().join("plugins"));
        let manifest = manifest_with_rule(static_rule("rule", "1", "Always do this."));

        let resolved = resolve_startup_rules(&[manifest], &store);

        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].hash, startup_rule_hash("Always do this."));
        assert!(resolved[0].should_prompt_install);
    }

    #[test]
    fn test_resolve_all_startup_rules_includes_core_init_rule() {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::with_dir(dir.path().join("plugins"));
        let manifest = manifest_with_rule(static_rule("GronkSpeak", "2", "Talk terse."));

        let resolved = resolve_all_startup_rules(&[manifest], &store);

        assert_eq!(resolved.len(), 2);
        assert_eq!(resolved[0].plugin, CORE_STARTUP_RULE_PLUGIN);
        assert_eq!(resolved[0].rule_id, CORE_INIT_SESSION_PROJECT_PATH_RULE_ID);
        assert!(resolved[0].rule.contains("project_path"));
        assert_eq!(resolved[1].rule_id, "GronkSpeak");
    }

    #[test]
    fn test_evaluate_reports_orphaned_old_gronk_keys_without_reinstalling_them() {
        let new_gronk = ResolvedStartupRule {
            key: "mcpviews-gronk-speak:GronkSpeak".to_string(),
            plugin: "mcpviews-gronk-speak".to_string(),
            rule_id: "GronkSpeak".to_string(),
            version: "3".to_string(),
            title: "GronkSpeak".to_string(),
            description: None,
            rule: "GronkSpeak active.".to_string(),
            hash: startup_rule_hash("GronkSpeak active."),
            should_prompt_install: true,
        };
        let mut config = ProjectStartupRulesConfig::default();
        config.startup_rules.insert(
            "mcpviews-gronk-speak:mcpviews_gronk_speak_mode".to_string(),
            StartupRuleState {
                plugin: "mcpviews-gronk-speak".to_string(),
                rule_id: "mcpviews_gronk_speak_mode".to_string(),
                rule_version: "1".to_string(),
                rule_hash: "sha256:old".to_string(),
                locations: vec![StartupRuleLocation {
                    agent_type: "codex".to_string(),
                    path: "AGENTS.md".to_string(),
                    label: "Project AGENTS.md".to_string(),
                }],
                do_not_install: false,
                do_not_update: false,
                updated_at: None,
            },
        );

        let actions = evaluate_startup_rule_actions(&config, &[new_gronk]);

        assert_eq!(actions["needs_install"].as_array().unwrap().len(), 1);
        assert_eq!(actions["auto_update"].as_array().unwrap().len(), 0);
        assert_eq!(actions["orphaned"].as_array().unwrap().len(), 1);
        assert_eq!(
            actions["orphaned"].as_array().unwrap()[0]["key"],
            "mcpviews-gronk-speak:mcpviews_gronk_speak_mode"
        );
    }

    #[test]
    fn test_codex_startup_block_replaces_legacy_all_rules_section_only() {
        let rules = vec![
            core_init_session_project_path_rule(),
            ResolvedStartupRule {
                key: "mcpviews-gronk-speak:GronkSpeak".to_string(),
                plugin: "mcpviews-gronk-speak".to_string(),
                rule_id: "GronkSpeak".to_string(),
                version: "3".to_string(),
                title: "GronkSpeak".to_string(),
                description: None,
                rule: "GronkSpeak active. Technical terms exact.".to_string(),
                hash: startup_rule_hash("GronkSpeak active. Technical terms exact."),
                should_prompt_install: true,
            },
        ];
        let replacement = build_codex_startup_rules_block(&rules);
        let legacy = "\
# AGENTS.md

Keep this user-authored rule.

## MCPViews

<!-- mcpviews-rules-version: 21 -->

### Renderer Selection

Use rich_content.

### DecidR

Fetch governance_lifecycle.

## Local Section

Preserve me.
";

        let migrated = replace_managed_startup_rules_section(legacy, &replacement);

        assert!(migrated.contains("Keep this user-authored rule."));
        assert!(migrated.contains("## MCPViews Startup Rules"));
        assert!(migrated.contains("plugin=mcpviews-core rule_id=init_session_project_path"));
        assert!(migrated.contains("plugin=mcpviews-gronk-speak rule_id=GronkSpeak"));
        assert!(migrated.contains("GronkSpeak active."));
        assert!(migrated.contains("## Local Section"));
        assert!(!migrated.contains("mcpviews-rules-version"));
        assert!(!migrated.contains("### Renderer Selection"));
        assert!(!migrated.contains("### DecidR"));
    }

    #[test]
    fn test_codex_startup_block_preserves_declined_update_from_existing_file() {
        let new_rule = ResolvedStartupRule {
            key: "test-plugin:rule".to_string(),
            plugin: "test-plugin".to_string(),
            rule_id: "rule".to_string(),
            version: "2".to_string(),
            title: "Updated rule".to_string(),
            description: None,
            rule: "New rule text that user declined.".to_string(),
            hash: startup_rule_hash("New rule text that user declined."),
            should_prompt_install: true,
        };
        let mut config = ProjectStartupRulesConfig::default();
        config.startup_rules.insert(
            new_rule.key.clone(),
            StartupRuleState {
                plugin: new_rule.plugin.clone(),
                rule_id: new_rule.rule_id.clone(),
                rule_version: "1".to_string(),
                rule_hash: "sha256:old".to_string(),
                locations: vec![StartupRuleLocation {
                    agent_type: "codex".to_string(),
                    path: "AGENTS.md".to_string(),
                    label: "Project AGENTS.md".to_string(),
                }],
                do_not_install: false,
                do_not_update: true,
                updated_at: None,
            },
        );
        let existing = "\
# AGENTS.md

## MCPViews Startup Rules

<!-- mcpviews-startup-rules-schema: 1 -->

<!-- mcpviews-startup-rule: plugin=test-plugin rule_id=rule version=1 hash=sha256:old -->

### Old rule

Old rule text user chose to keep.

## Local Section

Preserve me separately.
";

        let block =
            build_codex_startup_rules_block_for_project(&config, &[new_rule], Some(existing));

        assert!(block.contains("version=1 hash=sha256:old"));
        assert!(block.contains("Old rule text user chose to keep."));
        assert!(!block.contains("New rule text that user declined."));
        assert!(!block.contains("## Local Section"));
    }

    #[test]
    fn test_codex_native_rule_context_warns_about_parent_only_install() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path();
        let project = parent.join("nested");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(
            parent.join(CODEX_NATIVE_RULE_FILE),
            "## MCPViews Startup Rules\n\n<!-- mcpviews-startup-rules-schema: 1 -->\n\n### GronkSpeak\n",
        )
        .unwrap();
        std::fs::write(project.join(CODEX_NATIVE_RULE_FILE), "# Project rules\n").unwrap();

        let context = codex_native_rule_context(&project);

        assert_eq!(
            context["target_rule_file"],
            serde_json::json!(project.join(CODEX_NATIVE_RULE_FILE).display().to_string())
        );
        assert!(
            !context["project_rule_file"]["contains_mcpviews_startup_rules"]
                .as_bool()
                .unwrap()
        );
        assert_eq!(context["ancestor_rule_files"].as_array().unwrap().len(), 1);
        assert!(context["warnings"].as_array().unwrap()[0]
            .as_str()
            .unwrap()
            .contains("ancestor AGENTS.md"));
    }

    #[test]
    fn test_codex_native_rule_context_reports_nested_agents() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path();
        let nested = project.join("child");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(
            project.join(CODEX_NATIVE_RULE_FILE),
            "## MCPViews Startup Rules\n\n<!-- mcpviews-startup-rules-schema: 1 -->\n",
        )
        .unwrap();
        std::fs::write(nested.join(CODEX_NATIVE_RULE_FILE), "# Child rules\n").unwrap();

        let context = codex_native_rule_context(project);

        assert!(
            context["project_rule_file"]["contains_mcpviews_startup_rules"]
                .as_bool()
                .unwrap()
        );
        assert_eq!(context["nested_rule_files"].as_array().unwrap().len(), 1);
        assert!(context["warnings"].as_array().unwrap()[0]
            .as_str()
            .unwrap()
            .contains("Nested AGENTS.md"));
        assert!(context["warnings"].as_array().unwrap()[1]
            .as_str()
            .unwrap()
            .contains("Parent installation alone"));
    }
}
