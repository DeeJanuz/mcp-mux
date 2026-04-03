use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>, // unix timestamp
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DefaultOrgFile {
    org_id: String,
}

impl StoredToken {
    /// Check if this token has expired
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.expires_at {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            now >= expires_at
        } else {
            false
        }
    }
}

// ---------------------------------------------------------------------------
// Org-aware token functions
// ---------------------------------------------------------------------------

/// Load a stored token for a specific org, checking expiry.
pub fn load_stored_token_for_org(
    dir: &Path,
    plugin_name: &str,
    org_id: &str,
) -> Option<StoredToken> {
    let path = dir.join(plugin_name).join(format!("{}.json", org_id));
    let content = std::fs::read_to_string(&path).ok()?;
    let token: StoredToken = serde_json::from_str(&content).ok()?;
    if token.is_expired() {
        eprintln!(
            "[mcpviews] Stored token for plugin '{}' org '{}' has expired",
            plugin_name, org_id
        );
        return None;
    }
    Some(token)
}

/// Load a stored token for a specific org without checking expiry.
pub fn load_stored_token_for_org_unvalidated(
    dir: &Path,
    plugin_name: &str,
    org_id: &str,
) -> Option<StoredToken> {
    let path = dir.join(plugin_name).join(format!("{}.json", org_id));
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Store a token for a specific org to {dir}/{plugin_name}/{org_id}.json
pub fn store_token_for_org(
    dir: &Path,
    plugin_name: &str,
    org_id: &str,
    token: &StoredToken,
) -> Result<(), String> {
    let plugin_dir = dir.join(plugin_name);
    std::fs::create_dir_all(&plugin_dir)
        .map_err(|e| format!("Failed to create plugin auth dir: {}", e))?;
    let path = plugin_dir.join(format!("{}.json", org_id));
    let json = serde_json::to_string_pretty(token)
        .map_err(|e| format!("Failed to serialize token: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write token: {}", e))?;
    Ok(())
}

/// Read the default org ID from {dir}/{plugin_name}/_default
pub fn load_default_org(dir: &Path, plugin_name: &str) -> Option<String> {
    let path = dir.join(plugin_name).join("_default");
    let content = std::fs::read_to_string(&path).ok()?;
    let default_file: DefaultOrgFile = serde_json::from_str(&content).ok()?;
    Some(default_file.org_id)
}

/// Write the default org ID to {dir}/{plugin_name}/_default
pub fn set_default_org(dir: &Path, plugin_name: &str, org_id: &str) -> Result<(), String> {
    let plugin_dir = dir.join(plugin_name);
    std::fs::create_dir_all(&plugin_dir)
        .map_err(|e| format!("Failed to create plugin auth dir: {}", e))?;
    let path = plugin_dir.join("_default");
    let json = serde_json::to_string_pretty(&DefaultOrgFile {
        org_id: org_id.to_string(),
    })
    .map_err(|e| format!("Failed to serialize default org: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write default org: {}", e))?;
    Ok(())
}

/// List all org IDs that have stored tokens under {dir}/{plugin_name}/.
/// Returns org IDs extracted from *.json filenames, excluding _default.
pub fn list_orgs(dir: &Path, plugin_name: &str) -> Vec<String> {
    let plugin_dir = dir.join(plugin_name);
    let entries = match std::fs::read_dir(&plugin_dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };
    let mut orgs = Vec::new();
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if name.ends_with(".json") {
            let org_id = name.trim_end_matches(".json");
            orgs.push(org_id.to_string());
        }
    }
    orgs.sort();
    orgs
}

/// Remove the stored token for a specific org. If that org was the default,
/// also removes the _default file.
pub fn remove_org_token(dir: &Path, plugin_name: &str, org_id: &str) -> Result<(), String> {
    let plugin_dir = dir.join(plugin_name);
    let token_path = plugin_dir.join(format!("{}.json", org_id));
    if token_path.exists() {
        std::fs::remove_file(&token_path)
            .map_err(|e| format!("Failed to delete org token: {}", e))?;
    }
    // If this org was the default, remove _default too
    if let Some(default_org) = load_default_org(dir, plugin_name) {
        if default_org == org_id {
            let default_path = plugin_dir.join("_default");
            if default_path.exists() {
                std::fs::remove_file(&default_path)
                    .map_err(|e| format!("Failed to delete default org file: {}", e))?;
            }
        }
    }
    Ok(())
}

