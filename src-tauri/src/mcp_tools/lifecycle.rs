use serde_json::Value;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::AsyncAppState;

pub(super) async fn call_install_plugin(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let manifest_json = arguments
        .get("manifest_json")
        .and_then(|v| v.as_str())
        .ok_or("Missing required parameter: manifest_json")?;

    let download_url = arguments
        .get("download_url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let manifest = if let Some(url) = &download_url {
        let (client, plugins_dir) = {
            let state_guard = state.lock().await;
            (
                state_guard.inner.http_client.clone(),
                state_guard.inner.plugins_dir().to_path_buf(),
            )
        };
        mcpviews_shared::package::download_and_install_plugin(&client, url, &plugins_dir).await?
    } else {
        serde_json::from_str::<mcpviews_shared::PluginManifest>(manifest_json)
            .map_err(|e| format!("Invalid manifest JSON: {}", e))?
    };

    let plugin_name = {
        let state_guard = state.lock().await;
        state_guard
            .inner
            .install_plugin_from_manifest(manifest, download_url.is_some())?
    };

    {
        let state_guard = state.lock().await;
        state_guard.inner.notify_tools_changed();
        let _ = state_guard.app_handle.emit("reload_renderers", ());
    }

    let trigger_auth = arguments
        .get("trigger_auth")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let auth_status_entry = {
        let state_guard = state.lock().await;
        let registry = state_guard.inner.plugin_registry.lock().unwrap();
        if let Some(m) = registry.manifests.iter().find(|m| m.name == plugin_name) {
            let statuses = super::collect_plugin_auth_status(&[m.clone()]);
            statuses.into_iter().next()
        } else {
            None
        }
    };

    let auth_result = if trigger_auth {
        if let Some(ref status) = auth_status_entry {
            let is_oauth = status["auth_type"].as_str() == Some("oauth");
            let is_configured = status["auth_configured"].as_bool().unwrap_or(false);
            if is_oauth && !is_configured {
                match crate::mcp_registry_tools::trigger_plugin_oauth(&plugin_name, None, state).await {
                    Ok(msg) => Some(msg),
                    Err(e) => Some(format!("Auth trigger failed: {}", e)),
                }
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let mut response = serde_json::json!({
        "content": [{
            "type": "text",
            "text": format!("Plugin '{}' installed successfully.", plugin_name)
        }]
    });

    if let Some(status) = auth_status_entry {
        response["auth_status"] = status;
    }
    if let Some(result) = auth_result {
        response["auth_result"] = serde_json::Value::String(result);
    }

    Ok(response)
}

pub(super) async fn call_update_plugins(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let plugin_name = arguments
        .get("plugin_name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    super::ensure_registry_fresh(state).await;

    let updates_needed: Vec<(String, String, mcpviews_shared::RegistryEntry)> = {
        let state_guard = state.lock().await;
        let registry = state_guard.inner.plugin_registry.lock().unwrap();
        let cached = state_guard.inner.latest_registry.lock().unwrap();

        let plugins_with_updates = registry.list_plugins_with_updates(&cached);
        plugins_with_updates
            .iter()
            .filter(|p| p.update_available.is_some())
            .filter(|p| {
                if let Some(ref name) = plugin_name {
                    p.name == *name
                } else {
                    true
                }
            })
            .filter_map(|p| {
                let entry = cached.iter().find(|e| e.name == p.name)?.clone();
                Some((p.name.clone(), p.version.clone(), entry))
            })
            .collect()
    };

    if updates_needed.is_empty() {
        return Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string(&serde_json::json!({
                    "updated": []
                })).unwrap()
            }]
        }));
    }

    let mut results: Vec<Value> = Vec::new();

    for (name, from_version, entry) in &updates_needed {
        let install_result = {
            let state_guard = state.lock().await;
            state_guard.inner.install_or_update_from_entry(entry).await
        };

        match install_result {
            Ok(()) => {
                results.push(serde_json::json!({
                    "plugin": name,
                    "from": from_version,
                    "to": entry.version,
                    "status": "success",
                }));
            }
            Err(e) => {
                results.push(serde_json::json!({
                    "plugin": name,
                    "from": from_version,
                    "to": entry.version,
                    "status": "error",
                    "error": e,
                }));
            }
        }
    }

    {
        let state_guard = state.lock().await;
        state_guard.inner.notify_tools_changed();
        let _ = state_guard.app_handle.emit("reload_renderers", ());
    }

    let trigger_auth = arguments
        .get("trigger_auth")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut auth_statuses: Vec<Value> = Vec::new();
    let mut auth_results: Vec<Value> = Vec::new();

    let successfully_updated: Vec<String> = results
        .iter()
        .filter(|r| r["status"] == "success")
        .filter_map(|r| r["plugin"].as_str().map(|s| s.to_string()))
        .collect();

    for updated_name in &successfully_updated {
        let status_entry = {
            let state_guard = state.lock().await;
            let registry = state_guard.inner.plugin_registry.lock().unwrap();
            if let Some(m) = registry.manifests.iter().find(|m| m.name == *updated_name) {
                let statuses = super::collect_plugin_auth_status(&[m.clone()]);
                statuses.into_iter().next()
            } else {
                None
            }
        };

        if let Some(status) = status_entry {
            let is_oauth = status["auth_type"].as_str() == Some("oauth");
            let is_configured = status["auth_configured"].as_bool().unwrap_or(false);

            if trigger_auth && is_oauth && !is_configured {
                match crate::mcp_registry_tools::trigger_plugin_oauth(updated_name, None, state).await {
                    Ok(msg) => auth_results.push(serde_json::json!({
                        "plugin": updated_name,
                        "result": msg,
                    })),
                    Err(e) => auth_results.push(serde_json::json!({
                        "plugin": updated_name,
                        "result": format!("Auth trigger failed: {}", e),
                    })),
                }
            }

            auth_statuses.push(status);
        }
    }

    let mut response = serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&serde_json::json!({
                "updated": results
            })).unwrap()
        }]
    });

    if !auth_statuses.is_empty() {
        response["auth_status"] = serde_json::Value::Array(auth_statuses);
    }
    if !auth_results.is_empty() {
        response["auth_results"] = serde_json::Value::Array(auth_results);
    }

    Ok(response)
}

