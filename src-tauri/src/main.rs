// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_update;
mod apps_popup;
mod auth;
mod auth_browser;
mod commands;
mod context_layer;
mod custom_protocols;
mod datasets;
mod desktop_relay;
mod external_web_panel;
mod file_download;
mod first_party_ai;
mod http_server;
mod installer;
mod installer_update;
mod mcp;
mod mcp_prompts;
mod mcp_registry_tools;
mod mcp_session;
mod mcp_tools;
mod native_panel;
mod plugin;
mod plugin_email_auth;
mod registry;
mod renderer_scanner;
mod review;
mod session;
mod state;
#[cfg(test)]
mod test_utils;
mod tool_cache;

use state::AppState;
use std::collections::BTreeSet;
use std::net::IpAddr;
use std::sync::Arc;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Listener, Manager,
};
use tauri_plugin_autostart::MacosLauncher;

// Tauri custom URI schemes are served at `plugin://localhost/...` on macOS, iOS,
// and Linux, but at `https://plugin.localhost/...` on Windows. CSP must whitelist
// both forms so the same renderer fetches succeed cross-platform.
// See https://github.com/orgs/tauri-apps/discussions/5597
const BASE_CSP: &str = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net plugin://localhost https://plugin.localhost; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com plugin://localhost https://plugin.localhost; font-src 'self' https://fonts.gstatic.com plugin://localhost https://plugin.localhost; connect-src 'self' http://localhost:4200; img-src 'self' data: blob: plugin://localhost https://plugin.localhost; frame-src 'self'";
const DEFAULT_HTTP_PORT: u16 = 4200;
const STAGING_HTTP_PORT: u16 = 4201;
const DEFAULT_HTTP_BIND_ADDR: &str = "127.0.0.1";
const HTTP_BIND_ADDR_ENV: &str = "MCPVIEWS_BIND_ADDR";
const DEV_HTTP_PORT_ENV: &str = "MCPVIEWS_DEV_HTTP_PORT";

fn compiled_build_lane() -> Option<&'static str> {
    option_env!("MCPVIEWS_BUILD_LANE").and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn is_staging_lane(lane: Option<&str>) -> bool {
    lane.unwrap_or_default()
        .trim()
        .eq_ignore_ascii_case("staging")
}

fn app_display_name_for_lane(lane: Option<&str>) -> &'static str {
    if is_staging_lane(lane) {
        "MCPViews Staging"
    } else {
        "MCPViews"
    }
}

fn default_http_port_for_lane(lane: Option<&str>) -> u16 {
    if is_staging_lane(lane) {
        STAGING_HTTP_PORT
    } else {
        DEFAULT_HTTP_PORT
    }
}

fn configure_runtime_storage_lane() {
    if !is_staging_lane(compiled_build_lane()) {
        return;
    }
    if std::env::var_os(mcpviews_shared::MCPVIEWS_HOME_ENV).is_some() {
        return;
    }
    if std::env::var_os(mcpviews_shared::MCPVIEWS_STORAGE_LANE_ENV).is_some() {
        return;
    }
    std::env::set_var(mcpviews_shared::MCPVIEWS_STORAGE_LANE_ENV, "staging");
}

fn build_csp(connect_origins: &[String], frame_origins: &[String]) -> String {
    let mut csp = BASE_CSP.to_string();
    if !connect_origins.is_empty() {
        let suffix = connect_origins.join(" ");
        csp = csp.replace(
            "connect-src 'self' http://localhost:4200",
            &format!("connect-src 'self' http://localhost:4200 {}", suffix),
        );
    }
    if !frame_origins.is_empty() {
        let suffix = frame_origins.join(" ");
        csp = csp.replace("frame-src 'self'", &format!("frame-src 'self' {}", suffix));
    }
    csp
}

fn insert_csp_origin(origins: &mut BTreeSet<String>, value: &str) {
    let Ok(url) = url::Url::parse(value) else {
        return;
    };
    let scheme = url.scheme();
    if !matches!(scheme, "http" | "https" | "ws" | "wss") {
        return;
    }
    let authority = url.authority();
    if authority.is_empty() {
        return;
    }

    origins.insert(format!("{scheme}://{authority}"));

    let websocket_scheme = match scheme {
        "http" => Some("ws"),
        "https" => Some("wss"),
        "ws" => Some("ws"),
        "wss" => Some("wss"),
        _ => None,
    };
    if let Some(ws_scheme) = websocket_scheme {
        origins.insert(format!("{ws_scheme}://{authority}"));
    }

    if let Some(host) = url.host_str() {
        if host.eq_ignore_ascii_case("tribexai.com") || host.ends_with(".tribexai.com") {
            origins.insert("https://*.tribexai.com".to_string());
            origins.insert("wss://*.tribexai.com".to_string());
        }
    }
}

