#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PluginProtocolPath {
    pub plugin_name: String,
    pub file_path: String,
}

pub(crate) fn plugin_renderer_url(plugin_name: &str, file_name: &str, mtime: u64) -> String {
    plugin_renderer_url_for_platform(plugin_name, file_name, mtime, cfg!(target_os = "windows"))
}

pub(crate) fn plugin_renderer_url_for_platform(
    plugin_name: &str,
    file_name: &str,
    mtime: u64,
    windows: bool,
) -> String {
    if windows {
        format!(
            "https://plugin.localhost/{}/renderers/{}?v={}",
            plugin_name, file_name, mtime
        )
    } else {
        format!(
            "plugin://localhost/{}/renderers/{}?v={}",
            plugin_name, file_name, mtime
        )
    }
}

pub(crate) fn parse_plugin_protocol_uri(uri: &str) -> Option<PluginProtocolPath> {
    let parsed = url::Url::parse(uri).ok()?;
    let allowed_host = (parsed.scheme() == "plugin" && parsed.host_str() == Some("localhost"))
        || (parsed.scheme() == "https" && parsed.host_str() == Some("plugin.localhost"));
    if !allowed_host {
        return None;
    }

    let path = parsed.path().trim_start_matches('/');
    let mut parts = path.splitn(2, '/');
    let plugin_name = parts.next().unwrap_or("").trim();
    let file_path = parts.next().unwrap_or("").trim();

    if plugin_name.is_empty() || file_path.is_empty() {
        return None;
    }

    Some(PluginProtocolPath {
        plugin_name: plugin_name.to_string(),
        file_path: file_path.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_url_uses_plugin_scheme_on_non_windows() {
        let url = plugin_renderer_url_for_platform("decidr", "timeline.js", 42, false);
        assert_eq!(url, "plugin://localhost/decidr/renderers/timeline.js?v=42");
    }

    #[test]
    fn renderer_url_uses_https_localhost_on_windows() {
        let url = plugin_renderer_url_for_platform("decidr", "timeline.js", 42, true);
        assert_eq!(
            url,
            "https://plugin.localhost/decidr/renderers/timeline.js?v=42"
        );
    }

    #[test]
    fn parses_macos_plugin_protocol_uri() {
        let parsed = parse_plugin_protocol_uri("plugin://localhost/ludflow/renderers/app.js?v=123")
            .expect("expected parsed protocol path");

        assert_eq!(parsed.plugin_name, "ludflow");
        assert_eq!(parsed.file_path, "renderers/app.js");
    }

    #[test]
    fn parses_windows_plugin_protocol_uri() {
        let parsed =
            parse_plugin_protocol_uri("https://plugin.localhost/ludflow/renderers/app.js?v=123")
                .expect("expected parsed protocol path");

        assert_eq!(parsed.plugin_name, "ludflow");
        assert_eq!(parsed.file_path, "renderers/app.js");
    }

    #[test]
    fn rejects_unknown_or_incomplete_plugin_protocol_uri() {
        assert!(parse_plugin_protocol_uri("https://example.com/ludflow/app.js").is_none());
        assert!(
            parse_plugin_protocol_uri("https://plugin.localhost.evil/ludflow/app.js").is_none()
        );
        assert!(parse_plugin_protocol_uri("https://plugin.localhost/ludflow").is_none());
    }
}
