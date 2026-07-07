use crate::mcp_tools::startup_rules::{
    load_or_create_project_config, save_project_config, ProjectContextDefault, ProjectContextHint,
};
use crate::plugin::{oauth_token_needs_preemptive_refresh, try_refresh_oauth, OAuthRefreshInfo};
use crate::state::AppState;
use mcpviews_shared::{PluginAuth, PluginContextProvider, PluginManifest};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const DEFAULT_CONTEXT_TYPE: &str = "organization";
const DEFAULT_ROUTING_ARG: &str = "organization_id";
const DEFAULT_PROVIDER_TOOL: &str = "list_organizations";
const DEFAULT_MAX_CONTEXTS: usize = 12;
const CATALOG_TTL: Duration = Duration::from_secs(300);

#[derive(Debug, Clone)]
pub(crate) struct ContextCatalogCache {
    entries: HashMap<String, CachedContextCatalog>,
}

impl ContextCatalogCache {
    pub(crate) fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    pub(crate) fn clear(&mut self) {
        self.entries.clear();
    }

    fn get(&self, plugin_name: &str) -> Option<Vec<ProviderContext>> {
        let entry = self.entries.get(plugin_name)?;
        if Instant::now() < entry.expires_at {
            return Some(entry.contexts.clone());
        }
        None
    }

    fn set(&mut self, plugin_name: &str, contexts: Vec<ProviderContext>) {
        self.entries.insert(
            plugin_name.to_string(),
            CachedContextCatalog {
                expires_at: Instant::now() + CATALOG_TTL,
                contexts,
            },
        );
    }
}

#[derive(Debug, Clone)]
struct CachedContextCatalog {
    expires_at: Instant,
    contexts: Vec<ProviderContext>,
}

#[derive(Debug, Clone)]
struct ProviderContext {
    id: String,
    name: Option<String>,
    slug: Option<String>,
    role: Option<String>,
    is_current: Option<bool>,
}

#[derive(Debug, Clone)]
struct ContextProviderInfo {
    plugin_name: String,
    plugin_label: String,
    context_type: String,
    routing_arg: String,
    provider_tool: String,
    label_fields: Vec<String>,
    mcp_url: Option<String>,
    auth: Option<PluginAuth>,
    standalone_renderers: Vec<StandaloneRendererInfo>,
}

#[derive(Debug, Clone)]
struct StandaloneRendererInfo {
    name: String,
    label: String,
    description: String,
}

#[derive(Debug, Clone)]
struct TokenContext {
    context_id: String,
    status: mcpviews_shared::token_store::StoredTokenStatus,
    refreshable: bool,
    has_token: bool,
    is_token_default: bool,
}

#[derive(Debug, Clone)]
struct ContextPluginSummary {
    provider: ContextProviderInfo,
    token_contexts: BTreeMap<String, TokenContext>,
    project_defaults: Vec<ProjectContextDefault>,
}

#[derive(Debug)]
struct ContextListOptions {
    project_path: Option<PathBuf>,
    plugin_names: Option<HashSet<String>>,
    include_contexts: bool,
    include_labels: bool,
    include_apps: bool,
    query: Option<String>,
    max_contexts_per_plugin: usize,
    refresh_catalog: bool,
}

impl ContextListOptions {
    fn from_args(arguments: &Value) -> Result<Self, String> {
        let plugin_names = parse_plugin_names(arguments.get("plugin_names"))?;
        let project_path = arguments
            .get("project_path")
            .and_then(Value::as_str)
            .map(|value| PathBuf::from(value.trim()))
            .filter(|value| !value.as_os_str().is_empty());

        Ok(Self {
            project_path,
            plugin_names,
            include_contexts: bool_arg(arguments, "include_contexts"),
            include_labels: bool_arg(arguments, "include_labels"),
            include_apps: bool_arg(arguments, "include_apps"),
            query: arguments
                .get("query")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_lowercase()),
            max_contexts_per_plugin: arguments
                .get("max_contexts_per_plugin")
                .and_then(Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
                .filter(|value| *value > 0)
                .unwrap_or(DEFAULT_MAX_CONTEXTS),
            refresh_catalog: bool_arg(arguments, "refresh_catalog"),
        })
    }

    fn needs_catalog(&self) -> bool {
        self.include_labels || self.query.is_some()
    }
}

pub(crate) fn invalidate_context_catalog(app_state: &AppState) {
    if let Ok(mut cache) = app_state.context_catalog_cache.lock() {
        cache.clear();
    }
}

pub(crate) fn collect_compact_project_context_defaults(
    project_path: Option<&str>,
    manifests: &[PluginManifest],
    auth_dir: &Path,
) -> Value {
    let Some(project_path) = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    else {
        return Value::Null;
    };

    let config = match load_or_create_project_config(&project_path) {
        Ok(config) => config,
        Err(error) => {
            return serde_json::json!({
                "status": "error",
                "message": error,
            });
        }
    };
    let _ = reconcile_project_visible_shared_oauth_tokens_with_defaults(
        &config.context_defaults,
        manifests,
        auth_dir,
    );

    let defaults: Vec<Value> = config
        .context_defaults
        .iter()
        .map(|default| {
            let status = mcpviews_shared::token_store::token_status_for_org(
                auth_dir,
                &default.plugin_name,
                &default.context_id,
            );
            serde_json::json!({
                "plugin_name": default.plugin_name,
                "context_type": default.context_type,
                "context_id": default.context_id,
                "routing_arg": default.routing_arg,
                "scope": default.scope,
                "target_name": default.target_name,
                "status": status.as_str(),
                "refreshable": status.refreshable(),
                "usable": token_status_is_usable(status),
                "default_source": "project",
                "auth_action": auth_action_for_status(&default.plugin_name, &default.context_id, status),
            })
        })
        .collect();

    serde_json::json!({
        "project_path": project_path.display().to_string(),
        "defaults": defaults,
    })
}

pub(crate) fn collect_compact_project_context_hints(project_path: Option<&str>) -> Value {
    let Some(project_path) = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    else {
        return Value::Null;
    };

    let config = match load_or_create_project_config(&project_path) {
        Ok(config) => config,
        Err(error) => {
            return serde_json::json!({
                "status": "error",
                "message": error,
            });
        }
    };

    let hints: Vec<Value> = config
        .project_context_hints
        .iter()
        .map(|hint| {
            serde_json::json!({
                "plugin_name": hint.plugin_name,
                "key": hint.key,
                "value": hint.value,
                "label": hint.label,
                "default_source": "project",
            })
        })
        .collect();

    serde_json::json!({
        "project_path": project_path.display().to_string(),
        "hints": hints,
    })
}

