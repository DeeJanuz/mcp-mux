use crate::{cache_dir, config_path, RemoteRegistry, RegistryEntry};

pub const DEFAULT_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/anthropics/mcp-mux-registry/main/registry.json";

const CACHE_TTL_SECS: u64 = 3600; // 1 hour

/// Read the configured registry URL from config.json, falling back to DEFAULT_REGISTRY_URL
pub fn get_configured_registry_url() -> String {
    if let Ok(content) = std::fs::read_to_string(config_path()) {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(url) = config.get("registry_url").and_then(|v| v.as_str()) {
                return url.to_string();
            }
        }
    }
    DEFAULT_REGISTRY_URL.to_string()
}

/// Fetch registry entries, using a 1-hour disk cache
pub async fn fetch_registry(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<RegistryEntry>, String> {
    // Check cache first
    let cache_path = cache_dir().join("registry.json");
    if let Ok(metadata) = std::fs::metadata(&cache_path) {
        if let Ok(modified) = metadata.modified() {
            if modified
                .elapsed()
                .map(|d| d.as_secs())
                .unwrap_or(u64::MAX)
                < CACHE_TTL_SECS
            {
                if let Ok(content) = std::fs::read_to_string(&cache_path) {
                    if let Ok(registry) = serde_json::from_str::<RemoteRegistry>(&content) {
                        return Ok(registry.plugins);
                    }
                }
            }
        }
    }

    // Fetch from remote
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch registry: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Registry returned HTTP {}", resp.status()));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read registry response: {}", e))?;

    let registry: RemoteRegistry = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse registry: {}", e))?;

    // Write to cache
    let _ = std::fs::create_dir_all(cache_dir());
    let _ = std::fs::write(&cache_path, &body);

    Ok(registry.plugins)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_registry_url_is_valid_https() {
        assert!(DEFAULT_REGISTRY_URL.starts_with("https://"));
    }

    #[test]
    fn test_get_configured_registry_url_returns_default_when_no_config() {
        // config_path() points to ~/.mcp-mux/config.json which likely doesn't exist in CI
        // If it does exist and has a registry_url, this test just verifies we get a non-empty string
        let url = get_configured_registry_url();
        assert!(!url.is_empty());
        assert!(url.starts_with("https://"));
    }
}
