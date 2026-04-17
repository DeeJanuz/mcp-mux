use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::AsyncAppState;

pub(crate) async fn build_hosted_discovery_catalog(
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Value {
    super::ensure_registry_fresh(state).await;

    let all_tools = super::list_tools(state).await;
    let available_tools =
        super::filter_hosted_model_facing_tools(super::extract_tool_summaries_with_schema(&all_tools));

    let state_guard = state.lock().await;
    let registry = state_guard.inner.plugin_registry.lock().unwrap();
    let plugin_status = super::collect_plugin_auth_status(&registry.manifests);

    let mut connectors = Vec::new();
    if let Some(core_connector) = super::build_core_hosted_connector(&available_tools) {
        connectors.push(core_connector);
    }
    connectors.extend(super::build_plugin_hosted_connectors(
        &registry.manifests,
        &registry.tool_cache,
        &available_tools,
        &plugin_status,
    ));

    serde_json::json!({
        "tools": available_tools,
        "connectors": connectors,
    })
}

pub(super) async fn call_describe_connector(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let key = arguments
        .get("key")
        .and_then(|value| value.as_str())
        .ok_or("Missing required parameter: key")?;
    let catalog = build_hosted_discovery_catalog(state).await;
    let connector = catalog
        .get("connectors")
        .and_then(|value| value.as_array())
        .and_then(|connectors| {
            connectors.iter().find(|entry| {
                entry.get("key").and_then(|value| value.as_str()) == Some(key)
            })
        })
        .cloned()
        .ok_or_else(|| format!("Unknown connector: {}", key))?;

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&connector).unwrap()
        }]
    }))
}

pub(super) async fn call_describe_tool_group(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let connector_key = arguments
        .get("connector_key")
        .and_then(|value| value.as_str())
        .ok_or("Missing required parameter: connector_key")?;
    let group_name = arguments
        .get("name")
        .and_then(|value| value.as_str())
        .ok_or("Missing required parameter: name")?;
    let catalog = build_hosted_discovery_catalog(state).await;
    let group = catalog
        .get("connectors")
        .and_then(|value| value.as_array())
        .and_then(|connectors| {
            connectors.iter().find(|entry| {
                entry.get("key").and_then(|value| value.as_str()) == Some(connector_key)
            })
        })
        .and_then(|connector| connector.get("toolGroups").and_then(|value| value.as_array()))
        .and_then(|groups| {
            groups.iter().find(|entry| {
                entry.get("name").and_then(|value| value.as_str()) == Some(group_name)
            })
        })
        .cloned()
        .ok_or_else(|| format!("Unknown tool group '{}' for connector '{}'", group_name, connector_key))?;

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&group).unwrap()
        }]
    }))
}

pub(super) async fn call_describe_tool(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let name = arguments
        .get("name")
        .and_then(|value| value.as_str())
        .ok_or("Missing required parameter: name")?;
    let catalog = build_hosted_discovery_catalog(state).await;
    let tool = catalog
        .get("tools")
        .and_then(|value| value.as_array())
        .and_then(|tools| {
            tools.iter().find(|entry| {
                entry.get("name").and_then(|value| value.as_str()) == Some(name)
            })
        })
        .cloned()
        .ok_or_else(|| format!("Unknown tool: {}", name))?;

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&tool).unwrap()
        }]
    }))
}
