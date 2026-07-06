use std::collections::BTreeMap;
use std::path::Path;
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

fn email_code_path(auth: &PluginAuth, kind: &str) -> Result<String, String> {
    let config = auth
        .email_code_auth()
        .ok_or_else(|| "Email-code sign-in is not declared for this plugin.".to_string())?;
    let path = match kind {
        "send" => &config.send_path,
        "verify" => &config.verify_path,
        _ => return Err(format!("Unknown email-code endpoint kind: {}", kind)),
    };
    if path.starts_with('/') {
        Ok(path.clone())
    } else {
        Err(format!(
            "Email-code {} path must be absolute, got '{}'",
            kind, path
        ))
    }
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

async fn post_json(state: &Arc<AppState>, url: &str, payload: Value) -> Result<Value, String> {
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

    serde_json::from_str(&text).map_err(|err| {
        format!(
            "Failed to parse JSON from '{}': {} ({})",
            url,
            err,
            shorten_error_body(&text)
        )
    })
}

fn expires_at_from_response(result: &Value) -> Option<i64> {
    result
        .get("expires_in")
        .and_then(|value| value.as_i64())
        .map(|expires_in| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64
                + expires_in
        })
}

fn organization_id_from_response(value: &Value) -> Option<String> {
    value
        .get("organization_id")
        .or_else(|| value.get("organizationId"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn stored_token_from_response(value: &Value) -> Result<StoredToken, String> {
    let access_token = value
        .get("access_token")
        .or_else(|| value.get("accessToken"))
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Email-code response did not include an access_token.".to_string())?;

    Ok(StoredToken {
        access_token: access_token.to_string(),
        refresh_token: value
            .get("refresh_token")
            .or_else(|| value.get("refreshToken"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        expires_at: expires_at_from_response(value),
    })
}

fn store_oauth_response_for_plugins_in_dir(
    plugin_names: &[String],
    result: &Value,
    auth_dir: &Path,
) -> Result<(), String> {
    let organization_id = result
        .get("organization_id")
        .or_else(|| result.get("organizationId"))
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Email-code response did not include an organization_id.".to_string())?;

    let mut stored_any = false;
    let token_values = result
        .get("organization_tokens")
        .or_else(|| result.get("organizationTokens"))
        .and_then(|value| value.as_array());

    if let Some(tokens) = token_values {
        for token_value in tokens {
            let token_org_id = organization_id_from_response(token_value).ok_or_else(|| {
                "Email-code organization token did not include an organization_id.".to_string()
            })?;
            let stored = stored_token_from_response(token_value)?;
            for plugin_name in plugin_names {
                mcpviews_shared::token_store::store_token_for_org(
                    auth_dir,
                    plugin_name,
                    &token_org_id,
                    &stored,
                )?;
            }
            stored_any = true;
        }
    }

    if !stored_any {
        let stored = stored_token_from_response(result)?;
        for plugin_name in plugin_names {
            mcpviews_shared::token_store::store_token_for_org(
                auth_dir,
                plugin_name,
                organization_id,
                &stored,
            )?;
        }
    }

    for plugin_name in plugin_names {
        mcpviews_shared::token_store::set_default_org(auth_dir, plugin_name, organization_id)?;
    }

    Ok(())
}

fn store_oauth_response_for_plugins(plugin_names: &[String], result: &Value) -> Result<(), String> {
    let auth_dir = auth_dir();
    store_oauth_response_for_plugins_in_dir(plugin_names, result, &auth_dir)
}

fn storage_plugins_for_email_code(plugin_name: &str) -> Vec<String> {
    match plugin_name {
        "decidr" | "ludflow" => vec!["decidr".to_string(), "ludflow".to_string()],
        _ => vec![plugin_name.to_string()],
    }
}

fn reconcile_shared_oauth_after_email_code(
    plugin_names: &[String],
    result: &Value,
    state: &Arc<AppState>,
) {
    let organization_ids = authenticated_organization_ids(result);
    if organization_ids.is_empty() {
        return;
    }

    let auth_by_plugin: BTreeMap<String, PluginAuth> = {
        let registry = state.plugin_registry.lock().unwrap();
        plugin_names
            .iter()
            .filter_map(|plugin_name| {
                registry
                    .resolve_plugin_auth(plugin_name)
                    .ok()
                    .map(|auth| (plugin_name.clone(), auth))
            })
            .collect()
    };

    for target_plugin in plugin_names {
        let Some(source_plugin) =
            crate::shared_oauth_tokens::shared_oauth_peer_plugin(target_plugin)
        else {
            continue;
        };
        let Some(target_auth) = auth_by_plugin.get(target_plugin) else {
            continue;
        };
        let Some(source_auth) = auth_by_plugin.get(source_plugin) else {
            continue;
        };

        if let Err(error) = crate::shared_oauth_tokens::reconcile_shared_oauth_org_tokens(
            &state.auth_dir,
            target_plugin,
            target_auth,
            source_plugin,
            source_auth,
            &organization_ids,
        ) {
            eprintln!(
                "[mcpviews] Shared OAuth token reconciliation failed for plugin '{}': {}",
                target_plugin, error
            );
        }
    }
}

fn authenticated_organization_ids(result: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    if let Some(tokens) = result
        .get("organization_tokens")
        .or_else(|| result.get("organizationTokens"))
        .and_then(|value| value.as_array())
    {
        for token in tokens {
            if let Some(org_id) = organization_id_from_response(token) {
                if !ids.iter().any(|existing| existing == &org_id) {
                    ids.push(org_id);
                }
            }
        }
    }

    if ids.is_empty() {
        if let Some(org_id) = organization_id_from_response(result) {
            ids.push(org_id);
        }
    }

    ids
}

fn response_has_oauth_tokens(result: &Value) -> bool {
    result
        .get("access_token")
        .or_else(|| result.get("accessToken"))
        .and_then(|value| value.as_str())
        .is_some()
        || result
            .get("organization_tokens")
            .or_else(|| result.get("organizationTokens"))
            .and_then(|value| value.as_array())
            .map(|tokens| !tokens.is_empty())
            .unwrap_or(false)
}

fn redacted_response(result: &Value) -> Value {
    let mut redacted = result.clone();
    let organization_ids = authenticated_organization_ids(result);
    if let Some(object) = redacted.as_object_mut() {
        object.remove("access_token");
        object.remove("accessToken");
        object.remove("refresh_token");
        object.remove("refreshToken");
        object.remove("token_type");
        object.remove("tokenType");
        object.remove("expires_in");
        object.remove("expiresIn");
        object.remove("organization_tokens");
        object.remove("organizationTokens");
        if response_has_oauth_tokens(result) {
            object.insert("authenticated".to_string(), Value::Bool(true));
        }
        if !organization_ids.is_empty() {
            object.insert(
                "authenticated_organization_ids".to_string(),
                Value::Array(
                    organization_ids
                        .iter()
                        .map(|org_id| Value::String(org_id.clone()))
                        .collect(),
                ),
            );
            object.insert(
                "authenticated_organization_count".to_string(),
                Value::Number(organization_ids.len().into()),
            );
        }
    }
    redacted
}

pub async fn send_email_code(
    plugin_name: &str,
    email: &str,
    state: &Arc<AppState>,
) -> Result<Value, String> {
    let auth = oauth_auth(plugin_name, state)?;
    let url = oauth_endpoint_url(&auth, &email_code_path(&auth, "send")?)?;

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
    email: &str,
    code: &str,
    organization_id: Option<&str>,
    organization_name: Option<&str>,
    state: &Arc<AppState>,
) -> Result<Value, String> {
    let auth = oauth_auth(plugin_name, state)?;
    let url = oauth_endpoint_url(&auth, &email_code_path(&auth, "verify")?)?;
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

    if response_has_oauth_tokens(&result) {
        let plugins = storage_plugins_for_email_code(plugin_name);
        store_oauth_response_for_plugins(&plugins, &result)?;
        reconcile_shared_oauth_after_email_code(&plugins, &result, state);
    }

    Ok(redacted_response(&result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_token_material_from_email_code_response() {
        let response = json!({
            "status": true,
            "organization_id": "org_123",
            "access_token": "secret_access",
            "refresh_token": "secret_refresh",
            "token_type": "bearer",
            "expires_in": 3600
        });

        let redacted = redacted_response(&response);

        assert_eq!(redacted["organization_id"], "org_123");
        assert_eq!(redacted["authenticated"], true);
        assert_eq!(redacted["authenticated_organization_count"], 1);
        assert!(redacted.get("access_token").is_none());
        assert!(redacted.get("refresh_token").is_none());
        assert!(redacted.get("token_type").is_none());
        assert!(redacted.get("expires_in").is_none());
    }

    #[test]
    fn redacts_nested_organization_token_material() {
        let response = json!({
            "status": true,
            "organization_id": "org_2",
            "organization_tokens": [
                {
                    "organization_id": "org_1",
                    "access_token": "secret_access_1",
                    "refresh_token": "secret_refresh_1",
                    "token_type": "bearer",
                    "expires_in": 3600
                },
                {
                    "organization_id": "org_2",
                    "access_token": "secret_access_2",
                    "refresh_token": "secret_refresh_2",
                    "token_type": "bearer",
                    "expires_in": 3600
                }
            ]
        });

        let redacted = redacted_response(&response);
        let serialized = redacted.to_string();

        assert_eq!(redacted["authenticated"], true);
        assert_eq!(redacted["authenticated_organization_count"], 2);
        assert_eq!(
            redacted["authenticated_organization_ids"],
            json!(["org_1", "org_2"])
        );
        assert!(redacted.get("organization_tokens").is_none());
        assert!(!serialized.contains("secret_access"));
        assert!(!serialized.contains("secret_refresh"));
    }

    #[test]
    fn stores_multi_org_tokens_for_all_storage_plugins() {
        let dir = tempfile::tempdir().unwrap();
        let plugins = storage_plugins_for_email_code("ludflow");
        let response = json!({
            "status": true,
            "organization_id": "org_2",
            "organization_tokens": [
                {
                    "organization_id": "org_1",
                    "access_token": "access_1",
                    "refresh_token": "refresh_1",
                    "expires_in": 3600
                },
                {
                    "organization_id": "org_2",
                    "access_token": "access_2",
                    "refresh_token": "refresh_2",
                    "expires_in": 3600
                }
            ]
        });

        store_oauth_response_for_plugins_in_dir(&plugins, &response, dir.path()).unwrap();

        for plugin_name in ["decidr", "ludflow"] {
            assert_eq!(
                mcpviews_shared::token_store::list_orgs(dir.path(), plugin_name),
                vec!["org_1".to_string(), "org_2".to_string()]
            );
            assert_eq!(
                mcpviews_shared::token_store::load_default_org(dir.path(), plugin_name),
                Some("org_2".to_string())
            );
            let token = mcpviews_shared::token_store::load_stored_token_for_org_unvalidated(
                dir.path(),
                plugin_name,
                "org_1",
            )
            .unwrap();
            assert_eq!(token.access_token, "access_1");
            assert_eq!(token.refresh_token, Some("refresh_1".to_string()));
        }
    }

    #[test]
    fn decidr_email_code_storage_uses_backend_owned_plugin_allowlist() {
        assert_eq!(
            storage_plugins_for_email_code("decidr"),
            vec!["decidr".to_string(), "ludflow".to_string()]
        );
        assert_eq!(
            storage_plugins_for_email_code("ludflow"),
            vec!["decidr".to_string(), "ludflow".to_string()]
        );
        assert_eq!(
            storage_plugins_for_email_code("custom-plugin"),
            vec!["custom-plugin".to_string()]
        );
    }
}
