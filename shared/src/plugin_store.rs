use crate::{plugins_dir, PluginManifest};
use std::path::PathBuf;

pub struct PluginStore {
    dir: PathBuf,
}

impl PluginStore {
    /// Create a new PluginStore using the default plugins directory (~/.mcp-mux/plugins/)
    pub fn new() -> Self {
        Self {
            dir: plugins_dir(),
        }
    }

    /// Create a PluginStore with a custom directory (useful for testing)
    pub fn with_dir(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// List all installed plugin manifests
    pub fn list(&self) -> Result<Vec<PluginManifest>, String> {
        if !self.dir.exists() {
            return Ok(Vec::new());
        }

        let entries = std::fs::read_dir(&self.dir)
            .map_err(|e| format!("Failed to read plugins directory: {}", e))?;

        let mut plugins = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                match std::fs::read_to_string(&path) {
                    Ok(content) => match serde_json::from_str::<PluginManifest>(&content) {
                        Ok(manifest) => plugins.push(manifest),
                        Err(e) => {
                            eprintln!("[mcp-mux] Failed to parse plugin {:?}: {}", path, e);
                        }
                    },
                    Err(e) => {
                        eprintln!("[mcp-mux] Failed to read plugin {:?}: {}", path, e);
                    }
                }
            }
        }

        Ok(plugins)
    }

    /// Load a specific plugin manifest by name
    pub fn load(&self, name: &str) -> Result<PluginManifest, String> {
        let path = self.dir.join(format!("{}.json", name));
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read plugin '{}': {}", name, e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse plugin '{}': {}", name, e))
    }

    /// Save a plugin manifest to disk
    pub fn save(&self, manifest: &PluginManifest) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir)
            .map_err(|e| format!("Failed to create plugins directory: {}", e))?;

        let path = self.dir.join(format!("{}.json", manifest.name));
        let json = serde_json::to_string_pretty(manifest)
            .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
        std::fs::write(&path, json)
            .map_err(|e| format!("Failed to write plugin file: {}", e))?;

        Ok(())
    }

    /// Remove a plugin manifest from disk
    pub fn remove(&self, name: &str) -> Result<(), String> {
        let path = self.dir.join(format!("{}.json", name));
        if !path.exists() {
            return Err(format!("Plugin '{}' is not installed", name));
        }
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to remove plugin '{}': {}", name, e))?;
        Ok(())
    }

    /// Check if a plugin is installed
    pub fn exists(&self, name: &str) -> bool {
        self.dir.join(format!("{}.json", name)).exists()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PluginManifest;

    fn test_manifest(name: &str) -> PluginManifest {
        PluginManifest {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            renderers: std::collections::HashMap::new(),
            mcp: None,
        }
    }

    #[test]
    fn test_list_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::with_dir(dir.path().to_path_buf());
        let plugins = store.list().unwrap();
        assert!(plugins.is_empty());
    }

    #[test]
    fn test_save_then_list() {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::with_dir(dir.path().to_path_buf());
        let manifest = test_manifest("test-plugin");
        store.save(&manifest).unwrap();
        let plugins = store.list().unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].name, "test-plugin");
    }

    #[test]
    fn test_save_then_load() {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::with_dir(dir.path().to_path_buf());
        let manifest = test_manifest("my-plugin");
        store.save(&manifest).unwrap();
        let loaded = store.load("my-plugin").unwrap();
        assert_eq!(loaded.name, "my-plugin");
        assert_eq!(loaded.version, "1.0.0");
    }

    #[test]
    fn test_exists_after_save() {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::with_dir(dir.path().to_path_buf());
        assert!(!store.exists("foo"));
        store.save(&test_manifest("foo")).unwrap();
        assert!(store.exists("foo"));
    }

    #[test]
    fn test_remove_deletes_plugin() {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::with_dir(dir.path().to_path_buf());
        store.save(&test_manifest("bar")).unwrap();
        assert!(store.exists("bar"));
        store.remove("bar").unwrap();
        assert!(!store.exists("bar"));
    }

    #[test]
    fn test_remove_nonexistent_returns_err() {
        let dir = tempfile::tempdir().unwrap();
        let store = PluginStore::with_dir(dir.path().to_path_buf());
        let result = store.remove("nonexistent");
        assert!(result.is_err());
    }
}
