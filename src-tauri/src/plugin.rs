use mcpviews_shared::plugin_store::PluginStore;
use mcpviews_shared::{PluginAuth, PluginInfo, PluginManifest};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::AsyncAppState;
use crate::tool_cache::ToolCache;

/// OAuth refresh info extracted while holding the lock, used after dropping it.
pub(crate) struct OAuthRefreshInfo {
    pub plugin_name: String,
    pub token_url: String,
    pub client_id: Option<String>,
    pub org_id: Option<String>,
}

const OAUTH_REFRESH_LEEWAY_SECONDS: i64 = 300;
static OAUTH_REFRESH_LOCKS: OnceLock<std::sync::Mutex<HashMap<String, Arc<TokioMutex<()>>>>> =
    OnceLock::new();

fn oauth_refresh_key(oauth_info: &OAuthRefreshInfo) -> String {
    format!(
        "{}:{}",
        oauth_info.plugin_name,
        oauth_info.org_id.as_deref().unwrap_or("_default")
    )
}

fn oauth_refresh_lock(oauth_info: &OAuthRefreshInfo) -> Arc<TokioMutex<()>> {
    let locks = OAUTH_REFRESH_LOCKS.get_or_init(|| std::sync::Mutex::new(HashMap::new()));
    let mut guard = locks.lock().unwrap();
    guard
        .entry(oauth_refresh_key(oauth_info))
        .or_insert_with(|| Arc::new(TokioMutex::new(())))
        .clone()
}

pub(crate) fn oauth_token_needs_preemptive_refresh(oauth_info: &OAuthRefreshInfo) -> bool {
    let auth_dir = mcpviews_shared::auth_dir();
    if let Some(org_id) = oauth_info.org_id.as_deref() {
        return mcpviews_shared::token_store::token_needs_preemptive_refresh_for_org(
            &auth_dir,
            &oauth_info.plugin_name,
            org_id,
            OAUTH_REFRESH_LEEWAY_SECONDS,
        );
    }
    mcpviews_shared::token_store::load_stored_token_unvalidated(
        &auth_dir,
        &oauth_info.plugin_name,
    )
    .map(|token| {
        token.refresh_token.is_some() && token.expires_within(OAUTH_REFRESH_LEEWAY_SECONDS)
    })
    .unwrap_or(false)
}

fn current_oauth_bearer_if_fresh(oauth_info: &OAuthRefreshInfo) -> Option<String> {
    let auth_dir = mcpviews_shared::auth_dir();
    let token = if let Some(org_id) = oauth_info.org_id.as_deref() {
        mcpviews_shared::token_store::load_stored_token_for_org(
            &auth_dir,
            &oauth_info.plugin_name,
            org_id,
        )
    } else {
        mcpviews_shared::token_store::load_stored_token(&auth_dir, &oauth_info.plugin_name)
    }?;
    if token.expires_within(OAUTH_REFRESH_LEEWAY_SECONDS) {
        return None;
    }
    Some(format!("Bearer {}", token.access_token))
}

/// Result of looking up a plugin tool by prefixed name.
pub(crate) struct PluginToolResult {
    pub plugin_name: String,
    pub mcp_url: String,
    pub auth_header: Option<String>,
    pub unprefixed_name: String,
    pub oauth_info: Option<OAuthRefreshInfo>,
    pub supports_email_code_auth: bool,
}

/// Attempt OAuth token refresh, returning "Bearer {token}" on success.
pub async fn try_refresh_oauth(
    oauth_info: &OAuthRefreshInfo,
    client: &reqwest::Client,
) -> Option<String> {
    refresh_oauth_with_lock(oauth_info, client, false).await
}

/// Force OAuth token refresh after a backend rejected the current access token.
pub async fn force_refresh_oauth(
    oauth_info: &OAuthRefreshInfo,
    client: &reqwest::Client,
) -> Option<String> {
    refresh_oauth_with_lock(oauth_info, client, true).await
}

