pub mod plugin_store;
pub mod registry;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
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

    /// Resolve the auth header value for this auth config.
    /// For Bearer: reads token from env var, returns "Bearer {token}"
    /// For ApiKey: reads key from env var, returns "{header_name}:{key}"
    /// For OAuth: reads stored token from auth_dir(), returns "Bearer {token}"
    pub fn resolve_header(&self, plugin_name: &str) -> Option<String> {
        match self {
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
                let path = auth_dir().join(format!("{}.json", plugin_name));
                let content = std::fs::read_to_string(&path).ok()?;
                let stored: serde_json::Value = serde_json::from_str(&content).ok()?;

                // Check if token has expired
                if let Some(expires_at) = stored.get("expires_at").and_then(|v| v.as_i64()) {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs() as i64;
                    if now >= expires_at {
                        eprintln!(
                            "[mcp-mux] OAuth token for plugin '{}' has expired",
                            plugin_name
                        );
                        return None;
                    }
                }

                let access_token = stored.get("access_token")?.as_str()?;
                Some(format!("Bearer {}", access_token))
            }
        }
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
            client_id: "id".to_string(),
            auth_url: "https://example.com/auth".to_string(),
            token_url: "https://example.com/token".to_string(),
            scopes: vec![],
        };
        assert_eq!(auth.display_name(), "oauth");
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
            client_id: "id".to_string(),
            auth_url: "https://example.com/auth".to_string(),
            token_url: "https://example.com/token".to_string(),
            scopes: vec![],
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
            client_id: "client123".to_string(),
            auth_url: "https://example.com/auth".to_string(),
            token_url: "https://example.com/token".to_string(),
            scopes: vec!["read".to_string(), "write".to_string()],
        };
        let json = serde_json::to_string(&auth).unwrap();
        let parsed: PluginAuth = serde_json::from_str(&json).unwrap();
        if let PluginAuth::OAuth {
            client_id,
            auth_url,
            token_url,
            scopes,
        } = parsed
        {
            assert_eq!(client_id, "client123");
            assert_eq!(auth_url, "https://example.com/auth");
            assert_eq!(token_url, "https://example.com/token");
            assert_eq!(scopes, vec!["read", "write"]);
        } else {
            panic!("Expected OAuth variant");
        }
    }
}