pub(crate) fn project_context_hints_for_plugin(
    project_path: Option<&str>,
    plugin_name: &str,
) -> BTreeMap<String, String> {
    let Some(project_path) = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    else {
        return BTreeMap::new();
    };

    let Ok(config) = load_or_create_project_config(&project_path) else {
        return BTreeMap::new();
    };

    config
        .project_context_hints
        .into_iter()
        .filter(|hint| hint.plugin_name == plugin_name)
        .map(|hint| (hint.key, hint.value))
        .collect()
}

pub(crate) async fn list_contexts(arguments: Value, app_state: &AppState) -> Result<Value, String> {
    let options = ContextListOptions::from_args(&arguments)?;
    let response = list_contexts_value(options, app_state).await?;
    Ok(text_result(response))
}

pub(crate) async fn list_plugin_contexts_for_tauri(
    project_path: Option<String>,
    plugin_names: Option<Vec<String>>,
    include_contexts: Option<bool>,
    include_labels: Option<bool>,
    include_apps: Option<bool>,
    query: Option<String>,
    max_contexts_per_plugin: Option<usize>,
    refresh_catalog: Option<bool>,
    app_state: &AppState,
) -> Result<Value, String> {
    let project_path = project_path.or_else(|| {
        app_state
            .active_project_path
            .lock()
            .ok()
            .and_then(|path| path.clone())
            .map(|path| path.display().to_string())
    });
    let arguments = serde_json::json!({
        "project_path": project_path,
        "plugin_names": plugin_names,
        "include_contexts": include_contexts.unwrap_or(false),
        "include_labels": include_labels.unwrap_or(false),
        "include_apps": include_apps.unwrap_or(false),
        "query": query,
        "max_contexts_per_plugin": max_contexts_per_plugin.unwrap_or(DEFAULT_MAX_CONTEXTS),
        "refresh_catalog": refresh_catalog.unwrap_or(false),
    });
    let options = ContextListOptions::from_args(&arguments)?;
    list_contexts_value(options, app_state).await
}

pub(crate) async fn set_context_default(
    arguments: Value,
    app_state: &AppState,
) -> Result<Value, String> {
    let project_path = required_string(&arguments, "project_path")?;
    let plugin_name = required_string(&arguments, "plugin_name")?;
    let context_id = required_string(&arguments, "context_id")?;
    let scope = optional_string(&arguments, "scope").unwrap_or_else(|| "plugin".to_string());
    let target_name = optional_string(&arguments, "target_name");
    let label = optional_string(&arguments, "label");

    let default = set_context_default_inner(
        Path::new(&project_path),
        &plugin_name,
        &context_id,
        &scope,
        target_name.as_deref(),
        label.as_deref(),
        app_state,
    )?;
    invalidate_context_catalog(app_state);

    Ok(text_result(serde_json::json!({
        "status": "saved",
        "project_path": project_path,
        "default": default,
    })))
}

pub(crate) async fn set_project_context_hint(
    arguments: Value,
    app_state: &AppState,
) -> Result<Value, String> {
    let project_path = required_string(&arguments, "project_path")?;
    let plugin_name = required_string(&arguments, "plugin_name")?;
    let key = normalize_hint_key(&required_string(&arguments, "key")?)?;
    let value = required_string(&arguments, "value")?;
    let label = optional_string(&arguments, "label");

    let hint = set_project_context_hint_inner(
        Path::new(&project_path),
        &plugin_name,
        &key,
        &value,
        label.as_deref(),
        app_state,
    )?;

    Ok(text_result(serde_json::json!({
        "status": "saved",
        "project_path": project_path,
        "hint": hint,
    })))
}

pub(crate) fn set_plugin_context_default_for_tauri(
    project_path: Option<String>,
    plugin_name: String,
    context_id: String,
    scope: Option<String>,
    target_name: Option<String>,
    label: Option<String>,
    app_state: &AppState,
) -> Result<Value, String> {
    let project_path = project_path
        .or_else(|| {
            app_state
                .active_project_path
                .lock()
                .ok()
                .and_then(|path| path.clone())
                .map(|path| path.display().to_string())
        })
        .ok_or(
            "No project_path supplied and MCPViews has no active project path from init_session.",
        )?;
    let default = set_context_default_inner(
        Path::new(&project_path),
        &plugin_name,
        &context_id,
        scope.as_deref().unwrap_or("plugin"),
        target_name.as_deref(),
        label.as_deref(),
        app_state,
    )?;
    invalidate_context_catalog(app_state);
    Ok(serde_json::json!({
        "status": "saved",
        "project_path": project_path,
        "default": default,
    }))
}

fn set_context_default_inner(
    project_path: &Path,
    plugin_name: &str,
    context_id: &str,
    scope: &str,
    target_name: Option<&str>,
    label: Option<&str>,
    app_state: &AppState,
) -> Result<ProjectContextDefault, String> {
    let provider = provider_for_plugin(plugin_name, app_state)
        .ok_or_else(|| format!("Plugin '{}' does not expose context metadata.", plugin_name))?;
    let scope = normalize_scope(scope)?;
    let mut config = load_or_create_project_config(project_path)?;
    config.context_defaults.retain(|existing| {
        !(existing.plugin_name == plugin_name
            && existing.scope == scope
            && existing.target_name.as_deref() == target_name)
    });

    let default = ProjectContextDefault {
        plugin_name: plugin_name.to_string(),
        context_type: provider.context_type,
        context_id: context_id.to_string(),
        routing_arg: provider.routing_arg,
        scope,
        target_name: target_name.map(str::to_string),
        label: label.map(str::to_string),
        updated_at: Some(chrono::Utc::now().to_rfc3339()),
    };
    config.context_defaults.push(default.clone());
    save_project_config(project_path, &config)?;
    Ok(default)
}