async fn refresh_oauth_with_lock(
    oauth_info: &OAuthRefreshInfo,
    client: &reqwest::Client,
    force: bool,
) -> Option<String> {
    let lock = oauth_refresh_lock(oauth_info);
    let _guard = lock.lock().await;

    if !force {
        if let Some(existing) = current_oauth_bearer_if_fresh(oauth_info) {
            return Some(existing);
        }
    }

    match crate::auth::refresh_oauth_token(
        &oauth_info.plugin_name,
        &oauth_info.token_url,
        oauth_info.client_id.as_deref(),
        client,
        oauth_info.org_id.as_deref(),
    )
    .await
    {
        Ok(token) => {
            eprintln!(
                "[mcpviews] Auto-refreshed token for '{}'",
                oauth_info.plugin_name
            );
            Some(format!("Bearer {}", token))
        }
        Err(e) => {
            eprintln!(
                "[mcpviews] Token refresh failed for '{}': {}",
                oauth_info.plugin_name, e
            );
            None
        }
    }
}

pub struct PluginRegistry {
    pub manifests: Vec<PluginManifest>,
    pub tool_cache: ToolCache,
    store: PluginStore,
}

impl PluginRegistry {
    /// Load all plugin manifests using a provided PluginStore (useful for testing).
    pub fn load_plugins_with_store(store: PluginStore) -> Self {
        // Migrate legacy flat-file plugins to directory format
        if let Err(e) = store.migrate_legacy() {
            eprintln!("[mcpviews] Legacy plugin migration warning: {}", e);
        }
        let manifests = match store.list() {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[mcpviews] Failed to load plugins: {}", e);
                return Self {
                    manifests: Vec::new(),
                    tool_cache: ToolCache::new(0),
                    store,
                };
            }
        };

        for manifest in &manifests {
            eprintln!(
                "[mcpviews] Loaded plugin: {} v{}",
                manifest.name, manifest.version
            );
        }

        let tool_cache = ToolCache::new(manifests.len());

