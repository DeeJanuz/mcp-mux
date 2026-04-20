use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use tokio::sync::Mutex as TokioMutex;
use tokio::task::JoinHandle;
use tokio::time::Instant;

use reqwest_cookie_store::{CookieStore, CookieStoreMutex};

use mcpviews_shared::plugin_store::PluginStore;
use mcpviews_shared::{PluginManifest, RegistryEntry};

use crate::mcp_session::McpSessionManager;
use crate::plugin::PluginRegistry;
use crate::review::ReviewState;
use crate::session::SessionStore;

pub struct AppState {
    pub sessions: Mutex<SessionStore>,
    pub reviews: Mutex<ReviewState>,
    /// Maps session_id -> (deadline, original_timeout_secs)
    pub review_deadlines: Mutex<HashMap<String, (Arc<TokioMutex<Instant>>, u64)>>,
    pub plugin_registry: Mutex<PluginRegistry>,
    pub http_client: reqwest::Client,
    pub latest_registry: Mutex<Vec<RegistryEntry>>,
    pub mcp_sessions: Mutex<McpSessionManager>,
    pub first_party_ai_streams: Mutex<HashMap<String, JoinHandle<()>>>,
    pub first_party_ai_desktop_relay_streams: Mutex<HashMap<String, JoinHandle<()>>>,
    pub first_party_ai_desktop_presence_heartbeats: Mutex<HashMap<String, JoinHandle<()>>>,
    pub first_party_ai_realtime_relay_requests: Mutex<HashMap<String, String>>,
    pub first_party_ai_realtime_relay_stream_sessions: Mutex<HashMap<String, String>>,
    pub auth_dir: PathBuf,
    pub first_party_ai_cookie_store: Arc<CookieStoreMutex>,
    plugin_store: PluginStore,
}

impl AppState {
    pub fn new() -> Self {
        let store = PluginStore::new();
        ensure_bundled_plugins(&store);
        Self::new_with_store_and_auth_dir(store, mcpviews_shared::auth_dir())
    }

    /// Create an AppState with a custom PluginStore and auth dir (useful for tests).
    pub fn new_with_store_and_auth_dir(store: PluginStore, auth_dir: PathBuf) -> Self {
        let registry = PluginRegistry::load_plugins_with_store(store.clone());
        let first_party_ai_cookie_store =
            load_first_party_ai_cookie_store(&auth_dir.join("first_party_ai.cookies.json"));
        let http_client = reqwest::Client::builder()
            .cookie_provider(Arc::clone(&first_party_ai_cookie_store))
            .build()
            .expect("failed to build shared HTTP client");
        Self {
            sessions: Mutex::new(SessionStore::new()),
            reviews: Mutex::new(ReviewState::new()),
            review_deadlines: Mutex::new(HashMap::new()),
            plugin_registry: Mutex::new(registry),
            http_client,
            latest_registry: Mutex::new(Vec::new()),
            mcp_sessions: Mutex::new(McpSessionManager::new()),
            first_party_ai_streams: Mutex::new(HashMap::new()),
            first_party_ai_desktop_relay_streams: Mutex::new(HashMap::new()),
            first_party_ai_desktop_presence_heartbeats: Mutex::new(HashMap::new()),
            first_party_ai_realtime_relay_requests: Mutex::new(HashMap::new()),
            first_party_ai_realtime_relay_stream_sessions: Mutex::new(HashMap::new()),
            auth_dir,
            first_party_ai_cookie_store,
            plugin_store: store,
        }
    }

    pub fn first_party_ai_cookie_path(&self) -> PathBuf {
        self.auth_dir.join("first_party_ai.cookies.json")
    }

    pub fn persist_first_party_ai_cookies(&self) -> Result<(), String> {
        persist_first_party_ai_cookie_store(
            &self.first_party_ai_cookie_store,
            &self.first_party_ai_cookie_path(),
        )
    }