fn set_project_context_hint_inner(
    project_path: &Path,
    plugin_name: &str,
    key: &str,
    value: &str,
    label: Option<&str>,
    app_state: &AppState,
) -> Result<ProjectContextHint, String> {
    let plugin_exists = {
        let registry = app_state.plugin_registry.lock().unwrap();
        registry
            .manifests
            .iter()
            .any(|manifest| manifest.name == plugin_name)
    };
    if !plugin_exists {
        return Err(format!("Plugin '{}' is not installed.", plugin_name));
    }

    let mut config = load_or_create_project_config(project_path)?;
    config
        .project_context_hints
        .retain(|existing| !(existing.plugin_name == plugin_name && existing.key == key));

    let hint = ProjectContextHint {
        plugin_name: plugin_name.to_string(),
        key: key.to_string(),
        value: value.to_string(),
        label: label.map(str::to_string),
        updated_at: Some(chrono::Utc::now().to_rfc3339()),
    };
    config.project_context_hints.push(hint.clone());
    save_project_config(project_path, &config)?;
    Ok(hint)
}

async fn list_contexts_value(
    options: ContextListOptions,
    app_state: &AppState,
) -> Result<Value, String> {
    let manifests = {
        let registry = app_state.plugin_registry.lock().unwrap();
        registry.manifests.clone()
    };
    let project_defaults = load_project_defaults(options.project_path.as_deref())?;
    let providers = providers_for_manifests(&manifests);
    let providers_by_name: BTreeMap<String, ContextProviderInfo> = providers
        .iter()
        .map(|provider| (provider.plugin_name.clone(), provider.clone()))
        .collect();
    let mut plugins = Vec::new();

    for provider in providers {
        if let Some(filter) = &options.plugin_names {
            if !filter.contains(provider.plugin_name.as_str()) {
                continue;
            }
        }

        let summary = context_plugin_summary(provider, &project_defaults, &app_state.auth_dir);
        plugins.push(
            plugin_summary_value(
                &summary,
                &options,
                app_state,
                &providers_by_name,
                &project_defaults,
            )
            .await?,
        );
    }

    Ok(serde_json::json!({
        "plugins": plugins,
        "total": plugins.len(),
        "project_path": options.project_path.map(|path| path.display().to_string()),
        "token_optimized": true,
    }))
}

async fn plugin_summary_value(
    summary: &ContextPluginSummary,
    options: &ContextListOptions,
    app_state: &AppState,
    providers_by_name: &BTreeMap<String, ContextProviderInfo>,
    project_defaults: &[ProjectContextDefault],
) -> Result<Value, String> {
    let mut catalog = if options.include_contexts && options.needs_catalog() {
        Some(provider_catalog(summary, options.refresh_catalog, app_state).await?)
    } else {
        None
    };
    let mut summary = summary.clone();
    if let Some(catalog) = catalog.as_deref() {
        if reconcile_catalog_shared_tokens(
            &summary,
            providers_by_name,
            catalog,
            &app_state.auth_dir,
        )? > 0
        {
            summary.token_contexts =
                token_context_map(&summary.provider.plugin_name, &app_state.auth_dir);
        }
    }
    if options.include_contexts
        && options.needs_catalog()
        && catalog
            .as_ref()
            .map(|contexts| contexts.is_empty())
            .unwrap_or(false)
    {
        if let Some(peer_catalog) = peer_catalog_for_shared_oauth_backfill(
            &summary,
            providers_by_name,
            project_defaults,
            options.refresh_catalog,
            app_state,
        )
        .await
        {
            let allowed_org_ids: Vec<String> = peer_catalog
                .iter()
                .map(|context| context.id.clone())
                .collect();
            if reconcile_shared_tokens_for_provider(
                &summary.provider,
                providers_by_name,
                &allowed_org_ids,
                &app_state.auth_dir,
            )? > 0
            {
                summary.token_contexts =
                    token_context_map(&summary.provider.plugin_name, &app_state.auth_dir);
                catalog = match provider_catalog(&summary, true, app_state).await {
                    Ok(refreshed) if !refreshed.is_empty() => Some(refreshed),
                    _ => Some(peer_catalog),
                };
            }
        }
    }

    let selected = selected_context(&summary, options.include_labels);
    let counts = status_counts(&summary.token_contexts);
    let mut value = serde_json::json!({
        "plugin_name": &summary.provider.plugin_name,
        "plugin_label": &summary.provider.plugin_label,
        "context_type": &summary.provider.context_type,
        "routing_arg": &summary.provider.routing_arg,
        "provider_tool": &summary.provider.provider_tool,
        "default_context": selected,
        "status_counts": counts,
        "project_defaults": project_defaults_for_response(&summary.project_defaults, options.include_labels),
    });

    if options.include_apps {
        value["apps"] = serde_json::json!(app_templates(&summary.provider, None));
    }

    if options.include_contexts {
        let contexts = context_rows(&summary, options, app_state, catalog.as_deref()).await?;
        value["contexts"] = Value::Array(contexts);
    }

    Ok(value)
}

fn context_plugin_summary(
    provider: ContextProviderInfo,
    project_defaults: &[ProjectContextDefault],
    auth_dir: &Path,
) -> ContextPluginSummary {
    ContextPluginSummary {
        token_contexts: token_context_map(&provider.plugin_name, auth_dir),
        project_defaults: project_defaults
            .iter()
            .filter(|default| default.plugin_name == provider.plugin_name)
            .cloned()
            .collect(),
        provider,
    }
}

async fn peer_catalog_for_shared_oauth_backfill(
    summary: &ContextPluginSummary,
    providers_by_name: &BTreeMap<String, ContextProviderInfo>,
    project_defaults: &[ProjectContextDefault],
    refresh_catalog: bool,
    app_state: &AppState,
) -> Option<Vec<ProviderContext>> {
    let target_auth = summary.provider.auth.as_ref()?;
    let peer_plugin =
        crate::shared_oauth_tokens::shared_oauth_peer_plugin(&summary.provider.plugin_name)?;
    let peer_provider = providers_by_name.get(peer_plugin)?;
    let peer_auth = peer_provider.auth.as_ref()?;
    if !crate::shared_oauth_tokens::oauth_auths_share_issuer_client(peer_auth, target_auth) {
        return None;
    }

    let peer_summary =
        context_plugin_summary(peer_provider.clone(), project_defaults, &app_state.auth_dir);
    if first_usable_context_id(&peer_summary).is_none() {
        return None;
    }

    match provider_catalog(&peer_summary, refresh_catalog, app_state).await {
        Ok(catalog) if !catalog.is_empty() => Some(catalog),
        Ok(_) => None,
        Err(error) => {
            eprintln!(
                "[mcpviews] Shared OAuth peer catalog unavailable for '{}' via '{}': {}",
                summary.provider.plugin_name, peer_plugin, error
            );
            None
        }
    }
}