fn first_party_ai_csp_origins_from_settings(
    settings: &mcpviews_shared::settings::FirstPartyAiSettings,
) -> Vec<String> {
    let mut origins = BTreeSet::new();
    for value in [
        settings.base_url.as_deref(),
        settings.relay_base_url.as_deref(),
        settings.device_base_url.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        insert_csp_origin(&mut origins, value);
    }
    origins.into_iter().collect()
}

fn first_party_ai_csp_origins() -> Vec<String> {
    first_party_ai_csp_origins_from_settings(&first_party_ai::load_settings())
}

fn http_bind_address() -> String {
    let port = if cfg!(debug_assertions) {
        std::env::var(DEV_HTTP_PORT_ENV)
            .ok()
            .and_then(|value| value.trim().parse::<u16>().ok())
            .unwrap_or_else(|| default_http_port_for_lane(compiled_build_lane()))
    } else {
        default_http_port_for_lane(compiled_build_lane())
    };

    let bind_addr = std::env::var(HTTP_BIND_ADDR_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_HTTP_BIND_ADDR.to_string());

    http_bind_address_for(&bind_addr, port)
}

fn http_bind_address_for(bind_addr: &str, port: u16) -> String {
    let trimmed = bind_addr.trim();
    if trimmed.parse::<std::net::SocketAddr>().is_ok() {
        return trimmed.to_string();
    }
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return format!("{trimmed}:{port}");
    }
    if trimmed.parse::<std::net::Ipv6Addr>().is_ok() {
        return format!("[{trimmed}]:{port}");
    }
    format!("{trimmed}:{port}")
}

fn bind_host_from_address(bind_address: &str) -> &str {
    let trimmed = bind_address.trim();
    if let Some(rest) = trimmed.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            return &rest[..end];
        }
    }
    trimmed
        .rsplit_once(':')
        .map(|(host, _)| host)
        .unwrap_or(trimmed)
}

fn is_loopback_bind_address(bind_address: &str) -> bool {
    let host = bind_host_from_address(bind_address).trim();
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .map(|addr| addr.is_loopback())
            .unwrap_or(false)
}

fn log_http_bind_security_posture(bind_address: &str) {
    if is_loopback_bind_address(bind_address) {
        eprintln!("[mcpviews] HTTP server restricted to loopback at {bind_address}");
    } else {
        eprintln!(
            "[mcpviews] WARNING: HTTP server binding to non-loopback address {bind_address}; \
             local MCP APIs may be reachable from the network"
        );
    }
}

fn csp_request_hook(
    state: Arc<AppState>,
) -> impl Fn(
    tauri::http::Request<Vec<u8>>,
    &mut tauri::http::Response<std::borrow::Cow<'static, [u8]>>,
) + Send
       + Sync
       + 'static {
    move |_req, resp| {
        let mut origins: BTreeSet<String> = state.plugin_csp_origins().into_iter().collect();
        origins.extend(first_party_ai_csp_origins());
        let origins = origins.into_iter().collect::<Vec<_>>();
        let frame_origins = state.plugin_frame_origins();
        let csp = build_csp(&origins, &frame_origins);
        resp.headers_mut()
            .insert("content-security-policy", csp.parse().unwrap());
    }
}

fn mime_from_extension(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("js") => "application/javascript",
        Some("mjs") => "application/javascript",
        Some("css") => "text/css",
        Some("html") | Some("htm") => "text/html",
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        _ => "application/octet-stream",
    }
}

