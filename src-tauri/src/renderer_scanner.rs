use mcpviews_shared::plugins_dir;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct RendererInfo {
    pub plugin_name: String,
    pub file_name: String,
    pub url: String,
    pub mcp_url: Option<String>,
}

/// Scan all installed plugin directories for renderer JS files.
/// Looks for files in {plugin_dir}/renderers/*.js
pub fn scan_plugin_renderers() -> Vec<RendererInfo> {
    let dir = plugins_dir();
    if !dir.exists() {
        return Vec::new();
    }

    let mut renderers = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let plugin_name = match entry.file_name().into_string() {
                Ok(name) => name,
                Err(_) => continue,
            };

            let renderers_dir = path.join("renderers");
            if !renderers_dir.is_dir() {
                continue;
            }

            // Read MCP URL from manifest
            let mcp_url = read_mcp_url(&path.join("manifest.json"));

            if let Ok(renderer_entries) = std::fs::read_dir(&renderers_dir) {
                for renderer_entry in renderer_entries.flatten() {
                    let renderer_path = renderer_entry.path();
                    if renderer_path.extension().and_then(|e| e.to_str()) == Some("js") {
                        let file_name = renderer_entry.file_name().to_string_lossy().to_string();
                        let mtime = renderer_entry.metadata()
                            .and_then(|m| m.modified())
                            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
                            .unwrap_or(0);
                        // Tauri custom URI schemes resolve to different URL forms
                        // per platform: macOS/iOS/Linux use scheme://localhost/path,
                        // Windows uses https://scheme.localhost/path. The same
                        // register_uri_scheme_protocol("plugin", ...) handler fires
                        // in both cases — only the URL the webview must request differs.
                        // See https://github.com/orgs/tauri-apps/discussions/5597
                        let url = if cfg!(target_os = "windows") {
                            format!(
                                "https://plugin.localhost/{}/renderers/{}?v={}",
                                plugin_name, file_name, mtime
                            )
                        } else {
                            format!(
                                "plugin://localhost/{}/renderers/{}?v={}",
                                plugin_name, file_name, mtime
                            )
                        };
                        renderers.push(RendererInfo {
                            plugin_name: plugin_name.clone(),
                            file_name: file_name.clone(),
                            url,
                            mcp_url: mcp_url.clone(),
                        });
                    }
                }
            }
        }
    }

    renderers
}

fn read_mcp_url(manifest_path: &std::path::Path) -> Option<String> {
    let data = std::fs::read_to_string(manifest_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&data).ok()?;
    value.get("mcp")?.get("url")?.as_str().map(|s| s.to_string())
}