/// Check if a stored token exists for a specific org.
pub fn has_stored_token_for_org(dir: &Path, plugin_name: &str, org_id: &str) -> bool {
    dir.join(plugin_name)
        .join(format!("{}.json", org_id))
        .exists()
}

/// Migrate a legacy flat-file token ({dir}/{plugin_name}.json) to the new
/// directory layout ({dir}/{plugin_name}/default.json + _default).
/// Returns Ok(true) if migration happened, Ok(false) if no legacy file existed.
pub fn migrate_legacy_token(dir: &Path, plugin_name: &str) -> Result<bool, String> {
    let legacy_path = dir.join(format!("{}.json", plugin_name));
    if !legacy_path.exists() {
        return Ok(false);
    }
    let content = std::fs::read_to_string(&legacy_path)
        .map_err(|e| format!("Failed to read legacy token: {}", e))?;
    let token: StoredToken = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse legacy token: {}", e))?;

    // Store under new layout
    store_token_for_org(dir, plugin_name, "default", &token)?;
    set_default_org(dir, plugin_name, "default")?;

    // Remove legacy file
    std::fs::remove_file(&legacy_path)
        .map_err(|e| format!("Failed to remove legacy token file: {}", e))?;

    Ok(true)
}

// ---------------------------------------------------------------------------
// Original functions — updated for backward compatibility with new layout
// ---------------------------------------------------------------------------

/// Load a stored token without checking expiry. Returns the token as-is,
/// or None if the file is missing or unparseable.
/// Checks new directory layout first, falls back to legacy flat file.
pub fn load_stored_token_unvalidated(dir: &Path, plugin_name: &str) -> Option<StoredToken> {
    let plugin_dir = dir.join(plugin_name);
    if plugin_dir.is_dir() {
        let org_id = load_default_org(dir, plugin_name)?;
        return load_stored_token_for_org_unvalidated(dir, plugin_name, &org_id);
    }
    // Legacy flat file
    let path = dir.join(format!("{}.json", plugin_name));
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Load a stored token, returning None if missing, unparseable, or expired.
/// Checks new directory layout first, falls back to legacy flat file.
pub fn load_stored_token(dir: &Path, plugin_name: &str) -> Option<StoredToken> {
    let plugin_dir = dir.join(plugin_name);
    if plugin_dir.is_dir() {
        let org_id = load_default_org(dir, plugin_name)?;
        return load_stored_token_for_org(dir, plugin_name, &org_id);
    }
    // Legacy flat file
    let path = dir.join(format!("{}.json", plugin_name));
    let content = std::fs::read_to_string(&path).ok()?;
    let token: StoredToken = serde_json::from_str(&content).ok()?;

    if token.is_expired() {
        eprintln!(
            "[mcpviews] Stored token for plugin '{}' has expired",
            plugin_name
        );
        return None;
    }

    Some(token)
}

/// Store a token. If the directory layout exists for this plugin, stores to the
/// default org. Otherwise uses legacy flat file.
pub fn store_token(dir: &Path, plugin_name: &str, token: &StoredToken) -> Result<(), String> {
    let plugin_dir = dir.join(plugin_name);
    if plugin_dir.is_dir() {
        if let Some(org_id) = load_default_org(dir, plugin_name) {
            return store_token_for_org(dir, plugin_name, &org_id, token);
        }
    }
    // Legacy flat file
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create auth dir: {}", e))?;
    let path = dir.join(format!("{}.json", plugin_name));
    let json = serde_json::to_string_pretty(token)
        .map_err(|e| format!("Failed to serialize token: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write token: {}", e))?;
    Ok(())
}

/// Remove the stored token for a plugin. Handles both directory layout and legacy flat file.
pub fn remove_token(dir: &Path, plugin_name: &str) -> Result<(), String> {
    // Try directory layout first
    let plugin_dir = dir.join(plugin_name);
    if plugin_dir.is_dir() {
        std::fs::remove_dir_all(&plugin_dir)
            .map_err(|e| format!("Failed to delete token dir for '{}': {}", plugin_name, e))?;
    }
    // Also try legacy flat file
    let path = dir.join(format!("{}.json", plugin_name));
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete token for '{}': {}", plugin_name, e))?;
    }
    Ok(())
}

