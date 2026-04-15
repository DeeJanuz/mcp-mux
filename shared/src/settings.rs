use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::{config_path, RegistrySource};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FirstPartyAiSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay_base_url: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_base_url: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay_token: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay_token_expires_at: Option<i64>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay_device_id: Option<String>,
}

/// Typed representation of ~/.mcpviews/config.json
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    /// Legacy single registry URL (read for migration, omitted on save)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry_url: Option<String>,

    /// Configured registry sources
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub registry_sources: Vec<RegistrySource>,

    /// First-party ProPaasAI integration config
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_party_ai: Option<FirstPartyAiSettings>,
}

impl Settings {
    /// Load settings from ~/.mcpviews/config.json, returning defaults if the file
    /// does not exist or cannot be parsed.
    pub fn load() -> Self {
        Self::load_from_path(&config_path())
    }

    /// Load settings from a specific path, returning defaults if the file does
    /// not exist or cannot be parsed.
    pub fn load_from_path(path: &Path) -> Self {
        if !path.exists() {
            return Self::default();
        }
        match std::fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    /// Persist settings to ~/.mcpviews/config.json.
    pub fn save(&self) -> Result<(), String> {
        self.save_to_path(&config_path())
    }

    /// Persist settings to a specific path.
    pub fn save_to_path(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        std::fs::write(&path, json)
            .map_err(|e| format!("Failed to write config: {}", e))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let settings = Settings::default();
        assert!(settings.registry_url.is_none());
        assert!(settings.registry_sources.is_empty());
        assert!(settings.first_party_ai.is_none());
    }

    #[test]
    fn test_serde_roundtrip() {
        let settings = Settings {
            registry_url: None,
            registry_sources: vec![RegistrySource {
                name: "Test".to_string(),
                url: "https://example.com/registry.json".to_string(),
                enabled: true,
            }],
            first_party_ai: Some(FirstPartyAiSettings {
                base_url: Some("https://ai.example.com".to_string()),
                auth_url: None,
                token_url: None,
                client_id: None,
                relay_base_url: Some("https://relay.example.com".to_string()),
                device_base_url: Some("https://device.example.com".to_string()),
                relay_token: Some("relay-token".to_string()),
                relay_token_expires_at: Some(1_700_000_000),
                relay_device_id: Some("device-123".to_string()),
            }),
        };
        let json = serde_json::to_string(&settings).unwrap();
        let parsed: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.registry_sources.len(), 1);
        assert_eq!(parsed.registry_sources[0].name, "Test");
        assert_eq!(
            parsed
                .first_party_ai
                .as_ref()
                .and_then(|cfg| cfg.base_url.as_deref()),
            Some("https://ai.example.com")
        );
        assert_eq!(
            parsed
                .first_party_ai
                .as_ref()
                .and_then(|cfg| cfg.relay_base_url.as_deref()),
            Some("https://relay.example.com")
        );
        assert_eq!(
            parsed
                .first_party_ai
                .as_ref()
                .and_then(|cfg| cfg.device_base_url.as_deref()),
            Some("https://device.example.com")
        );
        assert_eq!(
            parsed
                .first_party_ai
                .as_ref()
                .and_then(|cfg| cfg.relay_token.as_deref()),
            Some("relay-token")
        );
        assert_eq!(
            parsed
                .first_party_ai
                .as_ref()
                .and_then(|cfg| cfg.relay_token_expires_at),
            Some(1_700_000_000)
        );
        assert_eq!(
            parsed
                .first_party_ai
                .as_ref()
                .and_then(|cfg| cfg.relay_device_id.as_deref()),
            Some("device-123")
        );
    }

    #[test]
    fn test_deserialize_empty_object() {
        let parsed: Settings = serde_json::from_str("{}").unwrap();
        assert!(parsed.registry_url.is_none());
        assert!(parsed.registry_sources.is_empty());
        assert!(parsed.first_party_ai.is_none());
    }

    #[test]
    fn test_deserialize_with_legacy_registry_url() {
        let json = r#"{"registry_url": "https://example.com/reg.json"}"#;
        let parsed: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(
            parsed.registry_url,
            Some("https://example.com/reg.json".to_string())
        );
        assert!(parsed.registry_sources.is_empty());
        assert!(parsed.first_party_ai.is_none());
    }

    #[test]
    fn test_save_and_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let settings = Settings {
            registry_url: None,
            registry_sources: vec![RegistrySource {
                name: "Saved".to_string(),
                url: "https://saved.example.com".to_string(),
                enabled: false,
            }],
            first_party_ai: Some(FirstPartyAiSettings {
                base_url: Some("https://ai.saved.example.com".to_string()),
                auth_url: Some("https://auth.saved.example.com/authorize".to_string()),
                token_url: Some("https://auth.saved.example.com/token".to_string()),
                client_id: Some("saved-client".to_string()),
                relay_base_url: None,
                device_base_url: None,
                relay_token: None,
                relay_token_expires_at: None,
                relay_device_id: None,
            }),
        };
        let json = serde_json::to_string_pretty(&settings).unwrap();
        std::fs::write(&path, &json).unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        let loaded: Settings = serde_json::from_str(&content).unwrap();
        assert_eq!(loaded.registry_sources.len(), 1);
        assert_eq!(loaded.registry_sources[0].name, "Saved");
        assert!(!loaded.registry_sources[0].enabled);
        assert_eq!(
            loaded
                .first_party_ai
                .as_ref()
                .and_then(|cfg| cfg.client_id.as_deref()),
            Some("saved-client")
        );
        assert_eq!(
            loaded
                .first_party_ai
                .as_ref()
                .and_then(|cfg| cfg.relay_base_url.as_deref()),
            None
        );
    }

    #[test]
    fn test_skip_serializing_empty_fields() {
        let settings = Settings::default();
        let json = serde_json::to_string(&settings).unwrap();
        // Should not contain registry_url, registry_sources, or first_party_ai when empty/None
        assert!(!json.contains("registry_url"));
        assert!(!json.contains("registry_sources"));
        assert!(!json.contains("first_party_ai"));
    }

    #[test]
    fn test_settings_save_and_load_from_custom_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let settings = Settings {
            registry_url: None,
            registry_sources: vec![],
            first_party_ai: Some(FirstPartyAiSettings {
                base_url: Some("https://ai.example.com".to_string()),
                auth_url: None,
                token_url: None,
                client_id: None,
                relay_base_url: Some("https://relay.example.com".to_string()),
                device_base_url: Some("https://device.example.com".to_string()),
                relay_token: Some("relay-token".to_string()),
                relay_token_expires_at: Some(1_700_000_000),
                relay_device_id: Some("device-123".to_string()),
            }),
        };

        settings.save_to_path(&path).unwrap();
        let loaded = Settings::load_from_path(&path);
        assert_eq!(
            loaded
                .first_party_ai
                .as_ref()
                .and_then(|cfg| cfg.relay_base_url.as_deref()),
            Some("https://relay.example.com")
        );
        assert_eq!(
            loaded
                .first_party_ai
                .as_ref()
                .and_then(|cfg| cfg.relay_token.as_deref()),
            Some("relay-token")
        );
    }
}
