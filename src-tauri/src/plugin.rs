use mcp_mux_shared::{PluginAuth, PluginInfo, PluginManifest};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::AsyncAppState;

const CACHE_TTL_SECS: u64 = 300; // 5 minutes

pub struct LoadedPlugin {
    pub manifest: PluginManifest,
    pub cached_tools: Vec<Value>,
    pub tools_fetched_at: Option<Instant>,
    pub refresh_pending: bool,
}

pub struct PluginRegistry {
    pub plugins: Vec<LoadedPlugin>,
    pub tool_index: HashMap<String, usize>, // prefixed_tool_name -> plugin index
}

impl PluginRegistry {
    /// Load all plugin manifests from ~/.mcp-mux/plugins/
    pub fn load_plugins() -> Self {
        let mut plugins = Vec::new();

        let plugin_dir = match dirs::home_dir() {
            Some(home) => home.join(".mcp-mux").join("plugins"),
            None => {
                eprintln!("[mcp-mux] Could not determine home directory for plugins");
                return Self {
                    plugins,
                    tool_index: HashMap::new(),
                };
            }
        };

        // Create directory if it doesn't exist
        if let Err(e) = std::fs::create_dir_all(&plugin_dir) {
            eprintln!(
                "[mcp-mux] Failed to create plugin directory {:?}: {}",
                plugin_dir, e
            );
            return Self {
                plugins,
                tool_index: HashMap::new(),
            };
        }

        let entries = match std::fs::read_dir(&plugin_dir) {
            Ok(entries) => entries,
            Err(e) => {
                eprintln!(
                    "[mcp-mux] Failed to read plugin directory {:?}: {}",
                    plugin_dir, e
                );
                return Self {
                    plugins,
                    tool_index: HashMap::new(),
                };
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                match std::fs::read_to_string(&path) {
                    Ok(content) => match serde_json::from_str::<PluginManifest>(&content) {
                        Ok(manifest) => {
                            eprintln!(
                                "[mcp-mux] Loaded plugin: {} v{}",
                                manifest.name, manifest.version
                            );
                            plugins.push(LoadedPlugin {
                                manifest,
                                cached_tools: Vec::new(),
                                tools_fetched_at: None,
                                refresh_pending: false,
                            });
                        }
                        Err(e) => {
                            eprintln!(
                                "[mcp-mux] Failed to parse plugin {:?}: {}",
                                path, e
                            );
                        }
                    },
                    Err(e) => {
                        eprintln!(
                            "[mcp-mux] Failed to read plugin {:?}: {}",
                            path, e
                        );
                    }
                }
            }
        }

        Self {
            plugins,
            tool_index: HashMap::new(),
        }
    }

    /// Return indices of plugins whose tool cache is stale or empty
    pub fn stale_plugin_indices(&self) -> Vec<usize> {
        self.plugins
            .iter()
            .enumerate()
            .filter(|(_, p)| {
                p.manifest.mcp.is_some()
                    && !p.refresh_pending
                    && match p.tools_fetched_at {
                        None => true,
                        Some(t) => t.elapsed().as_secs() > CACHE_TTL_SECS,
                    }
            })
            .map(|(i, _)| i)
            .collect()
    }

    pub fn mark_refresh_pending(&mut self, idx: usize) {
        if let Some(plugin) = self.plugins.get_mut(idx) {
            plugin.refresh_pending = true;
        }
    }