/// Check if a stored token exists for a plugin. Checks both directory layout and legacy flat file.
pub fn has_stored_token(dir: &Path, plugin_name: &str) -> bool {
    let plugin_dir = dir.join(plugin_name);
    if plugin_dir.is_dir() {
        // Has directory layout — check if there's a default org with a token
        if let Some(org_id) = load_default_org(dir, plugin_name) {
            return has_stored_token_for_org(dir, plugin_name, &org_id);
        }
        return false;
    }
    dir.join(format!("{}.json", plugin_name)).exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stored_token_roundtrip() {
        let token = StoredToken {
            access_token: "test-token".to_string(),
            refresh_token: Some("refresh-123".to_string()),
            expires_at: Some(1700000000),
        };
        let json = serde_json::to_string(&token).unwrap();
        let parsed: StoredToken = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.access_token, "test-token");
        assert_eq!(parsed.refresh_token, Some("refresh-123".to_string()));
        assert_eq!(parsed.expires_at, Some(1700000000));
    }

    #[test]
    fn test_is_expired_false_for_future() {
        let future = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            + 3600;
        let token = StoredToken {
            access_token: "tok".to_string(),
            refresh_token: None,
            expires_at: Some(future),
        };
        assert!(!token.is_expired());
    }

    #[test]
    fn test_is_expired_true_for_past() {
        let past = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            - 3600;
        let token = StoredToken {
            access_token: "tok".to_string(),
            refresh_token: None,
            expires_at: Some(past),
        };
        assert!(token.is_expired());
    }

    #[test]
    fn test_is_expired_false_for_none() {
        let token = StoredToken {
            access_token: "tok".to_string(),
            refresh_token: None,
            expires_at: None,
        };
        assert!(!token.is_expired());
    }

    #[test]
    fn test_load_stored_token_success() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("my-plugin.json");
        std::fs::write(
            &path,
            r#"{"access_token":"abc","refresh_token":null,"expires_at":null}"#,
        )
        .unwrap();

        let token = load_stored_token(dir.path(), "my-plugin");
        assert!(token.is_some());
        let token = token.unwrap();
        assert_eq!(token.access_token, "abc");
    }

    #[test]
    fn test_load_stored_token_expired() {
        let dir = tempfile::tempdir().unwrap();
        let past = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            - 3600;
        let path = dir.path().join("expired-plugin.json");
        std::fs::write(
            &path,
            format!(
                r#"{{"access_token":"abc","refresh_token":null,"expires_at":{}}}"#,
                past
            ),
        )
        .unwrap();

        let token = load_stored_token(dir.path(), "expired-plugin");
        assert!(token.is_none());
    }

    #[test]
    fn test_load_stored_token_missing() {
        let dir = tempfile::tempdir().unwrap();
        let token = load_stored_token(dir.path(), "nonexistent-plugin");
        assert!(token.is_none());
    }

    #[test]
    fn test_store_and_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let token = StoredToken {
            access_token: "roundtrip-tok".to_string(),
            refresh_token: Some("rt".to_string()),
            expires_at: None,
        };
        store_token(dir.path(), "rt-plugin", &token).unwrap();
        let loaded = load_stored_token(dir.path(), "rt-plugin").unwrap();
        assert_eq!(loaded.access_token, "roundtrip-tok");
        assert_eq!(loaded.refresh_token, Some("rt".to_string()));
    }

    #[test]
    fn test_load_stored_token_unvalidated_returns_expired() {
        let dir = tempfile::tempdir().unwrap();
        let past = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            - 3600;
        let path = dir.path().join("expired-unvalidated.json");
        std::fs::write(
            &path,
            format!(
                r#"{{"access_token":"abc","refresh_token":"refresh-tok","expires_at":{}}}"#,
                past
            ),
        )
        .unwrap();

        // load_stored_token should return None (expired)
        let token = load_stored_token(dir.path(), "expired-unvalidated");
        assert!(token.is_none());

        // load_stored_token_unvalidated should return the token regardless
        let token = load_stored_token_unvalidated(dir.path(), "expired-unvalidated");
        assert!(token.is_some());
        let token = token.unwrap();
        assert_eq!(token.access_token, "abc");
        assert_eq!(token.refresh_token, Some("refresh-tok".to_string()));
    }

    #[test]
    fn test_load_stored_token_unvalidated_missing() {
        let dir = tempfile::tempdir().unwrap();
        let token = load_stored_token_unvalidated(dir.path(), "nonexistent");
        assert!(token.is_none());
    }

    #[test]
    fn test_remove_token_existing() {
        let dir = tempfile::tempdir().unwrap();
        let token = StoredToken {
            access_token: "delete-me".to_string(),
            refresh_token: None,
            expires_at: None,
        };
        store_token(dir.path(), "removable", &token).unwrap();
        assert!(has_stored_token(dir.path(), "removable"));

        remove_token(dir.path(), "removable").unwrap();
        assert!(!has_stored_token(dir.path(), "removable"));
    }

    #[test]
    fn test_remove_token_missing() {
        let dir = tempfile::tempdir().unwrap();
        // Should not error when file doesn't exist
        remove_token(dir.path(), "nonexistent").unwrap();
    }

    #[test]
    fn test_has_stored_token() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!has_stored_token(dir.path(), "check-plugin"));

        let path = dir.path().join("check-plugin.json");
        std::fs::write(&path, "{}").unwrap();
        assert!(has_stored_token(dir.path(), "check-plugin"));
    }

    // -----------------------------------------------------------------------
    // Org-aware token tests
    // -----------------------------------------------------------------------

    fn make_valid_token(name: &str) -> StoredToken {
        StoredToken {
            access_token: name.to_string(),
            refresh_token: Some(format!("{}-refresh", name)),
            expires_at: None, // never expires
        }
    }

    fn make_expired_token(name: &str) -> StoredToken {
        let past = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            - 3600;
        StoredToken {
            access_token: name.to_string(),
            refresh_token: None,
            expires_at: Some(past),
        }
    }

    #[test]
    fn test_store_and_load_token_for_org() {
        let dir = tempfile::tempdir().unwrap();
        let token = make_valid_token("org-tok");
        store_token_for_org(dir.path(), "myplugin", "org_abc", &token).unwrap();

        let loaded = load_stored_token_for_org(dir.path(), "myplugin", "org_abc");
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap().access_token, "org-tok");
    }

    #[test]
    fn test_load_token_for_org_expired() {
        let dir = tempfile::tempdir().unwrap();
        let token = make_expired_token("expired-org");
        store_token_for_org(dir.path(), "myplugin", "org_exp", &token).unwrap();

        // validated load returns None
        assert!(load_stored_token_for_org(dir.path(), "myplugin", "org_exp").is_none());
    }

    #[test]
    fn test_load_token_for_org_unvalidated_returns_expired() {
        let dir = tempfile::tempdir().unwrap();
        let token = make_expired_token("expired-unval");
        store_token_for_org(dir.path(), "myplugin", "org_exp2", &token).unwrap();

        // unvalidated load still returns the token
        let loaded =
            load_stored_token_for_org_unvalidated(dir.path(), "myplugin", "org_exp2");
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap().access_token, "expired-unval");
    }

    #[test]
    fn test_set_and_load_default_org() {
        let dir = tempfile::tempdir().unwrap();
        set_default_org(dir.path(), "myplugin", "org_abc123").unwrap();

        let org = load_default_org(dir.path(), "myplugin");
        assert_eq!(org, Some("org_abc123".to_string()));
    }

    #[test]
    fn test_load_default_org_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_default_org(dir.path(), "noplugin").is_none());
    }

    #[test]
    fn test_list_orgs_multiple() {
        let dir = tempfile::tempdir().unwrap();
        let token = make_valid_token("t");
        store_token_for_org(dir.path(), "plug", "org_a", &token).unwrap();
        store_token_for_org(dir.path(), "plug", "org_b", &token).unwrap();
        store_token_for_org(dir.path(), "plug", "org_c", &token).unwrap();
        set_default_org(dir.path(), "plug", "org_a").unwrap();

        let orgs = list_orgs(dir.path(), "plug");
        assert_eq!(orgs, vec!["org_a", "org_b", "org_c"]);
    }

    #[test]
    fn test_list_orgs_excludes_default_file() {
        let dir = tempfile::tempdir().unwrap();
        let token = make_valid_token("t");
        store_token_for_org(dir.path(), "plug", "org_x", &token).unwrap();
        set_default_org(dir.path(), "plug", "org_x").unwrap();

        let orgs = list_orgs(dir.path(), "plug");
        // _default is not a .json file, so it should be excluded
        assert_eq!(orgs, vec!["org_x"]);
    }

    #[test]
    fn test_list_orgs_empty() {
        let dir = tempfile::tempdir().unwrap();
        let orgs = list_orgs(dir.path(), "nonexistent");
        assert!(orgs.is_empty());
    }

    #[test]
    fn test_remove_org_token() {
        let dir = tempfile::tempdir().unwrap();
        let token = make_valid_token("t");
        store_token_for_org(dir.path(), "plug", "org_rm", &token).unwrap();
        assert!(has_stored_token_for_org(dir.path(), "plug", "org_rm"));

        remove_org_token(dir.path(), "plug", "org_rm").unwrap();
        assert!(!has_stored_token_for_org(dir.path(), "plug", "org_rm"));
    }

    #[test]
    fn test_remove_org_token_also_removes_default() {
        let dir = tempfile::tempdir().unwrap();
        let token = make_valid_token("t");
        store_token_for_org(dir.path(), "plug", "org_def", &token).unwrap();
        set_default_org(dir.path(), "plug", "org_def").unwrap();

        remove_org_token(dir.path(), "plug", "org_def").unwrap();
        assert!(!has_stored_token_for_org(dir.path(), "plug", "org_def"));
        assert!(load_default_org(dir.path(), "plug").is_none());
    }

    #[test]
    fn test_remove_org_token_keeps_default_for_other_org() {
        let dir = tempfile::tempdir().unwrap();
        let token = make_valid_token("t");
        store_token_for_org(dir.path(), "plug", "org_a", &token).unwrap();
        store_token_for_org(dir.path(), "plug", "org_b", &token).unwrap();
        set_default_org(dir.path(), "plug", "org_a").unwrap();

        // Remove org_b (not the default)
        remove_org_token(dir.path(), "plug", "org_b").unwrap();
        // Default should still point to org_a
        assert_eq!(
            load_default_org(dir.path(), "plug"),
            Some("org_a".to_string())
        );
    }

    #[test]
    fn test_has_stored_token_for_org() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!has_stored_token_for_org(dir.path(), "plug", "org_x"));

        let token = make_valid_token("t");
        store_token_for_org(dir.path(), "plug", "org_x", &token).unwrap();
        assert!(has_stored_token_for_org(dir.path(), "plug", "org_x"));
        assert!(!has_stored_token_for_org(dir.path(), "plug", "org_y"));
    }

    #[test]
    fn test_migrate_legacy_token() {
        let dir = tempfile::tempdir().unwrap();
        // Create a legacy flat file
        let token = make_valid_token("legacy-tok");
        let legacy_path = dir.path().join("myplugin.json");
        let json = serde_json::to_string_pretty(&token).unwrap();
        std::fs::write(&legacy_path, json).unwrap();

        let migrated = migrate_legacy_token(dir.path(), "myplugin").unwrap();
        assert!(migrated);

        // Legacy file should be gone
        assert!(!legacy_path.exists());

        // New layout should exist
        assert!(has_stored_token_for_org(dir.path(), "myplugin", "default"));
        assert_eq!(
            load_default_org(dir.path(), "myplugin"),
            Some("default".to_string())
        );
        let loaded =
            load_stored_token_for_org(dir.path(), "myplugin", "default").unwrap();
        assert_eq!(loaded.access_token, "legacy-tok");
    }

    #[test]
    fn test_migrate_legacy_token_no_legacy_file() {
        let dir = tempfile::tempdir().unwrap();
        let migrated = migrate_legacy_token(dir.path(), "noplugin").unwrap();
        assert!(!migrated);
    }

    // -----------------------------------------------------------------------
    // Backward compatibility: existing functions work with new directory layout
    // -----------------------------------------------------------------------

    #[test]
    fn test_load_stored_token_with_dir_layout() {
        let dir = tempfile::tempdir().unwrap();
        let token = make_valid_token("dir-tok");
        store_token_for_org(dir.path(), "plug", "org_main", &token).unwrap();
        set_default_org(dir.path(), "plug", "org_main").unwrap();

        // The generic load_stored_token should find it via the directory layout
        let loaded = load_stored_token(dir.path(), "plug");
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap().access_token, "dir-tok");
    }

    #[test]
    fn test_load_stored_token_unvalidated_with_dir_layout() {
        let dir = tempfile::tempdir().unwrap();
        let token = make_expired_token("dir-expired");
        store_token_for_org(dir.path(), "plug", "org_e", &token).unwrap();
        set_default_org(dir.path(), "plug", "org_e").unwrap();

        // Validated should return None (expired)
        assert!(load_stored_token(dir.path(), "plug").is_none());
        // Unvalidated should return the token
        let loaded = load_stored_token_unvalidated(dir.path(), "plug");
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap().access_token, "dir-expired");
    }

    #[test]
    fn test_load_stored_token_legacy_still_works() {
        let dir = tempfile::tempdir().unwrap();
        // Create legacy flat file directly
        let path = dir.path().join("legacy-plug.json");
        std::fs::write(
            &path,
            r#"{"access_token":"flat-tok","refresh_token":null,"expires_at":null}"#,
        )
        .unwrap();

        let loaded = load_stored_token(dir.path(), "legacy-plug");
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap().access_token, "flat-tok");
    }

    #[test]
    fn test_store_token_with_dir_layout() {
        let dir = tempfile::tempdir().unwrap();
        // Set up directory layout first
        let initial = make_valid_token("initial");
        store_token_for_org(dir.path(), "plug", "org_a", &initial).unwrap();
        set_default_org(dir.path(), "plug", "org_a").unwrap();

        // Now use generic store_token — it should update the default org's token
        let updated = make_valid_token("updated");
        store_token(dir.path(), "plug", &updated).unwrap();

        let loaded =
            load_stored_token_for_org(dir.path(), "plug", "org_a").unwrap();
        assert_eq!(loaded.access_token, "updated");
    }

    #[test]
    fn test_has_stored_token_with_dir_layout() {
        let dir = tempfile::tempdir().unwrap();
        let token = make_valid_token("t");
        store_token_for_org(dir.path(), "plug", "org_h", &token).unwrap();
        set_default_org(dir.path(), "plug", "org_h").unwrap();

        assert!(has_stored_token(dir.path(), "plug"));
    }

    #[test]
    fn test_has_stored_token_dir_layout_no_default() {
        let dir = tempfile::tempdir().unwrap();
        // Create the directory but no _default file
        std::fs::create_dir_all(dir.path().join("plug")).unwrap();
        assert!(!has_stored_token(dir.path(), "plug"));
    }

    #[test]
    fn test_remove_token_dir_layout() {
        let dir = tempfile::tempdir().unwrap();
        let token = make_valid_token("t");
        store_token_for_org(dir.path(), "plug", "org_a", &token).unwrap();
        store_token_for_org(dir.path(), "plug", "org_b", &token).unwrap();
        set_default_org(dir.path(), "plug", "org_a").unwrap();

        // Generic remove_token should remove the entire directory
        remove_token(dir.path(), "plug").unwrap();
        assert!(!dir.path().join("plug").exists());
        assert!(!has_stored_token(dir.path(), "plug"));
    }

    #[test]
    fn test_remove_token_legacy_layout() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("flat-plug.json");
        std::fs::write(&path, r#"{"access_token":"t","refresh_token":null,"expires_at":null}"#)
            .unwrap();

        remove_token(dir.path(), "flat-plug").unwrap();
        assert!(!path.exists());
    }
}