fn main() {
    configure_runtime_storage_lane();
    let app_state = Arc::new(AppState::new());
    let app_display_name = app_display_name_for_lane(compiled_build_lane());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .register_uri_scheme_protocol("plugin", |_ctx, request| {
            let uri = request.uri().to_string();
            let Some(protocol_path) = custom_protocols::parse_plugin_protocol_uri(&uri) else {
                return tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap();
            };

            // Path traversal protection
            if protocol_path.file_path.contains("..") {
                return tauri::http::Response::builder()
                    .status(403)
                    .body(b"Forbidden: path traversal".to_vec())
                    .unwrap();
            }

            let plugins_dir = mcpviews_shared::plugins_dir();
            let full_path = plugins_dir
                .join(protocol_path.plugin_name)
                .join(protocol_path.file_path);

            match std::fs::read(&full_path) {
                Ok(contents) => {
                    let mime = mime_from_extension(&full_path);
                    tauri::http::Response::builder()
                        .status(200)
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Cache-Control", "no-store")
                        .body(contents)
                        .unwrap()
                }
                Err(_) => tauri::http::Response::builder()
                    .status(404)
                    .body(b"Not found".to_vec())
                    .unwrap(),
            }
        })
        .manage(app_state.clone())
        .invoke_handler(tauri::generate_handler![
            commands::get_sessions,
            commands::submit_decision,
            commands::dismiss_session,
            commands::get_health,
            commands::check_app_update,
            commands::install_app_update,
            commands::open_external_url,
            commands::open_native_app_view,
            commands::open_apps_popup,
            commands::close_apps_popup,
            commands::select_apps_popup_renderer,
            commands::mount_native_app_panel,
            commands::mount_external_web_panel,
            commands::update_native_app_panel_bounds,
            commands::close_native_app_panel,
            commands::list_plugins,
            commands::install_plugin,
            commands::uninstall_plugin,
            commands::install_plugin_from_file,
            commands::install_plugin_from_registry,
            commands::install_plugin_from_zip,
            commands::fetch_registry,
            commands::start_plugin_auth,
            commands::send_plugin_email_code,
            commands::verify_plugin_email_code,
            commands::get_plugin_auth_header,
            commands::list_plugin_org_auth,
            commands::list_plugin_contexts,
            commands::set_plugin_context_default,
            commands::store_plugin_token,
            commands::get_first_party_ai_config,
            commands::start_first_party_ai_auth,
            commands::get_first_party_ai_auth_header,
            commands::get_first_party_ai_session,
            commands::send_first_party_ai_magic_link,
            commands::send_first_party_ai_email_code,
            commands::verify_first_party_ai_email_code,
            commands::verify_first_party_ai_magic_link,
            commands::clear_first_party_ai_auth,
            commands::first_party_ai_request,
            commands::first_party_ai_relay_request,
            commands::fetch_signed_file_bytes,
            commands::probe_local_runtime_host,
            commands::list_local_mcp_tools,
            commands::get_local_mcp_catalog,
            commands::call_local_mcp_tool,
            commands::register_first_party_ai_desktop_relay,
            commands::refresh_first_party_ai_desktop_relay,
            commands::start_first_party_ai_companion_stream,
            commands::stop_first_party_ai_companion_stream,
            commands::start_first_party_ai_desktop_relay_stream,
            commands::start_first_party_ai_realtime_relay_stream,
            commands::stop_first_party_ai_desktop_relay_stream,
            commands::start_first_party_ai_desktop_presence_heartbeat,
            commands::stop_first_party_ai_desktop_presence_heartbeat,
            commands::get_settings,
            commands::save_settings,
            commands::get_plugin_renderers,
            commands::get_registry_sources,
            commands::add_registry_source,
            commands::remove_registry_source,
            commands::toggle_registry_source,
            commands::update_plugin,
            commands::check_plugin_prerelease,
            commands::install_plugin_prerelease,
            commands::rollback_plugin_to_stable,
            commands::reinstall_plugin,
            commands::clear_plugin_auth,
            commands::save_file,
            commands::save_binary_file,
            commands::download_file,
            commands::open_file_preview,
            commands::get_renderer_registry,
            commands::get_standalone_renderers,
            commands::set_native_theme,
            commands::set_plugin_update_policy,
            commands::get_plugin_update_policy,
            commands::list_plugin_orgs,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    // Hide the main window to tray, but let auxiliary windows close normally.
                    let _ = apps_popup::close_apps_popup_window(window.app_handle());
                    api.prevent_close();
                    let _ = window.hide();
                }
            } else if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "main" {
                let _ = apps_popup::close_apps_popup_window(window.app_handle());
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            let state = app_state.clone();

            installer::cleanup_legacy_windows_setup_script(app.handle());

            match app.path().resource_dir() {
                Ok(resource_dir) => {
                    match app_state.ensure_resource_bundled_plugins(&resource_dir) {
                        Ok(installed) if !installed.is_empty() => {
                            eprintln!(
                                "[mcpviews] Installed bundled resource plugins: {}",
                                installed.join(", ")
                            );
                            app_state.reload_plugins();
                        }
                        Ok(_) => {}
                        Err(error) => {
                            eprintln!(
                                "[mcpviews] Failed to install bundled resource plugins: {}",
                                error
                            );
                        }
                    }
                }
                Err(error) => {
                    eprintln!("[mcpviews] Failed to resolve resource directory: {}", error);
                }
            }

            // Pre-bind the TCP listener on the main thread so the port is ready
            // before Claude Code probes it (eliminates MCP startup race condition)
            let bind_address = http_bind_address();
            log_http_bind_security_posture(&bind_address);
            let std_listener = std::net::TcpListener::bind(&bind_address)
                .map_err(|e| format!("Failed to bind to {bind_address}: {e}"))?;
            std_listener
                .set_nonblocking(true)
                .map_err(|e| format!("Failed to set non-blocking: {e}"))?;

            // Spawn the axum HTTP server on a dedicated thread with its own tokio runtime
            std::thread::Builder::new()
                .name("http-server".into())
                .spawn(move || {
                    let rt =
                        tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
                    rt.block_on(async move {
                        http_server::start_http_server(state, handle, std_listener).await;
                    });
                })
                .expect("Failed to spawn HTTP thread");

            // Create main window programmatically with dynamic CSP
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title(app_display_name)
            .inner_size(1200.0, 800.0)
            .resizable(true)
            .theme(Some(tauri::Theme::Light))
            .use_https_scheme(true)
            .on_web_resource_request(csp_request_hook(app_state.clone()))
            .on_download(file_download::download_handler(
                "main",
                app.handle().clone(),
            ))
            .build()?;

            // Listen for reload_renderers to refresh main window CSP
            let reload_handle = app.handle().clone();
            app.listen("reload_renderers", move |_| {
                if let Some(window) = reload_handle.get_webview_window("main") {
                    let _ = window.eval("window.location.reload()");
                }
            });

            // Build system tray menu
            let show_item = MenuItemBuilder::with_id("show", "Show Window").build(app)?;
            let manage_plugins_item =
                MenuItemBuilder::with_id("manage_plugins", "Manage Plugins").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let tray_menu_builder = MenuBuilder::new(app)
                .item(&show_item)
                .item(&manage_plugins_item);
            let tray_menu = tray_menu_builder.separator().item(&quit_item).build()?;

            // Create tray icon
            let icon = app
                .default_window_icon()
                .cloned()
                .unwrap_or_else(|| Image::new_owned(vec![99; 16 * 16 * 4], 16, 16));

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&tray_menu)
                .tooltip(app_display_name)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "manage_plugins" => {
                        if let Some(window) = app.get_webview_window("plugin-manager") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        } else {
                            let state: tauri::State<'_, Arc<AppState>> = app.state();
                            let _ = tauri::WebviewWindowBuilder::new(
                                app,
                                "plugin-manager",
                                tauri::WebviewUrl::App("plugin-manager.html".into()),
                            )
                            .title(format!("{} - Plugin Manager", app_display_name))
                            .inner_size(800.0, 600.0)
                            .use_https_scheme(true)
                            .on_web_resource_request(csp_request_hook(state.inner().clone()))
                            .on_download(file_download::download_handler(
                                "plugin-manager",
                                app.clone(),
                            ))
                            .build();
                        }
                    }
                    "quit" => {
                        let _ = apps_popup::close_apps_popup_window(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MCPViews");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_csp_no_extras() {
        let csp = build_csp(&[], &[]);
        assert_eq!(csp, BASE_CSP);
    }

    #[test]
    fn test_default_lane_uses_production_app_identity_and_port() {
        assert_eq!(app_display_name_for_lane(None), "MCPViews");
        assert_eq!(app_display_name_for_lane(Some("")), "MCPViews");
        assert_eq!(app_display_name_for_lane(Some("production")), "MCPViews");
        assert_eq!(default_http_port_for_lane(None), 4200);
        assert_eq!(default_http_port_for_lane(Some("production")), 4200);
    }

    #[test]
    fn test_staging_lane_uses_staging_app_identity_and_port() {
        assert_eq!(
            app_display_name_for_lane(Some("staging")),
            "MCPViews Staging"
        );
        assert_eq!(default_http_port_for_lane(Some("staging")), 4201);
        assert_eq!(default_http_port_for_lane(Some(" StAgInG ")), 4201);
    }

    #[test]
    fn test_http_bind_address_defaults_and_overrides() {
        assert_eq!(
            http_bind_address_for(DEFAULT_HTTP_BIND_ADDR, DEFAULT_HTTP_PORT),
            "127.0.0.1:4200"
        );
        assert_eq!(http_bind_address_for("0.0.0.0", 4200), "0.0.0.0:4200");
        assert_eq!(http_bind_address_for("0.0.0.0:4210", 4200), "0.0.0.0:4210");
        assert_eq!(http_bind_address_for("::1", 4200), "[::1]:4200");
        assert_eq!(http_bind_address_for("[::1]", 4200), "[::1]:4200");
    }

    #[test]
    fn test_loopback_bind_address_detection() {
        assert!(is_loopback_bind_address("127.0.0.1:4200"));
        assert!(is_loopback_bind_address("localhost:4200"));
        assert!(is_loopback_bind_address("[::1]:4200"));
        assert!(!is_loopback_bind_address("0.0.0.0:4200"));
        assert!(!is_loopback_bind_address("192.168.1.10:4200"));
    }

    #[test]
    fn test_build_csp_with_origins() {
        let origins = vec![
            "https://api.example.com".to_string(),
            "https://other.io".to_string(),
        ];
        let csp = build_csp(&origins, &[]);
        assert!(csp.contains(
            "connect-src 'self' http://localhost:4200 https://api.example.com https://other.io"
        ));
    }

    #[test]
    fn test_build_csp_with_frame_origins() {
        let origins = vec!["https://app.example.com".to_string()];
        let csp = build_csp(&[], &origins);
        assert!(csp.contains("frame-src 'self' https://app.example.com"));
        assert!(csp.contains("connect-src 'self' http://localhost:4200"));
    }

    #[test]
    fn test_build_csp_preserves_other_directives() {
        let origins = vec!["https://api.example.com".to_string()];
        let csp = build_csp(&origins, &[]);
        assert!(csp.contains("default-src 'self'"));
        assert!(csp.contains("script-src 'self' 'unsafe-inline' 'unsafe-eval'"));
        assert!(csp.contains("font-src 'self' https://fonts.gstatic.com"));
        assert!(csp.contains("img-src 'self' data: blob:"));
    }

    #[test]
    fn test_first_party_ai_csp_origins_include_websocket_and_tribex_runtime_wildcards() {
        let settings = mcpviews_shared::settings::FirstPartyAiSettings {
            base_url: Some("https://dev.app.tribexai.com".to_string()),
            relay_base_url: Some("https://dev.app.tribexai.com".to_string()),
            device_base_url: None,
            relay_token: None,
            relay_token_expires_at: None,
            relay_device_id: None,
            auth_url: None,
            token_url: None,
            client_id: None,
        };

        let origins = first_party_ai_csp_origins_from_settings(&settings);
        assert!(origins.contains(&"https://dev.app.tribexai.com".to_string()));
        assert!(origins.contains(&"wss://dev.app.tribexai.com".to_string()));
        assert!(origins.contains(&"https://*.tribexai.com".to_string()));
        assert!(origins.contains(&"wss://*.tribexai.com".to_string()));
    }

    #[test]
    fn test_first_party_ai_csp_origins_include_custom_websocket_origin() {
        let settings = mcpviews_shared::settings::FirstPartyAiSettings {
            base_url: Some("http://127.0.0.1:8787".to_string()),
            relay_base_url: None,
            device_base_url: None,
            relay_token: None,
            relay_token_expires_at: None,
            relay_device_id: None,
            auth_url: None,
            token_url: None,
            client_id: None,
        };

        let origins = first_party_ai_csp_origins_from_settings(&settings);
        assert!(origins.contains(&"http://127.0.0.1:8787".to_string()));
        assert!(origins.contains(&"ws://127.0.0.1:8787".to_string()));
    }
}