async fn context_rows(
    summary: &ContextPluginSummary,
    options: &ContextListOptions,
    app_state: &AppState,
    catalog: Option<&[ProviderContext]>,
) -> Result<Vec<Value>, String> {
    let catalog = if let Some(catalog) = catalog {
        catalog.to_vec()
    } else if options.needs_catalog() {
        provider_catalog(summary, options.refresh_catalog, app_state).await?
    } else {
        Vec::new()
    };
    let mut rows_by_id = BTreeMap::new();

    for token in summary.token_contexts.values() {
        rows_by_id.insert(
            token.context_id.clone(),
            context_row_from_parts(
                summary,
                token,
                None,
                options.include_labels,
                options.include_apps,
            ),
        );
    }

    for provider_context in catalog {
        let status = summary
            .token_contexts
            .get(&provider_context.id)
            .map(|token| token.status)
            .unwrap_or(mcpviews_shared::token_store::StoredTokenStatus::Missing);
        let token = TokenContext {
            context_id: provider_context.id.clone(),
            status,
            refreshable: status.refreshable(),
            has_token: summary.token_contexts.contains_key(&provider_context.id),
            is_token_default: summary
                .token_contexts
                .get(&provider_context.id)
                .map(|token| token.is_token_default)
                .unwrap_or(false),
        };
        rows_by_id.insert(
            provider_context.id.clone(),
            context_row_from_parts(
                summary,
                &token,
                Some(&provider_context),
                options.include_labels,
                options.include_apps,
            ),
        );
    }

    let mut rows: Vec<Value> = rows_by_id.into_values().collect();
    if let Some(query) = &options.query {
        rows.retain(|row| row_matches_query(row, query));
    }
    rows.truncate(options.max_contexts_per_plugin);
    Ok(rows)
}

pub(crate) fn reconcile_project_visible_shared_oauth_tokens(
    project_path: &Path,
    manifests: &[PluginManifest],
    auth_dir: &Path,
) -> Result<usize, String> {
    let config = load_or_create_project_config(project_path)?;
    reconcile_project_visible_shared_oauth_tokens_with_defaults(
        &config.context_defaults,
        manifests,
        auth_dir,
    )
}

fn reconcile_project_visible_shared_oauth_tokens_with_defaults(
    defaults: &[ProjectContextDefault],
    manifests: &[PluginManifest],
    auth_dir: &Path,
) -> Result<usize, String> {
    let providers = providers_for_manifests(manifests);
    let providers_by_name: BTreeMap<String, ContextProviderInfo> = providers
        .into_iter()
        .map(|provider| (provider.plugin_name.clone(), provider))
        .collect();
    let mut mirrored = 0;

    for default in defaults {
        let Some(provider) = providers_by_name.get(&default.plugin_name) else {
            continue;
        };
        let allowed_org_ids = vec![default.context_id.clone()];
        mirrored += reconcile_shared_tokens_for_provider(
            provider,
            &providers_by_name,
            &allowed_org_ids,
            auth_dir,
        )?;
    }

    Ok(mirrored)
}

fn reconcile_catalog_shared_tokens(
    summary: &ContextPluginSummary,
    providers_by_name: &BTreeMap<String, ContextProviderInfo>,
    catalog: &[ProviderContext],
    auth_dir: &Path,
) -> Result<usize, String> {
    let allowed_org_ids: Vec<String> = catalog.iter().map(|context| context.id.clone()).collect();
    reconcile_shared_tokens_for_provider(
        &summary.provider,
        providers_by_name,
        &allowed_org_ids,
        auth_dir,
    )
}

fn reconcile_shared_tokens_for_provider(
    target_provider: &ContextProviderInfo,
    providers_by_name: &BTreeMap<String, ContextProviderInfo>,
    allowed_org_ids: &[String],
    auth_dir: &Path,
) -> Result<usize, String> {
    let Some(target_auth) = target_provider.auth.as_ref() else {
        return Ok(0);
    };
    let Some(source_plugin) =
        crate::shared_oauth_tokens::shared_oauth_peer_plugin(&target_provider.plugin_name)
    else {
        return Ok(0);
    };
    let Some(source_provider) = providers_by_name.get(source_plugin) else {
        return Ok(0);
    };
    let Some(source_auth) = source_provider.auth.as_ref() else {
        return Ok(0);
    };

    let report = crate::shared_oauth_tokens::reconcile_shared_oauth_org_tokens(
        auth_dir,
        &target_provider.plugin_name,
        target_auth,
        &source_provider.plugin_name,
        source_auth,
        allowed_org_ids,
    )?;
    Ok(report.mirrored)
}

async fn provider_catalog(
    summary: &ContextPluginSummary,
    refresh_catalog: bool,
    app_state: &AppState,
) -> Result<Vec<ProviderContext>, String> {
    if !refresh_catalog {
        if let Ok(cache) = app_state.context_catalog_cache.lock() {
            if let Some(cached) = cache.get(&summary.provider.plugin_name) {
                return Ok(cached);
            }
        }
    }

    let contexts = fetch_provider_catalog(summary, app_state).await?;
    if let Ok(mut cache) = app_state.context_catalog_cache.lock() {
        cache.set(&summary.provider.plugin_name, contexts.clone());
    }
    Ok(contexts)
}

