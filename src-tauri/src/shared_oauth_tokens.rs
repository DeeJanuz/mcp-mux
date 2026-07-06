use std::collections::HashSet;
use std::path::Path;

use mcpviews_shared::token_store::{self, StoredTokenStatus};
use mcpviews_shared::PluginAuth;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct SharedOauthBackfillReport {
    pub(crate) mirrored: usize,
    pub(crate) skipped: usize,
}

pub(crate) fn shared_oauth_peer_plugin(plugin_name: &str) -> Option<&'static str> {
    match plugin_name {
        "decidr" => Some("ludflow"),
        "ludflow" => Some("decidr"),
        _ => None,
    }
}

pub(crate) fn oauth_auths_share_issuer_client(source: &PluginAuth, target: &PluginAuth) -> bool {
    let Some(source_fingerprint) = oauth_fingerprint(source) else {
        return false;
    };
    let Some(target_fingerprint) = oauth_fingerprint(target) else {
        return false;
    };
    source_fingerprint == target_fingerprint
}

pub(crate) fn reconcile_shared_oauth_org_tokens(
    auth_dir: &Path,
    target_plugin: &str,
    target_auth: &PluginAuth,
    source_plugin: &str,
    source_auth: &PluginAuth,
    allowed_org_ids: &[String],
) -> Result<SharedOauthBackfillReport, String> {
    let mut report = SharedOauthBackfillReport::default();
    if !oauth_auths_share_issuer_client(source_auth, target_auth) {
        report.skipped = allowed_org_ids.len();
        return Ok(report);
    }

    let allowed: HashSet<&str> = allowed_org_ids.iter().map(String::as_str).collect();
    for org_id in allowed {
        let target_status = token_store::token_status_for_org(auth_dir, target_plugin, org_id);
        if !matches!(
            target_status,
            StoredTokenStatus::Missing | StoredTokenStatus::ExpiredUnrefreshable
        ) {
            report.skipped += 1;
            continue;
        }

        let source_status = token_store::token_status_for_org(auth_dir, source_plugin, org_id);
        if !matches!(
            source_status,
            StoredTokenStatus::Valid | StoredTokenStatus::ExpiredRefreshable
        ) {
            report.skipped += 1;
            continue;
        }

        let Some(source_token) =
            token_store::load_stored_token_for_org_unvalidated(auth_dir, source_plugin, org_id)
        else {
            report.skipped += 1;
            continue;
        };

        token_store::store_token_for_org(auth_dir, target_plugin, org_id, &source_token)?;
        report.mirrored += 1;
    }

    Ok(report)
}