        Self {
            manifests,
            tool_cache,
            store,
        }
    }

    pub fn find_plugin_by_name(&self, name: &str) -> Option<(usize, &PluginManifest)> {
        self.manifests
            .iter()
            .enumerate()
            .find(|(_, m)| m.name == name)
    }

    /// Return indices of plugins whose tool cache is stale or empty
    pub fn stale_plugin_indices(&self) -> Vec<usize> {
        self.tool_cache
            .stale_indices(|i| self.manifests[i].mcp.is_some())
    }

    pub fn mark_refresh_pending(&mut self, idx: usize) {
        self.tool_cache.mark_pending(idx);
    }

    /// Refresh tool caches from plugin MCP backends
    pub async fn refresh_stale_plugins(
        state: &Arc<TokioMutex<AsyncAppState>>,
        client: &reqwest::Client,
    ) {
        // Collect info for plugins that need refresh
        let state_guard = state.lock().await;
        let mut to_refresh: Vec<(usize, String, Option<String>, Option<OAuthRefreshInfo>)> = {
            let registry = state_guard.inner.plugin_registry.lock().unwrap();
            let mut result = Vec::new();
            for i in 0..registry.manifests.len() {
                if registry.tool_cache.entries[i].refresh_pending {
                    if let Some(mcp) = &registry.manifests[i].mcp {
                        let auth = resolve_auth_header(&registry.manifests[i].name, &mcp.auth);
                        let oauth_info =
                            extract_oauth_refresh_info(&registry.manifests[i].name, &mcp.auth);
                        result.push((i, mcp.url.clone(), auth, oauth_info));
                    }
                }
            }
            result
        };
        drop(state_guard);

        // Attempt OAuth token refresh for entries where auth is missing or nearly expired.
        for entry in &mut to_refresh {
            if let Some(oauth_info) = &entry.3 {
                if entry.2.is_none() || oauth_token_needs_preemptive_refresh(oauth_info) {
                    if let Some(bearer) = try_refresh_oauth(oauth_info, client).await {
                        entry.2 = Some(bearer);
                    }
                }
            }
        }

        for (idx, url, auth, _) in to_refresh {
            match fetch_plugin_tools(client, &url, auth.as_deref()).await {
                Ok(tools) => {
                    apply_tool_cache(state, idx, tools).await;
                }
                Err(e) => {
                    eprintln!("{}", e);
                    clear_refresh_pending(state, idx).await;
                }
            }
        }
    }

    /// Return all cached plugin tools
    pub fn all_tools(&self) -> Vec<Value> {
        self.tool_cache.all_tools()
    }

    /// Find which plugin handles a tool, using organization_id from arguments for org-aware auth.
    pub fn find_plugin_for_tool_with_args(
        &self,
        prefixed_name: &str,
        arguments: &serde_json::Value,
    ) -> Option<PluginToolResult> {
        let idx = self.tool_cache.tool_index.get(prefixed_name)?;
        let manifest = self.manifests.get(*idx)?;
        let mcp = manifest.mcp.as_ref()?;
        let unprefixed = prefixed_name.strip_prefix(&mcp.tool_prefix)?;

        // Extract organization_id from tool arguments
        let org_id = arguments
            .get("organization_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Resolve auth header — use org-specific if org_id present
        let auth = if let Some(ref oid) = org_id {
            mcp.auth
                .as_ref()
                .and_then(|a| a.resolve_header_for_org(&manifest.name, oid))
        } else {
            resolve_auth_header(&manifest.name, &mcp.auth)
        };

        let oauth_info = extract_oauth_refresh_info(&manifest.name, &mcp.auth).map(|mut info| {
            info.org_id = org_id.clone();
            info
        });
        let supports_email_code_auth = mcp
            .auth
            .as_ref()
            .map(|auth| auth.supports_email_code())
            .unwrap_or(false);

        Some(PluginToolResult {
            plugin_name: manifest.name.clone(),
            mcp_url: mcp.url.clone(),
            auth_header: auth,
            unprefixed_name: unprefixed.to_string(),
            oauth_info,
            supports_email_code_auth,
        })
    }

    /// Add a new plugin at runtime, persisting its manifest to disk.
    pub fn add_plugin(&mut self, manifest: PluginManifest) -> Result<(), String> {
        if self.manifests.iter().any(|m| m.name == manifest.name) {
            return Err(format!("Plugin '{}' is already installed", manifest.name));
        }

        self.store.save(&manifest)?;

        eprintln!(
            "[mcpviews] Installed plugin: {} v{}",
            manifest.name, manifest.version
        );

        self.manifests.push(manifest);
        self.tool_cache.push();

        Ok(())
    }

    /// Remove a plugin by name, deleting its manifest from disk.
    pub fn remove_plugin(&mut self, name: &str) -> Result<(), String> {
        self.remove_plugin_in_memory(name)?;

        // Ignore error if file already gone
        let _ = self.store.remove(name);

        eprintln!("[mcpviews] Uninstalled plugin: {}", name);
        Ok(())
    }

    /// Remove a plugin from in-memory state only (manifests vec + tool cache).
    /// Does NOT delete files from disk. Used by zip-based install paths where
    /// the extraction has already placed files on disk and we don't want to
    /// delete them before re-adding the plugin.
    pub fn remove_plugin_in_memory(&mut self, name: &str) -> Result<(), String> {
        let idx = self
            .manifests
            .iter()
            .position(|m| m.name == name)
            .ok_or_else(|| format!("Plugin '{}' not found", name))?;

        self.manifests.remove(idx);
        self.tool_cache.remove(idx);
        self.tool_cache.rebuild_index();

        Ok(())
    }

    /// Extract the PluginAuth config for a plugin by name.
    pub fn resolve_plugin_auth(&self, plugin_name: &str) -> Result<PluginAuth, String> {
        let manifest = self
            .manifests
            .iter()
            .find(|m| m.name == plugin_name)
            .ok_or_else(|| format!("Plugin '{}' not found", plugin_name))?;
        manifest
            .mcp
            .as_ref()
            .and_then(|m| m.auth.clone())
            .ok_or_else(|| format!("Plugin '{}' has no auth config", plugin_name))
    }

    /// Return info about all loaded plugins, checking for updates against registry.
    pub fn list_plugins_with_updates(
        &self,
        registry_entries: &[mcpviews_shared::RegistryEntry],
    ) -> Vec<PluginInfo> {
        self.manifests
            .iter()
            .enumerate()
            .map(|(i, manifest)| {
                let auth_type = manifest
                    .mcp
                    .as_ref()
                    .and_then(|m| m.auth.as_ref().map(|a| a.display_name().to_string()));
                let auth_configured = manifest
                    .mcp
                    .as_ref()
                    .and_then(|m| m.auth.as_ref())
                    .map(|a| a.is_configured(&manifest.name))
                    .unwrap_or(true); // no auth needed = considered "configured"

                // Check for updates
                let update_available = registry_entries
                    .iter()
                    .find(|e| e.name == manifest.name)
                    .and_then(|e| mcpviews_shared::newer_version(&manifest.version, &e.version));

                PluginInfo {
                    name: manifest.name.clone(),
                    version: manifest.version.clone(),
                    has_mcp: manifest.mcp.is_some(),
                    auth_type,
                    auth_configured,
                    tool_count: self.tool_cache.tool_count(i),
                    update_available,
                }
            })
            .collect()
    }
}