pub(super) async fn call_save_update_preference(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let plugin = arguments
        .get("plugin")
        .and_then(|v| v.as_str())
        .ok_or("Missing required parameter: plugin")?;
    let policy = arguments
        .get("policy")
        .and_then(|v| v.as_str())
        .ok_or("Missing required parameter: policy")?;
    let version = arguments
        .get("version")
        .and_then(|v| v.as_str())
        .ok_or("Missing required parameter: version")?;

    let prefs = match policy {
        "once" => mcpviews_shared::PluginPreferences {
            update_policy: "ask".to_string(),
            update_policy_version: None,
            update_policy_source: "chat".to_string(),
        },
        "always" => mcpviews_shared::PluginPreferences {
            update_policy: "always".to_string(),
            update_policy_version: None,
            update_policy_source: "chat".to_string(),
        },
        "skip" => mcpviews_shared::PluginPreferences {
            update_policy: "skip".to_string(),
            update_policy_version: Some(version.to_string()),
            update_policy_source: "chat".to_string(),
        },
        _ => {
            return Err(format!(
                "Invalid policy '{}'. Must be 'once', 'always', or 'skip'.",
                policy
            ))
        }
    };

    let state_guard = state.lock().await;
    let store = state_guard.inner.plugin_store();
    store.save_preferences(plugin, &prefs)?;

    let message = match policy {
        "once" => format!(
            "Preference saved for '{}'. Proceed with update_plugins, then call mcpviews_setup to re-persist rules.",
            plugin
        ),
        "always" => format!(
            "Auto-update enabled for '{}'. Proceed with update_plugins, then call mcpviews_setup to re-persist rules.",
            plugin
        ),
        "skip" => format!("Update to version {} skipped for '{}'.", version, plugin),
        _ => unreachable!(),
    };

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&serde_json::json!({
                "status": "saved",
                "plugin": plugin,
                "policy": policy,
                "message": message,
            })).unwrap()
        }]
    }))
}