fn oauth_fingerprint(auth: &PluginAuth) -> Option<(String, String)> {
    let PluginAuth::OAuth {
        client_id,
        token_url,
        ..
    } = auth
    else {
        return None;
    };
    let client_id = client_id.as_deref()?.trim();
    if client_id.is_empty() {
        return None;
    }
    Some((
        client_id.to_string(),
        token_url.trim_end_matches('/').to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use mcpviews_shared::token_store::StoredToken;
    use tempfile::tempdir;

    const FUTURE: i64 = 4_102_444_800;
    const PAST: i64 = 1;

    fn oauth(client_id: &str, token_url: &str) -> PluginAuth {
        PluginAuth::OAuth {
            client_id: Some(client_id.to_string()),
            auth_url: "https://app.ludflow.com/oauth/authorize".to_string(),
            token_url: token_url.to_string(),
            scopes: vec!["mcp:tools".to_string()],
            email_code_auth: None,
        }
    }

    fn token(access_token: &str, refresh_token: Option<&str>, expires_at: i64) -> StoredToken {
        StoredToken {
            access_token: access_token.to_string(),
            refresh_token: refresh_token.map(str::to_string),
            expires_at: Some(expires_at),
        }
    }

    #[test]
    fn backfills_same_issuer_token_for_allowed_same_org() {
        let dir = tempdir().unwrap();
        let source_auth = oauth("shared-client", "https://app.ludflow.com/oauth/token");
        let target_auth = oauth("shared-client", "https://app.ludflow.com/oauth/token");
        token_store::store_token_for_org(
            dir.path(),
            "ludflow",
            "org_1",
            &token("source_access", Some("source_refresh"), FUTURE),
        )
        .unwrap();

        let report = reconcile_shared_oauth_org_tokens(
            dir.path(),
            "decidr",
            &target_auth,
            "ludflow",
            &source_auth,
            &["org_1".to_string()],
        )
        .unwrap();

        assert_eq!(report.mirrored, 1);
        let mirrored =
            token_store::load_stored_token_for_org_unvalidated(dir.path(), "decidr", "org_1")
                .unwrap();
        assert_eq!(mirrored.access_token, "source_access");
        assert_eq!(mirrored.refresh_token, Some("source_refresh".to_string()));
    }

    #[test]
    fn refuses_nonmatching_org_ids_not_in_target_catalog() {
        let dir = tempdir().unwrap();
        let source_auth = oauth("shared-client", "https://app.ludflow.com/oauth/token");
        let target_auth = oauth("shared-client", "https://app.ludflow.com/oauth/token");
        token_store::store_token_for_org(
            dir.path(),
            "ludflow",
            "source_only",
            &token("source_access", Some("source_refresh"), FUTURE),
        )
        .unwrap();

        let report = reconcile_shared_oauth_org_tokens(
            dir.path(),
            "decidr",
            &target_auth,
            "ludflow",
            &source_auth,
            &["target_only".to_string()],
        )
        .unwrap();

        assert_eq!(report.mirrored, 0);
        assert!(token_store::load_stored_token_for_org_unvalidated(
            dir.path(),
            "decidr",
            "source_only"
        )
        .is_none());
        assert!(token_store::load_stored_token_for_org_unvalidated(
            dir.path(),
            "decidr",
            "target_only"
        )
        .is_none());
    }

    #[test]
    fn replaces_expired_unrefreshable_target_with_refreshable_source() {
        let dir = tempdir().unwrap();
        let source_auth = oauth("shared-client", "https://app.ludflow.com/oauth/token");
        let target_auth = oauth("shared-client", "https://app.ludflow.com/oauth/token");
        token_store::store_token_for_org(
            dir.path(),
            "decidr",
            "org_1",
            &token("stale_target", None, PAST),
        )
        .unwrap();
        token_store::store_token_for_org(
            dir.path(),
            "ludflow",
            "org_1",
            &token("refreshable_source", Some("refresh"), PAST),
        )
        .unwrap();

        let report = reconcile_shared_oauth_org_tokens(
            dir.path(),
            "decidr",
            &target_auth,
            "ludflow",
            &source_auth,
            &["org_1".to_string()],
        )
        .unwrap();

        assert_eq!(report.mirrored, 1);
        assert_eq!(
            token_store::token_status_for_org(dir.path(), "decidr", "org_1"),
            StoredTokenStatus::ExpiredRefreshable
        );
        let mirrored =
            token_store::load_stored_token_for_org_unvalidated(dir.path(), "decidr", "org_1")
                .unwrap();
        assert_eq!(mirrored.access_token, "refreshable_source");
    }

    #[test]
    fn preserves_existing_target_default_org() {
        let dir = tempdir().unwrap();
        let source_auth = oauth("shared-client", "https://app.ludflow.com/oauth/token");
        let target_auth = oauth("shared-client", "https://app.ludflow.com/oauth/token");
        token_store::store_token_for_org(
            dir.path(),
            "decidr",
            "org_2",
            &token("default_access", Some("default_refresh"), FUTURE),
        )
        .unwrap();
        token_store::set_default_org(dir.path(), "decidr", "org_2").unwrap();
        token_store::store_token_for_org(
            dir.path(),
            "ludflow",
            "org_1",
            &token("source_access", Some("source_refresh"), FUTURE),
        )
        .unwrap();

        let report = reconcile_shared_oauth_org_tokens(
            dir.path(),
            "decidr",
            &target_auth,
            "ludflow",
            &source_auth,
            &["org_1".to_string()],
        )
        .unwrap();

        assert_eq!(report.mirrored, 1);
        assert_eq!(
            token_store::load_default_org(dir.path(), "decidr"),
            Some("org_2".to_string())
        );
    }

    #[test]
    fn refuses_different_oauth_clients() {
        let dir = tempdir().unwrap();
        let source_auth = oauth("source-client", "https://app.ludflow.com/oauth/token");
        let target_auth = oauth("target-client", "https://app.ludflow.com/oauth/token");
        token_store::store_token_for_org(
            dir.path(),
            "ludflow",
            "org_1",
            &token("source_access", Some("source_refresh"), FUTURE),
        )
        .unwrap();

        let report = reconcile_shared_oauth_org_tokens(
            dir.path(),
            "decidr",
            &target_auth,
            "ludflow",
            &source_auth,
            &["org_1".to_string()],
        )
        .unwrap();

        assert_eq!(report.mirrored, 0);
        assert!(
            token_store::load_stored_token_for_org_unvalidated(dir.path(), "decidr", "org_1")
                .is_none()
        );
    }
}