/// Perform the MCP initialize -> notifications/initialized -> tools/list handshake,
/// returning the raw tool definitions on success.
async fn fetch_plugin_tools(
    client: &reqwest::Client,
    url: &str,
    auth: Option<&str>,
) -> Result<Vec<Value>, String> {
    // Initialize handshake
    let init_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {
                "name": "mcpviews",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    });

    let mut req_builder = client
        .post(url)
        .header("Accept", "application/json, text/event-stream")
        .json(&init_req);
    if let Some(auth_val) = auth {
        req_builder = req_builder.header("Authorization", auth_val);
    }

    let resp = req_builder
        .send()
        .await
        .map_err(|e| format!("[mcpviews] Plugin initialize failed ({}): {}", url, e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "[mcpviews] Plugin initialize returned HTTP {}",
            resp.status()
        ));
    }

    // Capture mcp-session-id for subsequent requests
    let session_id = resp
        .headers()
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Send initialized notification
    let notif = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });
    let mut notif_builder = client
        .post(url)
        .header("Accept", "application/json, text/event-stream")
        .json(&notif);
    if let Some(auth_val) = auth {
        notif_builder = notif_builder.header("Authorization", auth_val);
    }
    if let Some(ref sid) = session_id {
        notif_builder = notif_builder.header("mcp-session-id", sid);
    }
    let _ = notif_builder.send().await;

    // List tools
    let list_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list"
    });
    let mut list_builder = client
        .post(url)
        .header("Accept", "application/json, text/event-stream")
        .json(&list_req);
    if let Some(auth_val) = auth {
        list_builder = list_builder.header("Authorization", auth_val);
    }
    if let Some(ref sid) = session_id {
        list_builder = list_builder.header("mcp-session-id", sid);
    }

    let list_resp = list_builder
        .send()
        .await
        .map_err(|e| format!("[mcpviews] Plugin tools/list failed: {}", e))?;
    if !list_resp.status().is_success() {
        return Err(format!(
            "[mcpviews] Plugin tools/list returned HTTP {}",
            list_resp.status()
        ));
    }

    let body: Value = list_resp
        .json()
        .await
        .map_err(|e| format!("[mcpviews] Failed to parse tools/list response: {}", e))?;

    let tools = body
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();

    if tools.is_empty() {
        eprintln!(
            "[mcpviews] Plugin tools/list returned 0 tools from {} (response: {})",
            url,
            serde_json::to_string(&body).unwrap_or_default()
        );
    }

    Ok(tools)
}

/// Apply fetched tools to the plugin cache: prefix names, update tool_index, set timestamps.
async fn apply_tool_cache(state: &Arc<TokioMutex<AsyncAppState>>, idx: usize, tools: Vec<Value>) {
    let state_guard = state.lock().await;
    let mut registry = state_guard.inner.plugin_registry.lock().unwrap();

    let prefix = registry
        .manifests
        .get(idx)
        .and_then(|m| m.mcp.as_ref())
        .map(|m| m.tool_prefix.clone())
        .unwrap_or_default();

    registry.tool_cache.apply(idx, &prefix, tools);

    let tool_count = registry.tool_cache.tool_count(idx);
    let plugin_name = registry
        .manifests
        .get(idx)
        .map(|m| m.name.clone())
        .unwrap_or_default();

    eprintln!(
        "[mcpviews] Refreshed {} tools from plugin '{}'",
        tool_count, plugin_name
    );
}