    /// Refresh tool caches from plugin MCP backends
    pub async fn refresh_stale_plugins(
        state: &Arc<TokioMutex<AsyncAppState>>,
        client: &reqwest::Client,
    ) {
        // Collect info for plugins that need refresh
        let state_guard = state.lock().await;
        let to_refresh: Vec<(usize, String, Option<String>)> = {
            let registry = state_guard.inner.plugin_registry.lock().unwrap();
            let mut result = Vec::new();
            for i in 0..registry.plugins.len() {
                let plugin = &registry.plugins[i];
                if plugin.refresh_pending {
                    if let Some(mcp) = &plugin.manifest.mcp {
                        let auth = resolve_auth_header(&plugin.manifest.name, &mcp.auth);
                        result.push((i, mcp.url.clone(), auth));
                    }
                }
            }
            result
        };
        drop(state_guard);

        for (idx, url, auth) in to_refresh {
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
        self.plugins
            .iter()
            .flat_map(|p| p.cached_tools.clone())
            .collect()
    }

    /// Find which plugin handles a prefixed tool name.
    /// Returns (mcp_url, auth_header, unprefixed_name, renderer_map)
    pub fn find_plugin_for_tool(
        &self,
        prefixed_name: &str,
    ) -> Option<(String, Option<String>, String, HashMap<String, String>)> {
        let idx = self.tool_index.get(prefixed_name)?;
        let plugin = self.plugins.get(*idx)?;
        let mcp = plugin.manifest.mcp.as_ref()?;
        let unprefixed = prefixed_name.strip_prefix(&mcp.tool_prefix)?;
        let auth = resolve_auth_header(&plugin.manifest.name, &mcp.auth);

        Some((
            mcp.url.clone(),
            auth,
            unprefixed.to_string(),
            plugin.manifest.renderers.clone(),
        ))
    }

    /// Add a new plugin at runtime, persisting its manifest to disk.
    pub fn add_plugin(&mut self, manifest: PluginManifest) -> Result<(), String> {
        // Check for duplicate name
        if self.plugins.iter().any(|p| p.manifest.name == manifest.name) {
            return Err(format!("Plugin '{}' is already installed", manifest.name));
        }

        // Ensure plugins directory exists and write manifest
        let plugin_dir = mcp_mux_shared::plugins_dir();
        std::fs::create_dir_all(&plugin_dir)
            .map_err(|e| format!("Failed to create plugins directory: {}", e))?;

        let path = plugin_dir.join(format!("{}.json", manifest.name));
        let json = serde_json::to_string_pretty(&manifest)
            .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
        std::fs::write(&path, json)
            .map_err(|e| format!("Failed to write manifest file: {}", e))?;

        eprintln!(
            "[mcp-mux] Installed plugin: {} v{}",
            manifest.name, manifest.version
        );

        self.plugins.push(LoadedPlugin {
            manifest,
            cached_tools: Vec::new(),
            tools_fetched_at: None,
            refresh_pending: false,
        });

        Ok(())
    }

    /// Remove a plugin by name, deleting its manifest from disk.
    pub fn remove_plugin(&mut self, name: &str) -> Result<(), String> {
        let idx = self
            .plugins
            .iter()
            .position(|p| p.manifest.name == name)
            .ok_or_else(|| format!("Plugin '{}' not found", name))?;

        self.plugins.remove(idx);

        // Delete the JSON file
        let path = mcp_mux_shared::plugins_dir().join(format!("{}.json", name));
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete manifest file: {}", e))?;
        }

        self.rebuild_tool_index();

        eprintln!("[mcp-mux] Uninstalled plugin: {}", name);
        Ok(())
    }

    /// Rebuild the tool_index from scratch based on current plugins and their cached tools.
    pub fn rebuild_tool_index(&mut self) {
        self.tool_index.clear();
        for (idx, plugin) in self.plugins.iter().enumerate() {
            for tool in &plugin.cached_tools {
                if let Some(name) = tool.get("name").and_then(|n| n.as_str()) {
                    self.tool_index.insert(name.to_string(), idx);
                }
            }
        }
    }

