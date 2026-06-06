use std::sync::Arc;

use mcpviews_shared::{auth_dir, token_store::StoredToken, PluginAuth};
use serde_json::{json, Value};

use crate::state::AppState;

fn oauth_auth(plugin_name: &str, state: &Arc<AppState>) -> Result<PluginAuth, String> {
    let registry = state.plugin_registry.lock().unwrap();
    registry.resolve_plugin_auth(plugin_name)
}

fn oauth_endpoint_url(auth: &PluginAuth, path: &str) -> Result<String, String> {
    let token_url = match auth {
        PluginAuth::OAuth { token_url, .. } => token_url,
        _ => return Err("Email-code sign-in is only available for OAuth plugins.".to_string()),
    };

    let parsed = reqwest::Url::parse(token_url)
        .map_err(|err| format!("Invalid plugin token_url '{}': {}", token_url, err))?;
    let origin = parsed
        .origin()
        .ascii_serialization()
        .trim_end_matches('/')
        .to_string();
    Ok(format!("{}{}", origin, path))
}

fn oauth_client_id(auth: &PluginAuth) -> Option<String> {
    match auth {
        PluginAuth::OAuth { client_id, .. } => client_id.clone(),
        _ => None,
    }
}

fn shorten_error_body(value: &str) -> String {
    let trimmed = value.trim();
    const MAX_LEN: usize = 600;
    if trimmed.len() <= MAX_LEN {
        trimmed.to_string()
    } else {
        format!("{}...", &trimmed[..MAX_LEN])
    }
}

async fn post_json(
    state: &Arc<AppState>,
    url: &str,
    payload: Value,
) -> Result<Value, String> {
    let response = state
        .http_client
        .post(url)
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|err| format!("Request to '{}' failed: {}", url, err))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Failed to read response from '{}': {}", url, err))?;

    if !status.is_success() {
        return Err(format!(
            "HTTP {} from '{}': {}",
            status.as_u16(),
            url,
            shorten_error_body(&text)
        ));
    }

    if text.trim().is_empty() {
        return Ok(json!({ "status": true }));
    }

    serde_json::from_str(&text)
        .map_err(|err| format!("Failed to parse JSON from '{}': {} ({})", url, err, shorten_error_body(&text)))
}

fn expires_at_from_response(result: &Value) -> Option<i64> {
    result.get("expires_in").and_then(|value| value.as_i64()).map(|expires_in| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64
            + expires_in
    })
}

fn store_oauth_response_for_plugins(
    plugin_names: &[String],
    result: &Value,
) -> Result<(), String> {
    let access_token = result
        .get("access_token")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Email-code response did not include an access_token.".to_string())?;
    let organization_id = result
        .get("organization_id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Email-code response did not include an organization_id.".to_string())?;

    let stored = StoredToken {
        access_token: access_token.to_string(),
        refresh_token: result
            .get("refresh_token")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        expires_at: expires_at_from_response(result),
    };

    let auth_dir = auth_dir();
    for plugin_name in plugin_names {
        mcpviews_shared::token_store::store_token_for_org(
            &auth_dir,
            plugin_name,
            organization_id,
            &stored,
        )?;
        mcpviews_shared::token_store::set_default_org(&auth_dir, plugin_name, organization_id)?;
    }

    Ok(())
}

pub async fn send_email_code(
    plugin_name: &str,
    email: &str,
    state: &Arc<AppState>,
) -> Result<Value, String> {
    let auth = oauth_auth(plugin_name, state)?;
    let url = oauth_endpoint_url(&auth, "/api/mcpviews/auth/email-code/send")?;

    post_json(
        state,
        &url,
        json!({
            "email": email,
            "client_id": oauth_client_id(&auth),
        }),
    )
    .await
}

pub async fn verify_email_code(
    plugin_name: &str,
    store_plugin_names: &[String],
    email: &str,
    code: &str,
    organization_id: Option<&str>,
    organization_name: Option<&str>,
    state: &Arc<AppState>,
) -> Result<Value, String> {
    let auth = oauth_auth(plugin_name, state)?;
    let url = oauth_endpoint_url(&auth, "/api/mcpviews/auth/email-code/verify")?;
    let result = post_json(
        state,
        &url,
        json!({
            "email": email,
            "code": code,
            "client_id": oauth_client_id(&auth),
            "organization_id": organization_id,
            "organization_name": organization_name,
        }),
    )
    .await?;

    if result.get("access_token").and_then(|value| value.as_str()).is_some() {
        let plugins = if store_plugin_names.is_empty() {
            vec![plugin_name.to_string()]
        } else {
            store_plugin_names.to_vec()
        };
        store_oauth_response_for_plugins(&plugins, &result)?;
    }

    Ok(result)
}
