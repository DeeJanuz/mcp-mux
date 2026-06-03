use mcpviews_shared::plugins_dir;
use serde::Serialize;

use crate::state::{CURRENT_PERSONA_STUDIO_PLUGIN, LEGACY_PERSONA_STUDIO_PLUGIN};

#[derive(Debug, Clone, Serialize)]
pub struct RendererInfo {
    pub plugin_name: String,
    pub file_name: String,
    pub url: String,
    pub mcp_url: Option<String>,
    pub frame_origins: Vec<String>,
}

/// Scan all installed plugin directories for renderer JS files.
/// Looks for files in {plugin_dir}/renderers/*.js
pub fn scan_plugin_renderers() -> Vec<RendererInfo> {
    let dir = plugins_dir();
    if !dir.exists() {
        return Vec::new();
    }

    let mut renderers = Vec::new();
    let current_persona_studio_installed = dir
        .join(CURRENT_PERSONA_STUDIO_PLUGIN)
        .join("manifest.json")
        .exists();

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
            if current_persona_studio_installed && plugin_name == LEGACY_PERSONA_STUDIO_PLUGIN {
                continue;
            }

            let renderers_dir = path.join("renderers");
            if !renderers_dir.is_dir() {
                continue;
            }

            // Read renderer-relevant plugin config from manifest.
            let renderer_config = read_renderer_config(&path.join("manifest.json"));

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
                            mcp_url: renderer_config.mcp_url.clone(),
                            frame_origins: renderer_config.frame_origins.clone(),
                        });
                    }
                }
            }
        }
    }

    renderers
}

#[derive(Default)]
struct RendererConfig {
    mcp_url: Option<String>,
    frame_origins: Vec<String>,
}

fn read_renderer_config(manifest_path: &std::path::Path) -> RendererConfig {
    let data = match std::fs::read_to_string(manifest_path) {
        Ok(data) => data,
        Err(_) => return RendererConfig::default(),
    };
    let value: serde_json::Value = match serde_json::from_str(&data) {
        Ok(value) => value,
        Err(_) => return RendererConfig::default(),
    };
    let mcp_url = value.get("mcp")
        .and_then(|mcp| mcp.get("url"))
        .and_then(|url| url.as_str())
        .map(|url| url.to_string());
    let frame_origins = value
        .get("frame_origins")
        .and_then(|origins| origins.as_array())
        .map(|origins| {
            origins
                .iter()
                .filter_map(|origin| origin.as_str().map(|origin| origin.to_string()))
                .collect()
        })
        .unwrap_or_default();

    RendererConfig {
        mcp_url,
        frame_origins,
    }
}