    pub fn clear_first_party_ai_cookies(&self) -> Result<(), String> {
        {
            let mut store = self
                .first_party_ai_cookie_store
                .lock()
                .map_err(|err| format!("Failed to lock first-party AI cookie store: {}", err))?;
            store.clear();
        }
        self.persist_first_party_ai_cookies()
    }

    /// Broadcast a tools/list_changed notification to all connected MCP SSE sessions.
    pub fn notify_tools_changed(&self) {
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/tools/list_changed"
        })
        .to_string();
        let sessions = self.mcp_sessions.lock().unwrap();
        sessions.broadcast(&notification);
    }

    /// Return the plugins directory path from the underlying PluginStore.
    pub fn plugins_dir(&self) -> &std::path::Path {
        self.plugin_store.dir()
    }

    /// Return a reference to the PluginStore.
    pub fn plugin_store(&self) -> &PluginStore {
        &self.plugin_store
    }

    /// Install a plugin from a parsed manifest, upserting (removing any existing plugin
    /// with the same name first). This is the core logic shared by MCP and Tauri commands.
    /// When `preserve_files` is true, only clears in-memory state on upsert (used by
    /// zip-based installs where extraction already placed files on disk).
    pub fn install_plugin_from_manifest(
        &self,
        manifest: mcpviews_shared::PluginManifest,
        preserve_files: bool,
    ) -> Result<String, String> {
        let plugin_name = manifest.name.clone();
        {
            let mut registry = self.plugin_registry.lock().unwrap();
            if registry.manifests.iter().any(|m| m.name == plugin_name) {
                if preserve_files {
                    let _ = registry.remove_plugin_in_memory(&plugin_name);
                } else {
                    let _ = registry.remove_plugin(&plugin_name);
                }
            }
            registry.add_plugin(manifest)?;
        }
        Ok(plugin_name)
    }

    /// Returns deduplicated origins (scheme + authority) from all installed plugin MCP URLs.
    pub fn plugin_csp_origins(&self) -> Vec<String> {
        let registry = self.plugin_registry.lock().unwrap();
        let mut origins = std::collections::HashSet::new();
        for manifest in &registry.manifests {
            if let Some(ref mcp) = manifest.mcp {
                if let Ok(url) = url::Url::parse(&mcp.url) {
                    let origin = format!("{}://{}", url.scheme(), url.authority());
                    origins.insert(origin);
                }
            }
        }
        origins.into_iter().collect()
    }

    /// Install or update a plugin from a registry entry.
    /// Downloads the ZIP package if a download URL is present (checking entry-level
    /// download_url first, then manifest-level), otherwise falls back to manifest-only.
    pub async fn install_or_update_from_entry(
        &self,
        entry: &RegistryEntry,
    ) -> Result<(), String> {
        // Priority: entry.download_url > entry.manifest.download_url > manifest-only
        let download_url = entry
            .download_url
            .as_deref()
            .or(entry.manifest.download_url.as_deref());

        if let Some(url) = download_url {
            let client = self.http_client.clone();
            let plugins_dir = mcpviews_shared::plugins_dir();
            let manifest = mcpviews_shared::package::download_and_install_plugin(
                &client,
                url,
                &plugins_dir,
            )
            .await?;

            let mut registry = self.plugin_registry.lock().unwrap();
            if registry.manifests.iter().any(|m| m.name == manifest.name) {
                // Only clear in-memory state — zip extraction already placed files on disk
                let _ = registry.remove_plugin_in_memory(&manifest.name);
            }
            registry.add_plugin(manifest)?;
        } else {
            let mut registry = self.plugin_registry.lock().unwrap();
            if registry
                .manifests
                .iter()
                .any(|m| m.name == entry.manifest.name)
            {
                // Only clear in-memory state — preserve on-disk renderer files
                // and other assets. add_plugin will rewrite manifest.json.
                let _ = registry.remove_plugin_in_memory(&entry.manifest.name);
            }
            registry.add_plugin(entry.manifest.clone())?;
        }

        Ok(())
    }

    /// Reload all plugins from disk and broadcast a tools/list_changed notification
    /// to all connected MCP SSE sessions.
    pub fn reload_plugins(&self) {
        let store = self.plugin_store.clone();
        let new_registry = PluginRegistry::load_plugins_with_store(store);
        {
            let mut registry = self.plugin_registry.lock().unwrap();
            *registry = new_registry;
        }
        self.notify_tools_changed();
    }
}