async fn fetch_provider_catalog(
    summary: &ContextPluginSummary,
    app_state: &AppState,
) -> Result<Vec<ProviderContext>, String> {
    let Some(mcp_url) = &summary.provider.mcp_url else {
        return Ok(Vec::new());
    };
    let Some(auth) = &summary.provider.auth else {
        return Ok(Vec::new());
    };
    let Some(auth_context_id) = first_usable_context_id(summary) else {
        return Ok(Vec::new());
    };

    let mut auth_header =
        auth.resolve_header_for_org(&summary.provider.plugin_name, &auth_context_id);
    if let PluginAuth::OAuth {
        client_id,
        token_url,
        ..
    } = auth
    {
        let oauth_info = OAuthRefreshInfo {
            plugin_name: summary.provider.plugin_name.clone(),
            token_url: token_url.clone(),
            client_id: client_id.clone(),
            org_id: Some(auth_context_id),
        };
        if auth_header.is_none() || oauth_token_needs_preemptive_refresh(&oauth_info) {
            if let Some(refreshed) = try_refresh_oauth(&oauth_info, &app_state.http_client).await {
                auth_header = Some(refreshed);
            }
        }
    }

    let rpc_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": summary.provider.provider_tool,
            "arguments": {}
        }
    });

    let mut request = app_state
        .http_client
        .post(mcp_url)
        .header("Accept", "application/json, text/event-stream")
        .json(&rpc_request);
    if let Some(header) = auth_header {
        request = request.header("Authorization", header);
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("Failed to fetch context catalog: {}", err))?;
    if !response.status().is_success() {
        return Err(format!(
            "Context provider '{}' returned HTTP {}.",
            summary.provider.provider_tool,
            response.status().as_u16()
        ));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse context provider response: {}", err))?;
    if let Some(error) = body.get("error") {
        return Err(format!(
            "Context provider error: {}",
            error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
        ));
    }
    let result = body
        .get("result")
        .cloned()
        .ok_or("Context provider response missing result.")?;
    Ok(parse_provider_contexts(&result))
}

fn parse_provider_contexts(result: &Value) -> Vec<ProviderContext> {
    let payload = parse_plugin_result_payload(result).unwrap_or_else(|| result.clone());
    let data = payload
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| payload.as_array());
    let Some(data) = data else {
        return Vec::new();
    };

    data.iter()
        .filter_map(|item| {
            let id = item
                .get("id")
                .or_else(|| item.get("context_id"))
                .or_else(|| item.get("organization_id"))
                .and_then(Value::as_str)?
                .to_string();
            Some(ProviderContext {
                id,
                name: item.get("name").and_then(Value::as_str).map(str::to_string),
                slug: item.get("slug").and_then(Value::as_str).map(str::to_string),
                role: item.get("role").and_then(Value::as_str).map(str::to_string),
                is_current: item.get("is_current").and_then(Value::as_bool),
            })
        })
        .collect()
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
        if item.get("type").and_then(Value::as_str) != Some("text") {
            continue;
        }
        let text = item.get("text").and_then(Value::as_str)?;
        if let Ok(parsed) = serde_json::from_str::<Value>(text) {
            return Some(parsed);
        }
    }
    None
}

fn providers_for_manifests(manifests: &[PluginManifest]) -> Vec<ContextProviderInfo> {
    manifests
        .iter()
        .filter_map(provider_from_manifest)
        .collect()
}

fn provider_for_plugin(plugin_name: &str, app_state: &AppState) -> Option<ContextProviderInfo> {
    let registry = app_state.plugin_registry.lock().unwrap();
    registry
        .manifests
        .iter()
        .find(|manifest| manifest.name == plugin_name)
        .and_then(provider_from_manifest)
}

fn provider_from_manifest(manifest: &PluginManifest) -> Option<ContextProviderInfo> {
    let provider = manifest
        .context_provider
        .clone()
        .or_else(|| inferred_context_provider(manifest))?;
    Some(ContextProviderInfo {
        plugin_name: manifest.name.clone(),
        plugin_label: plugin_label(manifest),
        context_type: provider.context_type,
        routing_arg: provider.routing_arg,
        provider_tool: provider.provider_tool,
        label_fields: provider.label_fields,
        mcp_url: manifest.mcp.as_ref().map(|mcp| mcp.url.clone()),
        auth: manifest.mcp.as_ref().and_then(|mcp| mcp.auth.clone()),
        standalone_renderers: standalone_renderers(manifest),
    })
}

fn inferred_context_provider(manifest: &PluginManifest) -> Option<PluginContextProvider> {
    let has_list_orgs_rule = manifest.tool_rules.contains_key(DEFAULT_PROVIDER_TOOL);
    let is_known = matches!(manifest.name.as_str(), "decidr" | "ludflow");
    if !has_list_orgs_rule && !is_known {
        return None;
    }
    Some(PluginContextProvider {
        context_type: DEFAULT_CONTEXT_TYPE.to_string(),
        routing_arg: DEFAULT_ROUTING_ARG.to_string(),
        provider_tool: DEFAULT_PROVIDER_TOOL.to_string(),
        label_fields: vec!["name".to_string(), "slug".to_string(), "role".to_string()],
    })
}

fn plugin_label(manifest: &PluginManifest) -> String {
    manifest
        .standalone_group_label
        .clone()
        .unwrap_or_else(|| humanize(&manifest.name))
}

