use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PluginManifest {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub renderers: HashMap<String, String>,
    pub mcp: Option<PluginMcpConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PluginMcpConfig {
    pub url: String,
    pub auth: Option<PluginAuth>,
    pub tool_prefix: String,
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
    OAuth {
        client_id: String,
        auth_url: String,
        token_url: String,
        #[serde(default)]
        scopes: Vec<String>,
    },
}

fn default_api_key_header() -> String {
    "X-API-Key".to_string()
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub name: String,
    pub version: String,
    pub has_mcp: bool,
    pub auth_type: Option<String>,
    pub tool_count: usize,
}

pub fn plugins_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".mcp-mux")
        .join("plugins")
}

pub fn config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".mcp-mux")
        .join("config.json")
}

pub fn auth_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".mcp-mux")
        .join("auth")
}

pub fn cache_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".mcp-mux")
        .join("cache")
}
