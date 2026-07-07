pub mod package;
pub mod plugin_store;
pub mod registry;
pub mod settings;
pub mod token_store;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;

pub const MCPVIEWS_HOME_ENV: &str = "MCPVIEWS_HOME";
pub const MCPVIEWS_STORAGE_LANE_ENV: &str = "MCPVIEWS_STORAGE_LANE";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DisplayMode {
    Drawer,
    Modal,
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RendererDef {
    /// Renderer key used in content_type (e.g., "analysis_stats")
    pub name: String,
    /// Human-readable description for agents
    pub description: String,
    /// "universal" (any agent can use it) or "tool" (tied to specific MCP tools)
    #[serde(default = "default_renderer_scope")]
    pub scope: String,
    /// For tool-scoped: which tool names trigger this renderer
    #[serde(default)]
    pub tools: Vec<String>,
    /// Data schema hint for agents (e.g., "{ title: string, body: markdown }")
    #[serde(default)]
    pub data_hint: Option<String>,
    #[serde(default)]
    pub rule: Option<String>,
    /// Preferred display mode when invoked: "drawer", "modal", or "replace"
    #[serde(default)]
    pub display_mode: Option<DisplayMode>,
    /// JSON schema hint for invocation params (e.g., "{ id: string }")
    #[serde(default)]
    pub invoke_schema: Option<String>,
    /// Glob patterns for auto-detecting URLs to convert to invocation links
    #[serde(default)]
    pub url_patterns: Vec<String>,
    /// Whether this renderer can be launched standalone from the Apps menu
    #[serde(default)]
    pub standalone: bool,
    /// Human-readable label for the Apps menu (e.g., "Dashboard")
    #[serde(default)]
    pub standalone_label: Option<String>,
}

fn default_renderer_scope() -> String {
    "tool".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptArgument {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptDef {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub arguments: Vec<PromptArgument>,
    /// Relative path to prompt content file within the plugin directory
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupQuestionOption {
    pub value: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Compact rule text to persist when this option is selected during setup.
    #[serde(default)]
    pub persisted_rule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupQuestion {
    pub id: String,
    pub question: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub guidance: Option<String>,
    #[serde(default)]
    pub options: Vec<SetupQuestionOption>,
    #[serde(default)]
    pub default_value: Option<String>,
    #[serde(default)]
    pub recommended_value: Option<String>,
    #[serde(default)]
    pub example_outputs: Option<HashMap<String, String>>,
    /// Suggested persisted rule name for the selected answer.
    #[serde(default)]
    pub persist_as_rule_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupRuleSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub question_id: String,
    /// Source answer values that should not create a fresh install prompt.
    /// Existing installed rules are still evaluated for current/stale state.
    #[serde(default)]
    pub skip_install_values: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupRuleCondition {
    pub question_id: String,
    #[serde(default)]
    pub values: Vec<String>,
    #[serde(default)]
    pub not_values: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupRule {
    pub id: String,
    pub version: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub rule: Option<String>,
    #[serde(default)]
    pub source: Option<StartupRuleSource>,
    /// Optional setup-answer gates for rules that should only prompt when a
    /// companion setup preference enables the behavior.
    #[serde(default)]
    pub conditions: Vec<StartupRuleCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolGroupEntry {
    pub name: String,
    pub hint: String,
    pub tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRegistryIndex {
    pub summary: String,
    pub tags: Vec<String>,
    pub tool_groups: Vec<ToolGroupEntry>,
    pub renderer_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRuleDefinition {
    pub id: String,
    pub rule: String,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub groups: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub always_include: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInitContext {
    /// Unprefixed plugin MCP tool name that supplies compact init-session context.
    pub tool: String,
    /// Maximum time MCPViews should wait before failing open for this provider.
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    /// Inject the selected organization_id into the MCP proxy lookup so normal
    /// org-scoped auth is used. The proxy strips organization_id before calling
    /// the backend tool, matching existing plugin-tool behavior.
    #[serde(default)]
    pub inject_organization_id: bool,
    /// Merge project-scoped non-auth hints from mcpviews-init.json into the
    /// init-context call, such as DecidR project_id for the local workspace.
    #[serde(default)]
    pub inject_project_context: bool,
    /// Static arguments merged into the tool call.
    #[serde(default = "default_init_context_arguments")]
    pub arguments: Value,
}

fn default_init_context_arguments() -> Value {
    serde_json::json!({})
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PluginContextProvider {
    /// Type of external account context this plugin supports, such as
    /// "organization" or "account".
    pub context_type: String,
    /// Tool/render payload argument MCPViews uses to route auth, such as
    /// "organization_id".
    pub routing_arg: String,
    /// Unprefixed plugin MCP tool that returns available contexts.
    pub provider_tool: String,
    /// Optional field names to expose as compact human labels when available.
    #[serde(default)]
    pub label_fields: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PluginManifest {
    pub name: String,
    pub version: String,
    /// Optional Apps menu group key for standalone renderers. Defaults to the
    /// plugin name when omitted.
    #[serde(default)]
    pub standalone_group: Option<String>,
    /// Optional human-readable Apps menu group label. Defaults to a title-cased
    /// form of the standalone group key.
    #[serde(default)]
    pub standalone_group_label: Option<String>,
    #[serde(default)]
    pub renderers: HashMap<String, String>,
    /// Origins that plugin renderer iframes are allowed to embed. These are
    /// appended to the MCPViews webview CSP `frame-src` directive.
    #[serde(default)]
    pub frame_origins: Vec<String>,
    /// Extra CSP `connect-src` sources plugin renderers need beyond the plugin
    /// MCP URL, such as signed object-storage upload origins.
    #[serde(default)]
    pub connect_origins: Vec<String>,
    pub mcp: Option<PluginMcpConfig>,
    #[serde(default)]
    pub renderer_definitions: Vec<RendererDef>,
    #[serde(default)]
    pub tool_rules: HashMap<String, String>,
    /// Tool names that should NOT auto-push results to the companion window.
    /// Mutation tools (writes, deletes, etc.) typically belong here.
    #[serde(default)]
    pub no_auto_push: Vec<String>,
    #[serde(default)]
    pub registry_index: Option<PluginRegistryIndex>,
    /// URL to a ZIP package for this plugin version. Used by manifest_url-based
    /// registry entries and the update_plugins tool.
    #[serde(default)]
    pub download_url: Option<String>,
    #[serde(default)]
    pub prompt_definitions: Vec<PromptDef>,
    #[serde(default)]
    pub plugin_rules: Vec<String>,
    #[serde(default)]
    pub plugin_rule_definitions: Vec<PluginRuleDefinition>,
    #[serde(default)]
    pub startup_rules: Vec<StartupRule>,
    #[serde(default)]
    pub setup_questions: Vec<SetupQuestion>,
    #[serde(default)]
    pub init_context: Option<PluginInitContext>,
    #[serde(default)]
    pub context_provider: Option<PluginContextProvider>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginPreferences {
    /// Update policy: "always", "ask", or "skip"
    #[serde(default = "default_update_policy")]
    pub update_policy: String,

    /// Version this preference applies to (for "skip" — skip only this version)
    #[serde(default)]
    pub update_policy_version: Option<String>,

    /// Source of the preference: "chat" or "ui"
    #[serde(default = "default_preference_source")]
    pub update_policy_source: String,

    /// Setup question answers keyed by setup question id.
    #[serde(default)]
    pub setup_answers: HashMap<String, SetupPreferenceAnswer>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SetupPreferenceAnswer {
    /// Selected option value from the plugin manifest.
    pub value: String,

    /// Rule name agents should use if mirroring this setting to native rule storage.
    #[serde(default)]
    pub persist_as_rule_name: Option<String>,

    /// Snapshot of the manifest-defined persisted rule selected by the user.
    #[serde(default)]
    pub persisted_rule: Option<String>,

    /// Source of the preference: "chat", "ui", or a future setup surface.
    #[serde(default = "default_preference_source")]
    pub source: String,

    /// Plugin version installed when this answer was saved.
    #[serde(default)]
    pub plugin_version: Option<String>,

    /// RFC3339 timestamp for the most recent update.
    #[serde(default)]
    pub updated_at: Option<String>,
}

impl Default for PluginPreferences {
    fn default() -> Self {
        Self {
            update_policy: "ask".to_string(),
            update_policy_version: None,
            update_policy_source: "chat".to_string(),
            setup_answers: HashMap::new(),
        }
    }
}

fn default_update_policy() -> String {
    "ask".to_string()
}

fn default_preference_source() -> String {
    "chat".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PluginMcpConfig {
    pub url: String,
    pub auth: Option<PluginAuth>,
    pub tool_prefix: String,
}

fn default_email_code_send_path() -> String {
    "/api/mcpviews/auth/email-code/send".to_string()
}

fn default_email_code_verify_path() -> String {
    "/api/mcpviews/auth/email-code/verify".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PluginEmailCodeAuth {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_email_code_send_path")]
    pub send_path: String,
    #[serde(default = "default_email_code_verify_path")]
    pub verify_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PluginAuth {
    Bearer {
        token_env: String,
    },
    ApiKey {
        #[serde(default = "default_api_key_header")]
        header_name: String,
        key_env: Option<String>,
    },
    #[serde(rename = "oauth")]
    OAuth {
        #[serde(default)]
        client_id: Option<String>,
        auth_url: String,
        token_url: String,
        #[serde(default)]
        scopes: Vec<String>,
        #[serde(default)]
        email_code_auth: Option<PluginEmailCodeAuth>,
    },
}

fn default_api_key_header() -> String {
    "X-API-Key".to_string()
}

impl fmt::Display for PluginAuth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

impl PluginAuth {
    pub fn display_name(&self) -> &'static str {
        match self {
            PluginAuth::Bearer { .. } => "bearer",
            PluginAuth::ApiKey { .. } => "api_key",
            PluginAuth::OAuth { .. } => "oauth",
        }
    }

    pub fn email_code_auth(&self) -> Option<&PluginEmailCodeAuth> {
        match self {
            PluginAuth::OAuth {
                email_code_auth, ..
            } => email_code_auth.as_ref().filter(|config| config.enabled),
            _ => None,
        }
    }

    pub fn supports_email_code(&self) -> bool {
        self.email_code_auth().is_some()
    }

    /// Check if auth is configured for a plugin (uses default auth_dir).
    pub fn is_configured(&self, plugin_name: &str) -> bool {
        self.is_configured_with_auth_dir(plugin_name, &auth_dir())
    }

    /// Check if auth is configured, with a custom auth directory (for testing).
    pub fn is_configured_with_auth_dir(&self, plugin_name: &str, dir: &std::path::Path) -> bool {
        if token_store::has_stored_token(dir, plugin_name) {
            return true;
        }
        // For Bearer/ApiKey: also check env var as fallback
        match self {
            PluginAuth::Bearer { token_env } => std::env::var(token_env).is_ok(),
            PluginAuth::ApiKey { key_env, .. } => key_env
                .as_ref()
                .map(|e| std::env::var(e).is_ok())
                .unwrap_or(false),
            PluginAuth::OAuth { .. } => false, // OAuth only uses stored tokens
        }
    }

    /// Resolve the auth header value for this auth config.
    /// For Bearer/ApiKey: checks stored token first, then falls back to env var.
    /// For OAuth: reads stored token from auth_dir(), returns "Bearer {token}"
    pub fn resolve_header(&self, plugin_name: &str) -> Option<String> {
        self.resolve_header_with_auth_dir(plugin_name, &auth_dir())
    }

    /// Resolve the auth header with a custom auth directory (for testing).
    pub fn resolve_header_with_auth_dir(
        &self,
        plugin_name: &str,
        dir: &std::path::Path,
    ) -> Option<String> {
        match self {
            PluginAuth::Bearer { token_env } => {
                // Check stored token first
                if let Some(stored) = token_store::load_stored_token(dir, plugin_name) {
                    return Some(format!("Bearer {}", stored.access_token));
                }
                // Fall back to env var
                match std::env::var(token_env) {
                    Ok(token) => Some(format!("Bearer {}", token)),
                    Err(_) => {
                        eprintln!("[mcpviews] Auth env var '{}' not set", token_env);
                        None
                    }
                }
            }
            PluginAuth::ApiKey {
                header_name,
                key_env,
            } => {
                // Check stored token first
                if let Some(stored) = token_store::load_stored_token(dir, plugin_name) {
                    return Some(format!("{}:{}", header_name, stored.access_token));
                }
                // Fall back to env var
                if let Some(env_var) = key_env {
                    match std::env::var(env_var) {
                        Ok(key) => Some(format!("{}:{}", header_name, key)),
                        Err(_) => {
                            eprintln!("[mcpviews] Auth env var '{}' not set", env_var);
                            None
                        }
                    }
                } else {
                    None
                }
            }
            PluginAuth::OAuth { .. } => {
                let stored = token_store::load_stored_token(dir, plugin_name)?;
                Some(format!("Bearer {}", stored.access_token))
            }
        }
    }

    /// Resolve the auth header for a specific org (uses default auth_dir).
    pub fn resolve_header_for_org(&self, plugin_name: &str, org_id: &str) -> Option<String> {
        self.resolve_header_for_org_with_auth_dir(plugin_name, org_id, &auth_dir())
    }

    /// Resolve the auth header for a specific org with a custom auth directory.
    /// For OAuth: only stored token (no env fallback).
    /// For Bearer: stored token for org only (no env fallback for org-specific).
    /// For ApiKey: stored token for org formatted as "{header}:{key}".
    pub fn resolve_header_for_org_with_auth_dir(
        &self,
        plugin_name: &str,
        org_id: &str,
        dir: &std::path::Path,
    ) -> Option<String> {
        match self {
            PluginAuth::Bearer { .. } => {
                let stored = token_store::load_stored_token_for_org(dir, plugin_name, org_id)?;
                Some(format!("Bearer {}", stored.access_token))
            }
            PluginAuth::ApiKey { header_name, .. } => {
                let stored = token_store::load_stored_token_for_org(dir, plugin_name, org_id)?;
                Some(format!("{}:{}", header_name, stored.access_token))
            }
            PluginAuth::OAuth { .. } => {
                let stored = token_store::load_stored_token_for_org(dir, plugin_name, org_id)?;
                Some(format!("Bearer {}", stored.access_token))
            }
        }
    }

    /// Check if auth is configured for a specific org.
    pub fn is_configured_for_org(&self, plugin_name: &str, org_id: &str) -> bool {
        self.is_configured_for_org_with_auth_dir(plugin_name, org_id, &auth_dir())
    }

    /// Check if auth is configured for a specific org with a custom auth directory.
    pub fn is_configured_for_org_with_auth_dir(
        &self,
        plugin_name: &str,
        org_id: &str,
        dir: &std::path::Path,
    ) -> bool {
        token_store::has_stored_token_for_org(dir, plugin_name, org_id)
    }

    /// List all configured org IDs for this plugin (uses default auth_dir).
    pub fn list_configured_orgs(&self, plugin_name: &str) -> Vec<String> {
        token_store::list_orgs(&auth_dir(), plugin_name)
    }

    /// List all configured org IDs for this plugin with a custom auth directory.
    pub fn list_configured_orgs_with_auth_dir(
        &self,
        plugin_name: &str,
        dir: &std::path::Path,
    ) -> Vec<String> {
        token_store::list_orgs(dir, plugin_name)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RemoteRegistry {
    pub version: String,
    pub plugins: Vec<RegistryEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RegistryEntry {
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: Option<String>,
    pub homepage: Option<String>,
    pub manifest: PluginManifest,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub download_url: Option<String>,
    /// URL to the provider's remote manifest.json. When present, MCPViews fetches
    /// this to get the current version and download URL instead of relying on
    /// the inline `manifest` field.
    #[serde(default)]
    pub manifest_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistrySource {
    pub name: String,
    pub url: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub name: String,
    pub version: String,
    pub has_mcp: bool,
    pub auth_type: Option<String>,
    pub auth_configured: bool,
    pub tool_count: usize,
    pub update_available: Option<String>,
}

/// Returns the newer version string if `available` is strictly greater than
/// `installed` (by semver). Returns `None` if versions are equal, installed is
/// newer, or either string fails to parse.
pub fn newer_version(installed: &str, available: &str) -> Option<String> {
    let iv = semver::Version::parse(installed).ok()?;
    let av = semver::Version::parse(available).ok()?;
    if av > iv {
        Some(available.to_string())
    } else {
        None
    }
}

pub fn mcpviews_home_name_for_storage_lane(lane: Option<&str>) -> &'static str {
    match lane
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "staging" => ".mcpviews-staging",
        _ => ".mcpviews",
    }
}

pub fn mcpviews_home_dir_for_storage_lane(lane: Option<&str>) -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(mcpviews_home_name_for_storage_lane(lane))
}

pub fn mcpviews_home_dir() -> PathBuf {
    if let Some(path) = std::env::var_os(MCPVIEWS_HOME_ENV) {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }

    let lane = std::env::var(MCPVIEWS_STORAGE_LANE_ENV).ok();
    mcpviews_home_dir_for_storage_lane(lane.as_deref())
}

pub fn plugins_dir() -> PathBuf {
    mcpviews_home_dir().join("plugins")
}

pub fn config_path() -> PathBuf {
    mcpviews_home_dir().join("config.json")
}

pub fn auth_dir() -> PathBuf {
    mcpviews_home_dir().join("auth")
}

pub fn cache_dir() -> PathBuf {
    mcpviews_home_dir().join("cache")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_display_name_bearer() {
        let auth = PluginAuth::Bearer {
            token_env: "MY_TOKEN".to_string(),
        };
        assert_eq!(auth.display_name(), "bearer");
    }

    #[test]
    fn test_default_storage_lane_uses_production_home_name() {
        assert_eq!(mcpviews_home_name_for_storage_lane(None), ".mcpviews");
        assert_eq!(mcpviews_home_name_for_storage_lane(Some("")), ".mcpviews");
        assert_eq!(
            mcpviews_home_name_for_storage_lane(Some("production")),
            ".mcpviews"
        );
    }

    #[test]
    fn test_staging_storage_lane_uses_separate_home_name() {
        assert_eq!(
            mcpviews_home_name_for_storage_lane(Some("staging")),
            ".mcpviews-staging"
        );
        assert_eq!(
            mcpviews_home_name_for_storage_lane(Some(" StAgInG ")),
            ".mcpviews-staging"
        );
    }

    #[test]
    fn test_display_name_api_key() {
        let auth = PluginAuth::ApiKey {
            header_name: "X-API-Key".to_string(),
            key_env: None,
        };
        assert_eq!(auth.display_name(), "api_key");
    }

    #[test]
    fn test_display_name_oauth() {
        let auth = PluginAuth::OAuth {
            client_id: Some("id".to_string()),
            auth_url: "https://example.com/auth".to_string(),
            token_url: "https://example.com/token".to_string(),
            scopes: vec![],
            email_code_auth: None,
        };
        assert_eq!(auth.display_name(), "oauth");
    }

    #[test]
    fn test_is_configured_with_stored_token() {
        let dir = tempfile::tempdir().unwrap();
        let token_path = dir.path().join("test-plugin.json");
        std::fs::write(
            &token_path,
            r#"{"access_token":"tok123","refresh_token":null,"expires_at":null}"#,
        )
        .unwrap();

        let auth = PluginAuth::Bearer {
            token_env: "NONEXISTENT_ENV_VAR_12345".to_string(),
        };
        // is_configured should return true when a stored token file exists
        assert!(auth.is_configured_with_auth_dir("test-plugin", dir.path()));
    }

    #[test]
    fn test_is_configured_bearer_env_fallback() {
        let dir = tempfile::tempdir().unwrap();
        // No stored token file, but env var is set
        std::env::set_var("TEST_BEARER_TOKEN_XYZ", "some-token");
        let auth = PluginAuth::Bearer {
            token_env: "TEST_BEARER_TOKEN_XYZ".to_string(),
        };
        assert!(auth.is_configured_with_auth_dir("no-stored-token-plugin", dir.path()));
        std::env::remove_var("TEST_BEARER_TOKEN_XYZ");
    }

    #[test]
    fn test_is_configured_bearer_neither() {
        let dir = tempfile::tempdir().unwrap();
        let auth = PluginAuth::Bearer {
            token_env: "NONEXISTENT_ENV_VAR_99999".to_string(),
        };
        assert!(!auth.is_configured_with_auth_dir("missing-plugin", dir.path()));
    }

    #[test]
    fn test_is_configured_apikey_env_fallback() {
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("TEST_API_KEY_XYZ", "some-key");
        let auth = PluginAuth::ApiKey {
            header_name: "X-API-Key".to_string(),
            key_env: Some("TEST_API_KEY_XYZ".to_string()),
        };
        assert!(auth.is_configured_with_auth_dir("no-stored-apikey-plugin", dir.path()));
        std::env::remove_var("TEST_API_KEY_XYZ");
    }

    #[test]
    fn test_is_configured_apikey_no_env() {
        let dir = tempfile::tempdir().unwrap();
        let auth = PluginAuth::ApiKey {
            header_name: "X-API-Key".to_string(),
            key_env: None,
        };
        assert!(!auth.is_configured_with_auth_dir("no-apikey-plugin", dir.path()));
    }

    #[test]
    fn test_is_configured_oauth_no_stored_token() {
        let dir = tempfile::tempdir().unwrap();
        let auth = PluginAuth::OAuth {
            client_id: Some("id".to_string()),
            auth_url: "https://example.com/auth".to_string(),
            token_url: "https://example.com/token".to_string(),
            scopes: vec![],
            email_code_auth: None,
        };
        assert!(!auth.is_configured_with_auth_dir("no-oauth-plugin", dir.path()));
    }

    #[test]
    fn test_resolve_header_bearer_stored_token_first() {
        let dir = tempfile::tempdir().unwrap();
        let token_path = dir.path().join("bearer-plugin.json");
        std::fs::write(
            &token_path,
            r#"{"access_token":"stored-tok","refresh_token":null,"expires_at":null}"#,
        )
        .unwrap();

        std::env::set_var("TEST_BEARER_RESOLVE_ENV", "env-tok");
        let auth = PluginAuth::Bearer {
            token_env: "TEST_BEARER_RESOLVE_ENV".to_string(),
        };
        // Should prefer stored token over env var
        let header = auth.resolve_header_with_auth_dir("bearer-plugin", dir.path());
        assert_eq!(header, Some("Bearer stored-tok".to_string()));
        std::env::remove_var("TEST_BEARER_RESOLVE_ENV");
    }

    #[test]
    fn test_resolve_header_bearer_env_fallback() {
        let dir = tempfile::tempdir().unwrap();
        // No stored token
        std::env::set_var("TEST_BEARER_RESOLVE_FB", "env-tok-fb");
        let auth = PluginAuth::Bearer {
            token_env: "TEST_BEARER_RESOLVE_FB".to_string(),
        };
        let header = auth.resolve_header_with_auth_dir("no-stored-bearer", dir.path());
        assert_eq!(header, Some("Bearer env-tok-fb".to_string()));
        std::env::remove_var("TEST_BEARER_RESOLVE_FB");
    }

    #[test]
    fn test_resolve_header_apikey_stored_token_first() {
        let dir = tempfile::tempdir().unwrap();
        let token_path = dir.path().join("apikey-plugin.json");
        std::fs::write(
            &token_path,
            r#"{"access_token":"stored-key","refresh_token":null,"expires_at":null}"#,
        )
        .unwrap();

        std::env::set_var("TEST_APIKEY_RESOLVE_ENV", "env-key");
        let auth = PluginAuth::ApiKey {
            header_name: "X-API-Key".to_string(),
            key_env: Some("TEST_APIKEY_RESOLVE_ENV".to_string()),
        };
        let header = auth.resolve_header_with_auth_dir("apikey-plugin", dir.path());
        assert_eq!(header, Some("X-API-Key:stored-key".to_string()));
        std::env::remove_var("TEST_APIKEY_RESOLVE_ENV");
    }

    #[test]
    fn test_plugin_info_has_auth_configured_field() {
        let info = PluginInfo {
            name: "test".to_string(),
            version: "1.0".to_string(),
            has_mcp: true,
            auth_type: Some("bearer".to_string()),
            auth_configured: true,
            tool_count: 0,
            update_available: None,
        };
        assert!(info.auth_configured);

        let info2 = PluginInfo {
            name: "test2".to_string(),
            version: "1.0".to_string(),
            has_mcp: true,
            auth_type: Some("oauth".to_string()),
            auth_configured: false,
            tool_count: 0,
            update_available: None,
        };
        assert!(!info2.auth_configured);
    }

    #[test]
    fn test_display_impl() {
        let auth = PluginAuth::Bearer {
            token_env: "MY_TOKEN".to_string(),
        };
        assert_eq!(format!("{}", auth), "bearer");

        let auth = PluginAuth::ApiKey {
            header_name: "X-API-Key".to_string(),
            key_env: None,
        };
        assert_eq!(format!("{}", auth), "api_key");

        let auth = PluginAuth::OAuth {
            client_id: Some("id".to_string()),
            auth_url: "https://example.com/auth".to_string(),
            token_url: "https://example.com/token".to_string(),
            scopes: vec![],
            email_code_auth: None,
        };
        assert_eq!(format!("{}", auth), "oauth");
    }

    #[test]
    fn test_serde_roundtrip_bearer() {
        let auth = PluginAuth::Bearer {
            token_env: "MY_SECRET_TOKEN".to_string(),
        };
        let json = serde_json::to_string(&auth).unwrap();
        let parsed: PluginAuth = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.display_name(), "bearer");
        if let PluginAuth::Bearer { token_env } = parsed {
            assert_eq!(token_env, "MY_SECRET_TOKEN");
        } else {
            panic!("Expected Bearer variant");
        }
    }

    #[test]
    fn test_serde_roundtrip_api_key_default_header() {
        let auth = PluginAuth::ApiKey {
            header_name: default_api_key_header(),
            key_env: Some("MY_KEY".to_string()),
        };
        let json = serde_json::to_string(&auth).unwrap();
        let parsed: PluginAuth = serde_json::from_str(&json).unwrap();
        if let PluginAuth::ApiKey {
            header_name,
            key_env,
        } = parsed
        {
            assert_eq!(header_name, "X-API-Key");
            assert_eq!(key_env, Some("MY_KEY".to_string()));
        } else {
            panic!("Expected ApiKey variant");
        }
    }

    #[test]
    fn test_serde_roundtrip_oauth() {
        let auth = PluginAuth::OAuth {
            client_id: Some("client123".to_string()),
            auth_url: "https://example.com/auth".to_string(),
            token_url: "https://example.com/token".to_string(),
            scopes: vec!["read".to_string(), "write".to_string()],
            email_code_auth: None,
        };
        let json = serde_json::to_string(&auth).unwrap();
        let parsed: PluginAuth = serde_json::from_str(&json).unwrap();
        if let PluginAuth::OAuth {
            client_id,
            auth_url,
            token_url,
            scopes,
            email_code_auth,
        } = parsed
        {
            assert_eq!(client_id, Some("client123".to_string()));
            assert_eq!(auth_url, "https://example.com/auth");
            assert_eq!(token_url, "https://example.com/token");
            assert_eq!(scopes, vec!["read", "write"]);
            assert!(email_code_auth.is_none());
        } else {
            panic!("Expected OAuth variant");
        }
    }

    #[test]
    fn test_serde_oauth_email_code_defaults() {
        let json = r#"{
            "type": "oauth",
            "client_id": "client123",
            "auth_url": "https://example.com/auth",
            "token_url": "https://example.com/token",
            "email_code_auth": { "enabled": true },
            "scopes": ["read"]
        }"#;
        let auth: PluginAuth = serde_json::from_str(json).unwrap();

        assert!(auth.supports_email_code());
        let email_code = auth.email_code_auth().unwrap();
        assert_eq!(email_code.send_path, "/api/mcpviews/auth/email-code/send");
        assert_eq!(
            email_code.verify_path,
            "/api/mcpviews/auth/email-code/verify"
        );
    }

    #[test]
    fn test_renderer_def_serde_roundtrip() {
        let renderer = RendererDef {
            name: "analysis_stats".to_string(),
            description: "Show analysis statistics".to_string(),
            scope: "tool".to_string(),
            tools: vec!["get_analysis_stats".to_string()],
            data_hint: Some("{ counts: number[] }".to_string()),
            rule: None,
            display_mode: None,
            invoke_schema: None,
            url_patterns: vec![],
            standalone: false,
            standalone_label: None,
        };
        let json = serde_json::to_string(&renderer).unwrap();
        let parsed: RendererDef = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "analysis_stats");
        assert_eq!(parsed.description, "Show analysis statistics");
        assert_eq!(parsed.scope, "tool");
        assert_eq!(parsed.tools, vec!["get_analysis_stats"]);
        assert_eq!(parsed.data_hint, Some("{ counts: number[] }".to_string()));
    }

    #[test]
    fn test_renderer_def_default_scope() {
        assert_eq!(default_renderer_scope(), "tool");
        // Deserialize without scope field should default to "tool"
        let json = r#"{"name":"test","description":"Test renderer"}"#;
        let parsed: RendererDef = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.scope, "tool");
        assert!(parsed.tools.is_empty());
        assert!(parsed.data_hint.is_none());
        assert!(parsed.rule.is_none());
        assert!(parsed.display_mode.is_none());
        assert!(parsed.invoke_schema.is_none());
        assert!(parsed.url_patterns.is_empty());
    }

    #[test]
    fn test_renderer_def_invocation_fields() {
        let json = r#"{
            "name": "decision_detail",
            "description": "Decision detail view",
            "scope": "universal",
            "display_mode": "drawer",
            "invoke_schema": "{ id: string }",
            "url_patterns": ["/decisions/*", "/api/decisions/*"]
        }"#;
        let parsed: RendererDef = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.display_mode, Some(DisplayMode::Drawer));
        assert_eq!(parsed.invoke_schema, Some("{ id: string }".to_string()));
        assert_eq!(
            parsed.url_patterns,
            vec!["/decisions/*", "/api/decisions/*"]
        );
    }

    #[test]
    fn test_plugin_manifest_with_renderer_definitions() {
        let json = r#"{
            "name": "test-plugin",
            "version": "1.0.0",
            "renderer_definitions": [
                {
                    "name": "custom_view",
                    "description": "Custom view renderer",
                    "scope": "universal"
                }
            ]
        }"#;
        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.renderer_definitions.len(), 1);
        assert_eq!(manifest.renderer_definitions[0].name, "custom_view");
        assert_eq!(manifest.renderer_definitions[0].scope, "universal");
    }

    #[test]
    fn test_plugin_manifest_with_frame_origins() {
        let json = r#"{
            "name": "test-plugin",
            "version": "1.0.0",
            "frame_origins": ["https://app.example.com", "http://localhost:3000"],
            "connect_origins": ["https://*.r2.cloudflarestorage.com", "https://api.example.com/v1"]
        }"#;
        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(
            manifest.frame_origins,
            vec![
                "https://app.example.com".to_string(),
                "http://localhost:3000".to_string(),
            ]
        );
        assert_eq!(
            manifest.connect_origins,
            vec![
                "https://*.r2.cloudflarestorage.com".to_string(),
                "https://api.example.com/v1".to_string(),
            ]
        );
    }

    #[test]
    fn test_plugin_manifest_without_renderer_definitions() {
        let json = r#"{
            "name": "legacy-plugin",
            "version": "0.5.0"
        }"#;
        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert!(manifest.frame_origins.is_empty());
        assert!(manifest.connect_origins.is_empty());
        assert!(manifest.renderer_definitions.is_empty());
        assert!(manifest.renderers.is_empty());
        assert!(manifest.mcp.is_none());
        assert!(manifest.init_context.is_none());
    }

    #[test]
    fn test_plugin_manifest_init_context_roundtrip() {
        let json = r#"{
            "name": "context-plugin",
            "version": "1.0.0",
            "init_context": {
                "tool": "get_init_context",
                "timeout_ms": 1200,
                "inject_organization_id": true,
                "arguments": {
                    "limit": 5
                }
            }
        }"#;

        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        let init_context = manifest.init_context.expect("init_context");

        assert_eq!(init_context.tool, "get_init_context");
        assert_eq!(init_context.timeout_ms, Some(1200));
        assert!(init_context.inject_organization_id);
        assert_eq!(init_context.arguments["limit"], 5);
    }

    #[test]
    fn test_plugin_manifest_init_context_arguments_default_to_object() {
        let json = r#"{
            "name": "context-plugin",
            "version": "1.0.0",
            "init_context": {
                "tool": "get_init_context"
            }
        }"#;

        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        let init_context = manifest.init_context.expect("init_context");

        assert_eq!(init_context.arguments, serde_json::json!({}));
        assert_eq!(init_context.timeout_ms, None);
        assert!(!init_context.inject_organization_id);
    }

    #[test]
    fn test_no_auto_push_defaults_to_empty_vec() {
        let json = r#"{
            "name": "test-plugin",
            "version": "1.0.0"
        }"#;
        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert!(manifest.no_auto_push.is_empty());
    }

    #[test]
    fn test_plugin_manifest_setup_questions_default_to_empty_vec() {
        let json = r#"{
            "name": "test-plugin",
            "version": "1.0.0"
        }"#;
        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert!(manifest.setup_questions.is_empty());
    }

    #[test]
    fn test_plugin_manifest_startup_rules_default_to_empty_vec() {
        let json = r#"{
            "name": "test-plugin",
            "version": "1.0.0"
        }"#;
        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert!(manifest.startup_rules.is_empty());
    }

    #[test]
    fn test_plugin_manifest_plugin_rule_definitions_default_to_empty_vec() {
        let json = r#"{
            "name": "test-plugin",
            "version": "1.0.0"
        }"#;
        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert!(manifest.plugin_rule_definitions.is_empty());
    }

    #[test]
    fn test_plugin_manifest_plugin_rule_definitions_roundtrip() {
        let json = r#"{
            "name": "test-plugin",
            "version": "1.0.0",
            "plugin_rule_definitions": [{
                "id": "decision_lifecycle",
                "rule": "Fetch governance_lifecycle before moving decisions.",
                "tools": ["update_decision", "save_decision_document_version"],
                "groups": ["Create & Update", "Documents"],
                "tags": ["governance"],
                "always_include": true
            }]
        }"#;
        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.plugin_rule_definitions.len(), 1);
        assert_eq!(manifest.plugin_rule_definitions[0].id, "decision_lifecycle");
        assert_eq!(
            manifest.plugin_rule_definitions[0].tools,
            vec![
                "update_decision".to_string(),
                "save_decision_document_version".to_string()
            ]
        );
        assert_eq!(
            manifest.plugin_rule_definitions[0].groups,
            vec!["Create & Update".to_string(), "Documents".to_string()]
        );
        assert_eq!(
            manifest.plugin_rule_definitions[0].tags,
            vec!["governance".to_string()]
        );
        assert!(manifest.plugin_rule_definitions[0].always_include);

        let serialized = serde_json::to_string(&manifest).unwrap();
        let deserialized: PluginManifest = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.plugin_rule_definitions.len(), 1);
        assert_eq!(
            deserialized.plugin_rule_definitions[0].rule,
            "Fetch governance_lifecycle before moving decisions."
        );
    }

    #[test]
    fn test_plugin_manifest_startup_rules_roundtrip() {
        let json = r#"{
            "name": "test-plugin",
            "version": "1.0.0",
            "startup_rules": [
                {
                    "id": "always_use_workspace",
                    "version": "1",
                    "title": "Always use workspace",
                    "description": "Loaded before the first assistant response.",
                    "rule": "Always inspect the workspace before editing."
                },
                {
                    "id": "gronk_mode",
                    "version": "2",
                    "title": "Gronk Speak mode",
                    "source": {
                        "type": "setup_question",
                        "question_id": "mcpviews_gronk_speak_mode",
                        "skip_install_values": ["off"]
                    },
                    "conditions": [{
                        "question_id": "mcpviews_gronk_speak_mode",
                        "not_values": ["off"]
                    }]
                }
            ]
        }"#;
        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.startup_rules.len(), 2);
        assert_eq!(manifest.startup_rules[0].id, "always_use_workspace");
        assert_eq!(
            manifest.startup_rules[0].rule.as_deref(),
            Some("Always inspect the workspace before editing.")
        );
        assert_eq!(manifest.startup_rules[1].id, "gronk_mode");
        assert_eq!(
            manifest.startup_rules[1]
                .source
                .as_ref()
                .map(|source| source.source_type.as_str()),
            Some("setup_question")
        );
        assert_eq!(
            manifest.startup_rules[1]
                .source
                .as_ref()
                .map(|source| source.question_id.as_str()),
            Some("mcpviews_gronk_speak_mode")
        );
        assert_eq!(
            manifest.startup_rules[1]
                .source
                .as_ref()
                .map(|source| source.skip_install_values.as_slice()),
            Some(&["off".to_string()][..])
        );
        assert_eq!(
            manifest.startup_rules[1].conditions[0].not_values,
            vec!["off".to_string()]
        );

        let serialized = serde_json::to_string(&manifest).unwrap();
        let deserialized: PluginManifest = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.startup_rules.len(), 2);
        assert_eq!(
            deserialized.startup_rules[1]
                .source
                .as_ref()
                .unwrap()
                .skip_install_values,
            vec!["off".to_string()]
        );
    }

    #[test]
    fn test_plugin_manifest_setup_questions_roundtrip() {
        let json = r#"{
            "name": "test-plugin",
            "version": "1.0.0",
            "setup_questions": [{
                "id": "governance_mode",
                "question": "Use team approvals?",
                "description": "Choose the default governance mode.",
                "guidance": "Explain the collaboration tradeoff.",
                "default_value": "team",
                "recommended_value": "team",
                "persist_as_rule_name": "governance_mode",
                "example_outputs": {
                    "team": "Use approval workflow."
                },
                "options": [{
                    "value": "team",
                    "label": "Yes",
                    "description": "Use approval workflow.",
                    "persisted_rule": "Default governance mode is team."
                }]
            }]
        }"#;
        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.setup_questions.len(), 1);
        assert_eq!(manifest.setup_questions[0].id, "governance_mode");
        assert_eq!(
            manifest.setup_questions[0].default_value.as_deref(),
            Some("team")
        );
        assert_eq!(
            manifest.setup_questions[0].recommended_value.as_deref(),
            Some("team")
        );
        assert_eq!(
            manifest.setup_questions[0].guidance.as_deref(),
            Some("Explain the collaboration tradeoff.")
        );
        assert_eq!(
            manifest.setup_questions[0]
                .example_outputs
                .as_ref()
                .and_then(|outputs| outputs.get("team"))
                .map(String::as_str),
            Some("Use approval workflow.")
        );
        assert_eq!(manifest.setup_questions[0].options[0].value, "team");

        let serialized = serde_json::to_string(&manifest).unwrap();
        let deserialized: PluginManifest = serde_json::from_str(&serialized).unwrap();
        assert_eq!(
            deserialized.setup_questions[0].recommended_value.as_deref(),
            Some("team")
        );
        assert_eq!(
            deserialized.setup_questions[0]
                .example_outputs
                .as_ref()
                .and_then(|outputs| outputs.get("team"))
                .map(String::as_str),
            Some("Use approval workflow.")
        );
        assert_eq!(
            deserialized.setup_questions[0].options[0]
                .persisted_rule
                .as_deref(),
            Some("Default governance mode is team.")
        );
    }

    #[test]
    fn test_plugin_manifest_download_url_field() {
        let json = r#"{
            "name": "test-plugin",
            "version": "1.0.0",
            "download_url": "https://github.com/org/repo/releases/download/v1.0.0/test-plugin.zip"
        }"#;
        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(
            manifest.download_url,
            Some(
                "https://github.com/org/repo/releases/download/v1.0.0/test-plugin.zip".to_string()
            )
        );
    }

    #[test]
    fn test_plugin_manifest_download_url_defaults_to_none() {
        let json = r#"{ "name": "test-plugin", "version": "1.0.0" }"#;
        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert!(manifest.download_url.is_none());
    }

    #[test]
    fn test_registry_entry_manifest_url_field() {
        let json = r#"{
            "name": "test-plugin",
            "version": "1.0.0",
            "description": "Test",
            "manifest_url": "https://raw.githubusercontent.com/org/repo/master/plugin/manifest.json",
            "manifest": { "name": "test-plugin", "version": "1.0.0" }
        }"#;
        let entry: RegistryEntry = serde_json::from_str(json).unwrap();
        assert_eq!(
            entry.manifest_url,
            Some(
                "https://raw.githubusercontent.com/org/repo/master/plugin/manifest.json"
                    .to_string()
            )
        );
    }

    #[test]
    fn test_registry_entry_manifest_url_defaults_to_none() {
        let json = r#"{
            "name": "test-plugin",
            "version": "1.0.0",
            "description": "Test",
            "manifest": { "name": "test-plugin", "version": "1.0.0" }
        }"#;
        let entry: RegistryEntry = serde_json::from_str(json).unwrap();
        assert!(entry.manifest_url.is_none());
    }

    #[test]
    fn test_display_mode_serde() {
        let json = r#""drawer""#;
        let mode: DisplayMode = serde_json::from_str(json).unwrap();
        assert_eq!(mode, DisplayMode::Drawer);

        let json = r#""modal""#;
        let mode: DisplayMode = serde_json::from_str(json).unwrap();
        assert_eq!(mode, DisplayMode::Modal);

        let json = r#""replace""#;
        let mode: DisplayMode = serde_json::from_str(json).unwrap();
        assert_eq!(mode, DisplayMode::Replace);

        // Roundtrip
        assert_eq!(
            serde_json::to_string(&DisplayMode::Drawer).unwrap(),
            r#""drawer""#
        );
    }

    #[test]
    fn test_newer_version_available() {
        assert_eq!(newer_version("1.0.0", "2.0.0"), Some("2.0.0".to_string()));
    }

    #[test]
    fn test_newer_version_same() {
        assert_eq!(newer_version("1.0.0", "1.0.0"), None);
    }

    #[test]
    fn test_newer_version_older() {
        assert_eq!(newer_version("2.0.0", "1.0.0"), None);
    }

    #[test]
    fn test_newer_version_invalid_installed() {
        assert_eq!(newer_version("not-semver", "1.0.0"), None);
    }

    #[test]
    fn test_newer_version_invalid_available() {
        assert_eq!(newer_version("1.0.0", "not-semver"), None);
    }

    #[test]
    fn test_no_auto_push_roundtrips_correctly() {
        let json = r#"{
            "name": "test-plugin",
            "version": "1.0.0",
            "no_auto_push": ["write_document", "manage_data_draft"]
        }"#;
        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(
            manifest.no_auto_push,
            vec!["write_document", "manage_data_draft"]
        );

        // Roundtrip through serialize/deserialize
        let serialized = serde_json::to_string(&manifest).unwrap();
        let deserialized: PluginManifest = serde_json::from_str(&serialized).unwrap();
        assert_eq!(
            deserialized.no_auto_push,
            vec!["write_document", "manage_data_draft"]
        );
    }

    // -----------------------------------------------------------------------
    // Org-aware PluginAuth tests
    // -----------------------------------------------------------------------

    fn store_org_token(dir: &std::path::Path, plugin: &str, org: &str, tok: &str) {
        let token = token_store::StoredToken {
            access_token: tok.to_string(),
            refresh_token: None,
            expires_at: None,
        };
        token_store::store_token_for_org(dir, plugin, org, &token).unwrap();
    }

    #[test]
    fn test_resolve_header_for_org_bearer() {
        let dir = tempfile::tempdir().unwrap();
        store_org_token(dir.path(), "plug", "org_1", "bearer-tok-1");

        let auth = PluginAuth::Bearer {
            token_env: "NONEXISTENT_VAR".to_string(),
        };
        let header = auth.resolve_header_for_org_with_auth_dir("plug", "org_1", dir.path());
        assert_eq!(header, Some("Bearer bearer-tok-1".to_string()));
    }

    #[test]
    fn test_resolve_header_for_org_apikey() {
        let dir = tempfile::tempdir().unwrap();
        store_org_token(dir.path(), "plug", "org_2", "key-val");

        let auth = PluginAuth::ApiKey {
            header_name: "X-Custom".to_string(),
            key_env: None,
        };
        let header = auth.resolve_header_for_org_with_auth_dir("plug", "org_2", dir.path());
        assert_eq!(header, Some("X-Custom:key-val".to_string()));
    }

    #[test]
    fn test_resolve_header_for_org_oauth() {
        let dir = tempfile::tempdir().unwrap();
        store_org_token(dir.path(), "plug", "org_3", "oauth-tok");

        let auth = PluginAuth::OAuth {
            client_id: Some("c".to_string()),
            auth_url: "https://example.com/auth".to_string(),
            token_url: "https://example.com/token".to_string(),
            scopes: vec![],
            email_code_auth: None,
        };
        let header = auth.resolve_header_for_org_with_auth_dir("plug", "org_3", dir.path());
        assert_eq!(header, Some("Bearer oauth-tok".to_string()));
    }

    #[test]
    fn test_resolve_header_for_org_missing() {
        let dir = tempfile::tempdir().unwrap();
        let auth = PluginAuth::Bearer {
            token_env: "NONEXISTENT_VAR".to_string(),
        };
        let header = auth.resolve_header_for_org_with_auth_dir("plug", "no_org", dir.path());
        assert!(header.is_none());
    }

    #[test]
    fn test_is_configured_for_org() {
        let dir = tempfile::tempdir().unwrap();
        store_org_token(dir.path(), "plug", "org_yes", "t");

        let auth = PluginAuth::OAuth {
            client_id: None,
            auth_url: "https://example.com/auth".to_string(),
            token_url: "https://example.com/token".to_string(),
            scopes: vec![],
            email_code_auth: None,
        };
        assert!(auth.is_configured_for_org_with_auth_dir("plug", "org_yes", dir.path()));
        assert!(!auth.is_configured_for_org_with_auth_dir("plug", "org_no", dir.path()));
    }

    #[test]
    fn test_list_configured_orgs() {
        let dir = tempfile::tempdir().unwrap();
        store_org_token(dir.path(), "plug", "org_a", "t");
        store_org_token(dir.path(), "plug", "org_b", "t");

        let auth = PluginAuth::Bearer {
            token_env: "X".to_string(),
        };
        let orgs = auth.list_configured_orgs_with_auth_dir("plug", dir.path());
        assert_eq!(orgs, vec!["org_a", "org_b"]);
    }

    #[test]
    fn test_list_configured_orgs_empty() {
        let dir = tempfile::tempdir().unwrap();
        let auth = PluginAuth::Bearer {
            token_env: "X".to_string(),
        };
        let orgs = auth.list_configured_orgs_with_auth_dir("noplug", dir.path());
        assert!(orgs.is_empty());
    }
}