async fn clear_refresh_pending(state: &Arc<TokioMutex<AsyncAppState>>, idx: usize) {
    let state_guard = state.lock().await;
    let mut registry = state_guard.inner.plugin_registry.lock().unwrap();
    registry.tool_cache.clear_pending(idx);
}

fn resolve_auth_header(plugin_name: &str, auth: &Option<PluginAuth>) -> Option<String> {
    auth.as_ref()?.resolve_header(plugin_name)
}

/// Extract OAuth refresh info from a plugin's auth config, if it's an OAuth type.
fn extract_oauth_refresh_info(
    plugin_name: &str,
    auth: &Option<PluginAuth>,
) -> Option<OAuthRefreshInfo> {
    match auth.as_ref()? {
        PluginAuth::OAuth {
            client_id,
            token_url,
            ..
        } => Some(OAuthRefreshInfo {
            plugin_name: plugin_name.to_string(),
            token_url: token_url.clone(),
            client_id: client_id.clone(),
            org_id: None,
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mcpviews_shared::{PluginAuth, PluginEmailCodeAuth, PluginMcpConfig};

    fn test_manifest(name: &str) -> PluginManifest {
        crate::test_utils::test_manifest(name)
    }

    fn test_registry() -> (PluginRegistry, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::with_dir(dir.path().to_path_buf());
        (PluginRegistry::load_plugins_with_store(store), dir)
    }

    #[test]
    fn test_resolve_plugin_auth_not_found() {
        let (registry, _dir) = test_registry();
        let result = registry.resolve_plugin_auth("nonexistent");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_resolve_plugin_auth_no_auth_config() {
        let (mut registry, _dir) = test_registry();
        // Manifest with mcp but no auth
        let mut manifest = test_manifest("no-auth-plugin");
        manifest.mcp = Some(PluginMcpConfig {
            url: "http://localhost:8080".into(),
            auth: None,
            tool_prefix: "nap__".into(),
        });
        registry.add_plugin(manifest).unwrap();

        let result = registry.resolve_plugin_auth("no-auth-plugin");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("has no auth config"));
    }

    #[test]
    fn test_resolve_plugin_auth_success() {
        let (mut registry, _dir) = test_registry();
        let mut manifest = test_manifest("auth-plugin");
        manifest.mcp = Some(PluginMcpConfig {
            url: "http://localhost:8080".into(),
            auth: Some(PluginAuth::Bearer {
                token_env: "TEST_TOKEN".into(),
            }),
            tool_prefix: "ap__".into(),
        });
        registry.add_plugin(manifest).unwrap();

        let result = registry.resolve_plugin_auth("auth-plugin");
        assert!(result.is_ok());
        match result.unwrap() {
            PluginAuth::Bearer { token_env } => assert_eq!(token_env, "TEST_TOKEN"),
            _ => panic!("Expected Bearer auth"),
        }
    }

    #[test]
    fn test_find_plugin_tool_marks_email_code_auth_support() {
        let (mut registry, _dir) = test_registry();
        let mut manifest = test_manifest("email-code-plugin");
        manifest.mcp = Some(PluginMcpConfig {
            url: "http://localhost:8080/api/mcp".into(),
            auth: Some(PluginAuth::OAuth {
                client_id: Some("client123".into()),
                auth_url: "https://example.com/auth".into(),
                token_url: "https://example.com/token".into(),
                scopes: vec![],
                email_code_auth: Some(PluginEmailCodeAuth {
                    enabled: true,
                    send_path: "/send".into(),
                    verify_path: "/verify".into(),
                }),
            }),
            tool_prefix: "ec__".into(),
        });
        registry.add_plugin(manifest).unwrap();
        registry
            .tool_cache
            .apply(0, "ec__", vec![serde_json::json!({ "name": "ping" })]);

        let result = registry
            .find_plugin_for_tool_with_args(
                "ec__ping",
                &serde_json::json!({ "organization_id": "org_1" }),
            )
            .unwrap();

        assert!(result.supports_email_code_auth);
        assert_eq!(result.oauth_info.unwrap().org_id.as_deref(), Some("org_1"));
    }
}