fn load_first_party_ai_cookie_store(path: &Path) -> Arc<CookieStoreMutex> {
    let store = File::open(path)
        .map(BufReader::new)
        .ok()
        .and_then(|reader| cookie_store::serde::json::load(reader).ok())
        .unwrap_or_else(CookieStore::new);
    Arc::new(CookieStoreMutex::new(store))
}

fn persist_first_party_ai_cookie_store(
    store: &Arc<CookieStoreMutex>,
    path: &Path,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create auth dir for first-party AI cookies: {}", err))?;
    }

    let file = File::create(path)
        .map_err(|err| format!("Failed to create first-party AI cookie file: {}", err))?;
    let mut writer = BufWriter::new(file);
    let store = store
        .lock()
        .map_err(|err| format!("Failed to lock first-party AI cookie store: {}", err))?;
    cookie_store::serde::json::save_incl_expired_and_nonpersistent(&store, &mut writer)
        .map_err(|err| format!("Failed to persist first-party AI cookies: {}", err))?;
    Ok(())
}

fn ensure_bundled_plugins(store: &PluginStore) {
    const BUNDLED_MANIFESTS: [&str; 1] = [include_str!("../../bundled-plugins/tribex-ai/manifest.json")];

    for manifest_json in BUNDLED_MANIFESTS {
        let manifest = match serde_json::from_str::<PluginManifest>(manifest_json) {
            Ok(manifest) => manifest,
            Err(error) => {
                eprintln!("[mcpviews] Failed to parse bundled plugin manifest: {}", error);
                continue;
            }
        };

        let needs_write = match store.load(&manifest.name) {
            Ok(existing) => existing.version != manifest.version,
            Err(_) => true,
        };

        if needs_write {
            if let Err(error) = store.save(&manifest) {
                eprintln!(
                    "[mcpviews] Failed to persist bundled plugin '{}': {}",
                    manifest.name, error
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::{test_app_state, test_manifest};

    #[test]
    fn test_new_with_store() {
        let (state, _dir) = test_app_state();
        let registry = state.plugin_registry.lock().unwrap();
        assert!(registry.manifests.is_empty(), "Fresh temp dir should have no plugins");
    }

    #[test]
    fn test_notify_tools_changed_no_sessions() {
        let (state, _dir) = test_app_state();
        // Should not panic even with no connected MCP sessions
        state.notify_tools_changed();
    }

    #[test]
    fn test_plugin_csp_origins_empty() {
        let (state, _dir) = test_app_state();
        let origins = state.plugin_csp_origins();
        assert!(origins.is_empty());
    }

    #[test]
    fn test_plugin_csp_origins_with_mcp() {
        let (state, _dir) = test_app_state();
        let mut manifest = test_manifest("test-plugin");
        manifest.mcp = Some(mcpviews_shared::PluginMcpConfig {
            url: "https://api.example.com/v1/mcp".to_string(),
            auth: None,
            tool_prefix: "test".to_string(),
        });
        state.install_plugin_from_manifest(manifest, false).unwrap();
        let origins = state.plugin_csp_origins();
        assert_eq!(origins.len(), 1);
        assert!(origins.contains(&"https://api.example.com".to_string()));
    }

    #[test]
    fn test_plugin_csp_origins_no_mcp() {
        let (state, _dir) = test_app_state();
        let manifest = test_manifest("no-mcp-plugin");
        state.install_plugin_from_manifest(manifest, false).unwrap();
        let origins = state.plugin_csp_origins();
        assert!(origins.is_empty());
    }

    #[test]
    fn test_plugin_csp_origins_deduplicates() {
        let (state, _dir) = test_app_state();
        let mut m1 = test_manifest("plugin-a");
        m1.mcp = Some(mcpviews_shared::PluginMcpConfig {
            url: "https://api.example.com/v1/mcp".to_string(),
            auth: None,
            tool_prefix: "a".to_string(),
        });
        let mut m2 = test_manifest("plugin-b");
        m2.mcp = Some(mcpviews_shared::PluginMcpConfig {
            url: "https://api.example.com/v2/other".to_string(),
            auth: None,
            tool_prefix: "b".to_string(),
        });
        state.install_plugin_from_manifest(m1, false).unwrap();
        state.install_plugin_from_manifest(m2, false).unwrap();
        let origins = state.plugin_csp_origins();
        assert_eq!(origins.len(), 1);
        assert!(origins.contains(&"https://api.example.com".to_string()));
    }

    #[test]
    fn test_reload_plugins() {
        let (state, dir) = test_app_state();

        // Verify initially empty
        {
            let registry = state.plugin_registry.lock().unwrap();
            assert!(registry.manifests.is_empty());
        }

        // Write a plugin manifest to the temp dir on disk
        let plugin_dir = dir.path().join("reload-test");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        let manifest = test_manifest("reload-test");
        let json = serde_json::to_string_pretty(&manifest).unwrap();
        std::fs::write(plugin_dir.join("manifest.json"), &json).unwrap();

        // Reload and verify the plugin appears
        state.reload_plugins();
        {
            let registry = state.plugin_registry.lock().unwrap();
            assert_eq!(registry.manifests.len(), 1);
            assert_eq!(registry.manifests[0].name, "reload-test");
        }
    }

    #[test]
    fn test_ensure_bundled_plugins_installs_manifest() {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::with_dir(dir.path().to_path_buf());

        ensure_bundled_plugins(&store);

        let manifest = store.load("tribex_ai").unwrap();
        assert_eq!(manifest.name, "tribex_ai");
        assert_eq!(manifest.version, "0.2.0");
    }

    #[test]
    fn test_first_party_ai_cookie_store_persists_across_reloads() {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::with_dir(dir.path().join("plugins"));
        let auth_dir = dir.path().join("auth");
        let state = AppState::new_with_store_and_auth_dir(store.clone(), auth_dir.clone());
        let request_url = url::Url::parse("https://ai.daenonjanis.com").unwrap();
        let cookie = cookie_store::RawCookie::parse(
            "tribex.session_token=test-session; Domain=ai.daenonjanis.com; Path=/; HttpOnly",
        )
        .unwrap()
        .into_owned();

        {
            let mut jar = state.first_party_ai_cookie_store.lock().unwrap();
            jar.insert_raw(&cookie, &request_url).unwrap();
        }

        state.persist_first_party_ai_cookies().unwrap();

        let reloaded = AppState::new_with_store_and_auth_dir(store, auth_dir);
        let jar = reloaded.first_party_ai_cookie_store.lock().unwrap();
        let cookies = jar
            .get_request_values(&request_url)
            .map(|(name, value)| format!("{}={}", name, value))
            .collect::<Vec<_>>();
        assert!(cookies.iter().any(|cookie| cookie == "tribex.session_token=test-session"));
    }

    #[test]
    fn test_relay_handles_start_empty() {
        let (state, _dir) = test_app_state();
        assert!(state.first_party_ai_desktop_relay_streams.lock().unwrap().is_empty());
        assert!(state
            .first_party_ai_desktop_presence_heartbeats
            .lock()
            .unwrap()
            .is_empty());
    }
}