fn humanize(value: &str) -> String {
    match value {
        "decidr" => "DecidR".to_string(),
        "ludflow" => "Ludflow".to_string(),
        _ => value
            .split(['-', '_'])
            .filter(|part| !part.is_empty())
            .map(|part| {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                    None => String::new(),
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
    }
}

fn standalone_renderers(manifest: &PluginManifest) -> Vec<StandaloneRendererInfo> {
    manifest
        .renderer_definitions
        .iter()
        .filter(|renderer| renderer.standalone)
        .map(|renderer| StandaloneRendererInfo {
            name: renderer.name.clone(),
            label: renderer
                .standalone_label
                .clone()
                .unwrap_or_else(|| renderer.name.clone()),
            description: renderer.description.clone(),
        })
        .collect()
}

fn token_context_map(plugin_name: &str, auth_dir: &Path) -> BTreeMap<String, TokenContext> {
    let token_default = mcpviews_shared::token_store::load_default_org(auth_dir, plugin_name);
    mcpviews_shared::token_store::list_orgs(auth_dir, plugin_name)
        .into_iter()
        .map(|context_id| {
            let status = mcpviews_shared::token_store::token_status_for_org(
                auth_dir,
                plugin_name,
                &context_id,
            );
            (
                context_id.clone(),
                TokenContext {
                    context_id: context_id.clone(),
                    status,
                    refreshable: status.refreshable(),
                    has_token: true,
                    is_token_default: token_default.as_deref() == Some(context_id.as_str()),
                },
            )
        })
        .collect()
}

fn load_project_defaults(
    project_path: Option<&Path>,
) -> Result<Vec<ProjectContextDefault>, String> {
    let Some(project_path) = project_path else {
        return Ok(Vec::new());
    };
    Ok(load_or_create_project_config(project_path)?.context_defaults)
}

fn project_defaults_for_response(
    defaults: &[ProjectContextDefault],
    include_labels: bool,
) -> Vec<Value> {
    defaults
        .iter()
        .map(|default| {
            let mut value = serde_json::json!({
                "plugin_name": default.plugin_name,
                "context_type": default.context_type,
                "context_id": default.context_id,
                "routing_arg": default.routing_arg,
                "scope": default.scope,
                "target_name": default.target_name,
                "updated_at": default.updated_at,
            });
            if include_labels {
                value["label"] = default
                    .label
                    .clone()
                    .map(Value::String)
                    .unwrap_or(Value::Null);
            }
            value
        })
        .collect()
}

fn selected_context(summary: &ContextPluginSummary, include_labels: bool) -> Value {
    if let Some(default) = summary
        .project_defaults
        .iter()
        .find(|default| default.scope == "plugin")
        .or_else(|| summary.project_defaults.first())
    {
        let status = summary
            .token_contexts
            .get(&default.context_id)
            .map(|token| token.status)
            .unwrap_or(mcpviews_shared::token_store::StoredTokenStatus::Missing);
        let mut value = serde_json::json!({
            "context_id": default.context_id,
            "source": "project",
            "scope": default.scope,
            "target_name": default.target_name,
            "status": status.as_str(),
            "refreshable": status.refreshable(),
            "usable": token_status_is_usable(status),
            "auth_action": auth_action_for_status(&summary.provider.plugin_name, &default.context_id, status),
        });
        if include_labels {
            value["label"] = default
                .label
                .clone()
                .map(Value::String)
                .unwrap_or(Value::Null);
        }
        return value;
    }

    if let Some(token) = summary
        .token_contexts
        .values()
        .find(|token| token.is_token_default && token_status_is_usable(token.status))
        .or_else(|| {
            summary
                .token_contexts
                .values()
                .find(|token| token_status_is_usable(token.status))
        })
    {
        return serde_json::json!({
            "context_id": token.context_id,
            "source": if token.is_token_default { "token_default" } else { "first_usable_token" },
            "status": token.status.as_str(),
            "refreshable": token.refreshable,
            "usable": true,
        });
    }

    Value::Null
}

fn first_usable_context_id(summary: &ContextPluginSummary) -> Option<String> {
    summary
        .token_contexts
        .values()
        .find(|token| token.is_token_default && token_status_is_usable(token.status))
        .or_else(|| {
            summary
                .token_contexts
                .values()
                .find(|token| token_status_is_usable(token.status))
        })
        .map(|token| token.context_id.clone())
}

fn context_row_from_parts(
    summary: &ContextPluginSummary,
    token: &TokenContext,
    provider_context: Option<&ProviderContext>,
    include_labels: bool,
    include_apps: bool,
) -> Value {
    let project_default = summary
        .project_defaults
        .iter()
        .find(|default| default.context_id == token.context_id);
    let mut row = serde_json::json!({
        "context_id": token.context_id,
        "context_type": summary.provider.context_type,
        "routing_arg": summary.provider.routing_arg,
        "status": token.status.as_str(),
        "refreshable": token.refreshable,
        "has_token": token.has_token,
        "usable": token_status_is_usable(token.status),
        "is_token_default": token.is_token_default,
        "is_project_default": project_default.is_some(),
        "project_default_scope": project_default.map(|default| default.scope.clone()),
        "auth_action": auth_action_for_status(&summary.provider.plugin_name, &token.context_id, token.status),
    });

    if include_labels {
        row["label"] = Value::String(
            provider_context
                .and_then(|context| context.name.clone())
                .or_else(|| project_default.and_then(|default| default.label.clone()))
                .unwrap_or_else(|| token.context_id.clone()),
        );
        if let Some(context) = provider_context {
            row["name"] = context
                .name
                .clone()
                .map(Value::String)
                .unwrap_or(Value::Null);
            row["slug"] = context
                .slug
                .clone()
                .map(Value::String)
                .unwrap_or(Value::Null);
            row["role"] = context
                .role
                .clone()
                .map(Value::String)
                .unwrap_or(Value::Null);
            row["is_current"] = context.is_current.map(Value::Bool).unwrap_or(Value::Null);
        }
        row["label_fields"] = serde_json::json!(summary.provider.label_fields);
    }

    if include_apps {
        row["apps"] = serde_json::json!(app_templates(&summary.provider, Some(&token.context_id)));
    }

    row
}

fn app_templates(provider: &ContextProviderInfo, context_id: Option<&str>) -> Vec<Value> {
    provider
        .standalone_renderers
        .iter()
        .map(|renderer| {
            let mut data = serde_json::Map::new();
            if let Some(context_id) = context_id {
                data.insert(
                    provider.routing_arg.clone(),
                    Value::String(context_id.to_string()),
                );
            }
            serde_json::json!({
                "renderer_name": renderer.name,
                "label": renderer.label,
                "description": renderer.description,
                "data": Value::Object(data),
            })
        })
        .collect()
}

fn status_counts(token_contexts: &BTreeMap<String, TokenContext>) -> Value {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for token in token_contexts.values() {
        *counts.entry(token.status.as_str().to_string()).or_default() += 1;
    }
    serde_json::json!(counts)
}

fn token_status_is_usable(status: mcpviews_shared::token_store::StoredTokenStatus) -> bool {
    matches!(
        status,
        mcpviews_shared::token_store::StoredTokenStatus::Valid
            | mcpviews_shared::token_store::StoredTokenStatus::ExpiredRefreshable
    )
}

fn auth_action_for_status(
    plugin_name: &str,
    context_id: &str,
    status: mcpviews_shared::token_store::StoredTokenStatus,
) -> Option<Value> {
    if token_status_is_usable(status) {
        return None;
    }
    Some(serde_json::json!({
        "tool": "start_plugin_auth",
        "arguments": {
            "plugin_name": plugin_name,
            "organization_id": context_id,
        },
        "reason": format!("context token is {}", status.as_str()),
    }))
}

fn row_matches_query(row: &Value, query: &str) -> bool {
    ["context_id", "label", "name", "slug", "role"]
        .iter()
        .filter_map(|field| row.get(*field).and_then(Value::as_str))
        .any(|value| value.to_lowercase().contains(query))
}

fn parse_plugin_names(value: Option<&Value>) -> Result<Option<HashSet<String>>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let Some(values) = value.as_array() else {
        return Err("plugin_names must be an array of plugin names.".to_string());
    };
    Ok(Some(
        values
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
    ))
}

fn bool_arg(arguments: &Value, key: &str) -> bool {
    arguments.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn required_string(arguments: &Value, key: &str) -> Result<String, String> {
    optional_string(arguments, key).ok_or_else(|| format!("Missing required parameter: {}", key))
}

fn optional_string(arguments: &Value, key: &str) -> Option<String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_scope(scope: &str) -> Result<String, String> {
    let scope = scope.trim();
    match scope {
        "plugin" | "tool" | "renderer" | "app" => Ok(scope.to_string()),
        _ => Err("scope must be one of: plugin, tool, renderer, app.".to_string()),
    }
}

fn normalize_hint_key(key: &str) -> Result<String, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("key is required.".to_string());
    }
    if key
        .chars()
        .any(|ch| !(ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.'))
    {
        return Err(
            "key may contain only letters, numbers, underscore, hyphen, or dot.".to_string(),
        );
    }
    let lowered = key.to_ascii_lowercase();
    let key_parts = lowered.split(['_', '-', '.']);
    if lowered.contains("token")
        || lowered.contains("secret")
        || lowered.contains("password")
        || lowered.contains("api_key")
        || lowered.contains("credential")
        || lowered.contains("authorization")
        || key_parts.clone().any(|part| part == "auth")
    {
        return Err("project context hints must not store auth or secret material.".to_string());
    }
    Ok(key.to_string())
}

fn text_result(value: Value) -> Value {
    serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string()),
        }]
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Json, Router};
    use tempfile::tempdir;
    use tokio::net::TcpListener;

    fn oauth(client_id: &str, token_url: &str) -> PluginAuth {
        PluginAuth::OAuth {
            client_id: Some(client_id.to_string()),
            auth_url: "https://app.ludflow.com/oauth/authorize".to_string(),
            token_url: token_url.to_string(),
            scopes: vec!["mcp:tools".to_string()],
            email_code_auth: None,
        }
    }

    fn context_manifest(name: &str, mcp_url: &str, auth: PluginAuth) -> PluginManifest {
        PluginManifest {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            standalone_group: None,
            standalone_group_label: None,
            renderers: std::collections::HashMap::new(),
            frame_origins: vec![],
            connect_origins: vec![],
            mcp: Some(mcpviews_shared::PluginMcpConfig {
                url: mcp_url.to_string(),
                auth: Some(auth),
                tool_prefix: name.to_string(),
            }),
            renderer_definitions: vec![],
            tool_rules: std::collections::HashMap::new(),
            no_auto_push: vec![],
            registry_index: None,
            download_url: None,
            prompt_definitions: vec![],
            plugin_rules: vec![],
            plugin_rule_definitions: vec![],
            startup_rules: vec![],
            setup_questions: vec![],
            init_context: None,
            context_provider: Some(PluginContextProvider {
                context_type: "organization".to_string(),
                routing_arg: "organization_id".to_string(),
                provider_tool: "list_organizations".to_string(),
                label_fields: vec!["name".to_string()],
            }),
        }
    }

    async fn mock_catalog_handler() -> Json<Value> {
        Json(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "content": [{
                    "type": "text",
                    "text": serde_json::json!({
                        "data": [{
                            "id": "org_1",
                            "name": "Shared Org",
                            "slug": "shared-org",
                            "role": "OWNER"
                        }]
                    }).to_string()
                }]
            }
        }))
    }

    #[test]
    fn context_cache_expires_entries() {
        let mut cache = ContextCatalogCache::new();
        cache.set(
            "decidr",
            vec![ProviderContext {
                id: "org_1".to_string(),
                name: Some("Org".to_string()),
                slug: None,
                role: None,
                is_current: None,
            }],
        );

        assert_eq!(cache.get("decidr").unwrap()[0].id, "org_1");
        cache.clear();
        assert!(cache.get("decidr").is_none());
    }

    #[test]
    fn project_context_default_round_trip_preserves_startup_rules() {
        let dir = tempdir().unwrap();

        let mut config = load_or_create_project_config(dir.path()).unwrap();
        config.startup_rules.insert(
            "plugin:rule".to_string(),
            crate::mcp_tools::startup_rules::StartupRuleState {
                plugin: "plugin".to_string(),
                rule_id: "rule".to_string(),
                rule_version: "1".to_string(),
                rule_hash: "sha256:test".to_string(),
                locations: Vec::new(),
                do_not_install: false,
                do_not_update: false,
                updated_at: None,
            },
        );
        save_project_config(dir.path(), &config).unwrap();

        let provider = ContextProviderInfo {
            plugin_name: "decidr".to_string(),
            plugin_label: "DecidR".to_string(),
            context_type: "organization".to_string(),
            routing_arg: "organization_id".to_string(),
            provider_tool: "list_organizations".to_string(),
            label_fields: vec![],
            mcp_url: None,
            auth: None,
            standalone_renderers: vec![],
        };
        let default = ProjectContextDefault {
            plugin_name: "decidr".to_string(),
            context_type: provider.context_type,
            context_id: "org_1".to_string(),
            routing_arg: provider.routing_arg,
            scope: "plugin".to_string(),
            target_name: None,
            label: Some("Org".to_string()),
            updated_at: Some("now".to_string()),
        };
        let mut config = load_or_create_project_config(dir.path()).unwrap();
        config.context_defaults.push(default);
        save_project_config(dir.path(), &config).unwrap();

        let saved = load_or_create_project_config(dir.path()).unwrap();
        assert_eq!(saved.startup_rules.len(), 1);
        assert_eq!(saved.context_defaults.len(), 1);
        assert_eq!(saved.context_defaults[0].context_id, "org_1");

        let project_path = dir.path().display().to_string();
        let compact = collect_compact_project_context_defaults(
            Some(&project_path),
            &[],
            &dir.path().join("auth"),
        );
        assert_eq!(compact["defaults"][0]["status"], "missing");
        assert!(compact["defaults"][0]["auth_action"].is_object());
        assert!(compact["defaults"][0].get("label").is_none());
        assert!(compact["defaults"][0].get("plugin_label").is_none());
        assert!(compact["defaults"][0].get("access_token").is_none());
        assert!(compact["defaults"][0].get("refresh_token").is_none());
    }

    #[test]
    fn project_context_hint_round_trip_is_separate_from_auth_defaults() {
        let dir = tempdir().unwrap();
        let project_dir = dir.path().join("project");
        std::fs::create_dir_all(&project_dir).unwrap();
        let auth_dir = dir.path().join("auth");
        let store =
            mcpviews_shared::plugin_store::PluginStore::with_dir(dir.path().join("plugins"));
        let state = AppState::new_with_store_and_auth_dir(store, auth_dir);
        state
            .plugin_registry
            .lock()
            .unwrap()
            .add_plugin(crate::test_utils::test_manifest("decidr"))
            .unwrap();

        let hint = set_project_context_hint_inner(
            &project_dir,
            "decidr",
            "project_id",
            "proj_1",
            Some("Tribe-X"),
            &state,
        )
        .unwrap();

        assert_eq!(hint.key, "project_id");
        let config = load_or_create_project_config(&project_dir).unwrap();
        assert!(config.context_defaults.is_empty());
        assert_eq!(config.project_context_hints.len(), 1);
        assert_eq!(config.project_context_hints[0].value, "proj_1");

        let project_path = project_dir.display().to_string();
        let compact = collect_compact_project_context_hints(Some(&project_path));
        assert_eq!(compact["hints"][0]["plugin_name"], "decidr");
        assert_eq!(compact["hints"][0]["key"], "project_id");
        assert_eq!(compact["hints"][0]["value"], "proj_1");
        assert!(compact["hints"][0].get("access_token").is_none());
        assert!(compact["hints"][0].get("refresh_token").is_none());

        let injected = project_context_hints_for_plugin(Some(&project_path), "decidr");
        assert_eq!(
            injected.get("project_id").map(String::as_str),
            Some("proj_1")
        );
        assert!(normalize_hint_key("api_token").is_err());
        assert!(normalize_hint_key("authorization").is_err());
        assert!(normalize_hint_key("oauth-credential").is_err());
        assert!(normalize_hint_key("client.auth").is_err());
    }

    #[test]
    fn set_plugin_context_default_uses_project_config_and_auth_dir() {
        let dir = tempdir().unwrap();
        let project_dir = dir.path().join("project");
        std::fs::create_dir_all(&project_dir).unwrap();
        let auth_dir = dir.path().join("auth");
        let store =
            mcpviews_shared::plugin_store::PluginStore::with_dir(dir.path().join("plugins"));
        let state = AppState::new_with_store_and_auth_dir(store, auth_dir.clone());
        let manifest = PluginManifest {
            name: "decidr".to_string(),
            version: "1.0.0".to_string(),
            standalone_group: None,
            standalone_group_label: None,
            renderers: std::collections::HashMap::new(),
            frame_origins: vec![],
            connect_origins: vec![],
            mcp: None,
            renderer_definitions: vec![],
            tool_rules: std::collections::HashMap::new(),
            no_auto_push: vec![],
            registry_index: None,
            download_url: None,
            prompt_definitions: vec![],
            plugin_rules: vec![],
            plugin_rule_definitions: vec![],
            startup_rules: vec![],
            setup_questions: vec![],
            init_context: None,
            context_provider: Some(PluginContextProvider {
                context_type: "organization".to_string(),
                routing_arg: "organization_id".to_string(),
                provider_tool: "list_organizations".to_string(),
                label_fields: vec!["name".to_string()],
            }),
        };
        state
            .plugin_registry
            .lock()
            .unwrap()
            .add_plugin(manifest)
            .unwrap();
        let token = mcpviews_shared::token_store::StoredToken {
            access_token: "tok".to_string(),
            refresh_token: Some("refresh".to_string()),
            expires_at: Some(4_102_444_800),
        };
        mcpviews_shared::token_store::store_token_for_org(&auth_dir, "decidr", "org_1", &token)
            .unwrap();

        set_plugin_context_default_for_tauri(
            Some(project_dir.display().to_string()),
            "decidr".to_string(),
            "org_1".to_string(),
            None,
            None,
            Some("Acme".to_string()),
            &state,
        )
        .unwrap();

        let config = load_or_create_project_config(&project_dir).unwrap();
        assert_eq!(config.context_defaults.len(), 1);
        assert_eq!(config.context_defaults[0].context_id, "org_1");
        assert_eq!(config.context_defaults[0].routing_arg, "organization_id");

        let manifests = state.plugin_registry.lock().unwrap().manifests.clone();
        let project_path = project_dir.display().to_string();
        let compact =
            collect_compact_project_context_defaults(Some(&project_path), &manifests, &auth_dir);
        assert_eq!(compact["defaults"][0]["status"], "valid");
        assert!(compact["defaults"][0].get("label").is_none());
    }

    #[tokio::test]
    async fn list_contexts_backfills_missing_peer_from_source_catalog() {
        let dir = tempdir().unwrap();
        let auth_dir = dir.path().join("auth");
        let store =
            mcpviews_shared::plugin_store::PluginStore::with_dir(dir.path().join("plugins"));
        let state = AppState::new_with_store_and_auth_dir(store, auth_dir.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route("/", post(mock_catalog_handler)),
            )
            .await
            .unwrap();
        });
        let mcp_url = format!("http://{addr}/");
        let auth = oauth("shared-client", "https://app.ludflow.com/oauth/token");
        {
            let mut registry = state.plugin_registry.lock().unwrap();
            registry
                .add_plugin(context_manifest("decidr", &mcp_url, auth.clone()))
                .unwrap();
            registry
                .add_plugin(context_manifest("ludflow", &mcp_url, auth))
                .unwrap();
        }

        let token = mcpviews_shared::token_store::StoredToken {
            access_token: "source_access".to_string(),
            refresh_token: Some("source_refresh".to_string()),
            expires_at: Some(4_102_444_800),
        };
        mcpviews_shared::token_store::store_token_for_org(&auth_dir, "ludflow", "org_1", &token)
            .unwrap();

        let response = list_contexts_value(
            ContextListOptions::from_args(&serde_json::json!({
                "plugin_names": ["decidr"],
                "include_contexts": true,
                "include_labels": true,
                "refresh_catalog": true
            }))
            .unwrap(),
            &state,
        )
        .await
        .unwrap();

        assert!(
            mcpviews_shared::token_store::load_stored_token_for_org_unvalidated(
                &auth_dir, "decidr", "org_1"
            )
            .is_some()
        );
        assert_eq!(response["plugins"][0]["contexts"][0]["context_id"], "org_1");
        assert_eq!(response["plugins"][0]["contexts"][0]["status"], "valid");
        assert_eq!(response["plugins"][0]["contexts"][0]["label"], "Shared Org");
    }
}