    /// Return info about all loaded plugins.
    pub fn list_plugins(&self) -> Vec<PluginInfo> {
        self.plugins
            .iter()
            .map(|p| {
                let auth_type = p.manifest.mcp.as_ref().and_then(|m| {
                    m.auth.as_ref().map(|a| match a {
                        PluginAuth::Bearer { .. } => "bearer".to_string(),
                        PluginAuth::ApiKey { .. } => "api_key".to_string(),
                        PluginAuth::OAuth { .. } => "oauth".to_string(),
                    })
                });
                PluginInfo {
                    name: p.manifest.name.clone(),
                    version: p.manifest.version.clone(),
                    has_mcp: p.manifest.mcp.is_some(),
                    auth_type,
                    tool_count: p.cached_tools.len(),
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
                "name": "mcp-mux",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    });

    let mut req_builder = client.post(url).json(&init_req);
    if let Some(auth_val) = auth {
        req_builder = req_builder.header("Authorization", auth_val);
    }

    let resp = req_builder
        .send()
        .await
        .map_err(|e| format!("[mcp-mux] Plugin initialize failed ({}): {}", url, e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "[mcp-mux] Plugin initialize returned HTTP {}",
            resp.status()
        ));
    }

    // Send initialized notification
    let notif = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });
    let mut notif_builder = client.post(url).json(&notif);
    if let Some(auth_val) = auth {
        notif_builder = notif_builder.header("Authorization", auth_val);
    }
    let _ = notif_builder.send().await;

    // List tools
    let list_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list"
    });
    let mut list_builder = client.post(url).json(&list_req);
    if let Some(auth_val) = auth {
        list_builder = list_builder.header("Authorization", auth_val);
    }

    let list_resp = list_builder
        .send()
        .await
        .map_err(|e| format!("[mcp-mux] Plugin tools/list failed: {}", e))?;
    if !list_resp.status().is_success() {
        return Err(format!(
            "[mcp-mux] Plugin tools/list returned HTTP {}",
            list_resp.status()
        ));
    }

    let body: Value = list_resp
        .json()
        .await
        .map_err(|e| format!("[mcp-mux] Failed to parse tools/list response: {}", e))?;

    Ok(body
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default())
}

/// Apply fetched tools to the plugin cache: prefix names, update tool_index, set timestamps.
async fn apply_tool_cache(
    state: &Arc<TokioMutex<AsyncAppState>>,
    idx: usize,
    tools: Vec<Value>,
) {
    let state_guard = state.lock().await;
    let mut registry = state_guard.inner.plugin_registry.lock().unwrap();
    if let Some(plugin) = registry.plugins.get(idx) {
        let prefix = plugin
            .manifest
            .mcp
            .as_ref()
            .map(|m| m.tool_prefix.clone())
            .unwrap_or_default();

        // Apply prefix to tool names and collect index updates
        let mut index_updates: Vec<(String, usize)> = Vec::new();
        let prefixed_tools: Vec<Value> = tools
            .into_iter()
            .map(|mut tool| {
                if let Some(name) = tool.get("name").and_then(|n| n.as_str()) {
                    let prefixed = format!("{}{}", prefix, name);
                    if let Some(obj) = tool.as_object_mut() {
                        obj.insert("name".to_string(), Value::String(prefixed.clone()));
                    }
                    index_updates.push((prefixed, idx));
                }
                tool
            })
            .collect();

        // Now mutate registry with collected data
        for (name, plugin_idx) in index_updates {
            registry.tool_index.insert(name, plugin_idx);
        }
        if let Some(plugin) = registry.plugins.get_mut(idx) {
            plugin.cached_tools = prefixed_tools;
            plugin.tools_fetched_at = Some(Instant::now());
            plugin.refresh_pending = false;

            eprintln!(
                "[mcp-mux] Refreshed {} tools from plugin '{}'",
                plugin.cached_tools.len(),
                plugin.manifest.name
            );
        }
    }
}

async fn clear_refresh_pending(state: &Arc<TokioMutex<AsyncAppState>>, idx: usize) {
    let state_guard = state.lock().await;
    let mut registry = state_guard.inner.plugin_registry.lock().unwrap();
    if let Some(plugin) = registry.plugins.get_mut(idx) {
        plugin.refresh_pending = false;
    }
}

fn resolve_auth_header(plugin_name: &str, auth: &Option<PluginAuth>) -> Option<String> {
    let auth = auth.as_ref()?;
    match auth {
        PluginAuth::Bearer { token_env } => match std::env::var(token_env) {
            Ok(token) => Some(format!("Bearer {}", token)),
            Err(_) => {
                eprintln!("[mcp-mux] Auth env var '{}' not set", token_env);
                None
            }
        },
        PluginAuth::ApiKey {
            header_name,
            key_env,
        } => {
            if let Some(env_var) = key_env {
                match std::env::var(env_var) {
                    Ok(key) => Some(format!("{}:{}", header_name, key)),
                    Err(_) => {
                        eprintln!("[mcp-mux] Auth env var '{}' not set", env_var);
                        None
                    }
                }
            } else {
                None
            }
        }
        PluginAuth::OAuth { .. } => {
            crate::auth::load_token(plugin_name).map(|t| format!("Bearer {}", t))
        }
    }
}
