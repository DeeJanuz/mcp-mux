use std::time::Duration;

use base64::Engine;
use reqwest::header::{ACCEPT, USER_AGENT};
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri_plugin_updater::UpdaterExt;

#[cfg(test)]
use crate::installer_update::ReleaseFlavor;
use crate::installer_update::{
    current_manual_download_platform, current_update_manifest_asset, matches_macos_download_asset,
    matches_windows_msi_download_asset, matches_windows_setup_download_asset, release_flavor,
    ManualDownloadPlatform,
};

const GITHUB_RELEASES_API_URL: &str = "https://api.github.com/repos/DeeJanuz/mcpviews/releases";
const GITHUB_RELEASE_HOST: &str = "github.com";
const GITHUB_OWNER: &str = "DeeJanuz";
const GITHUB_REPO: &str = "mcpviews";
const DEV_UPDATE_FLAG: &str = "MCPVIEWS_DEV_UPDATE";
const DEV_UPDATE_VERSION_ENV: &str = "MCPVIEWS_DEV_UPDATE_VERSION";
const DEV_UPDATE_MANIFEST_URL: &str = "mcpviews-dev://mock/latest.json";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub version: String,
    pub current_version: String,
    pub title: String,
    pub release_page_url: String,
    pub update_json_url: Option<String>,
    pub manual_download_url: Option<String>,
    pub manual_download_label: Option<String>,
    pub install_unavailable_reason: Option<String>,
    pub published_at: Option<String>,
    pub body: Option<String>,
    pub can_install: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallAppUpdateResult {
    pub relaunching: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    html_url: String,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
    body: Option<String>,
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct InstallAvailability {
    can_install: bool,
    unavailable_reason: Option<String>,
}

impl InstallAvailability {
    fn available() -> Self {
        Self {
            can_install: true,
            unavailable_reason: None,
        }
    }

    fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            can_install: false,
            unavailable_reason: Some(reason.into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ManualDownload {
    url: String,
    label: String,
}

pub async fn check_for_update(
    client: &reqwest::Client,
    current_version: &str,
) -> Result<Option<AppUpdateInfo>, String> {
    if dev_update_enabled() {
        return Ok(Some(dev_update_info(current_version)));
    }

    let releases = client
        .get(GITHUB_RELEASES_API_URL)
        .header(USER_AGENT, format!("MCPViews/{current_version}"))
        .header(ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|err| format!("Failed to check GitHub releases: {}", err.without_url()))?;

    if !releases.status().is_success() {
        return Err(format!(
            "GitHub releases check returned HTTP {}",
            releases.status()
        ));
    }

    let releases = releases
        .json::<Vec<GitHubRelease>>()
        .await
        .map_err(|err| format!("Failed to parse GitHub releases: {}", err.without_url()))?;

    Ok(select_update(releases, current_version))
}

pub async fn install_and_relaunch(
    app_handle: tauri::AppHandle,
    update_json_url: String,
) -> Result<InstallAppUpdateResult, String> {
    if update_json_url == DEV_UPDATE_MANIFEST_URL {
        if !dev_update_enabled() {
            return Err(
                "Development update manifests are only accepted when MCPVIEWS_DEV_UPDATE=1 is set in a debug build."
                    .to_string(),
            );
        }

        return Ok(InstallAppUpdateResult {
            relaunching: false,
            message: Some(
                "Development update install simulated; MCPViews was not relaunched.".to_string(),
            ),
        });
    }

    let endpoint = validate_update_manifest_url(&update_json_url)?;
    let pubkey = update_public_key()?;

    let updater = app_handle
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![endpoint])
        .map_err(|err| format!("Invalid update endpoint: {}", err))?
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|err| format!("Failed to initialize updater: {}", err))?;

    let update = updater
        .check()
        .await
        .map_err(|err| format!("Failed to verify update manifest: {}", err))?
        .ok_or_else(|| "No newer MCPViews update is available.".to_string())?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|err| format!("Failed to install update: {}", err))?;

    #[cfg(not(target_os = "windows"))]
    {
        app_handle.restart();
    }

    #[cfg(target_os = "windows")]
    {
        Ok(InstallAppUpdateResult {
            relaunching: true,
            message: None,
        })
    }
}

fn select_update(releases: Vec<GitHubRelease>, current_version: &str) -> Option<AppUpdateInfo> {
    select_update_with_install_availability(
        releases,
        current_version,
        current_install_availability(),
        current_manual_download_platform(),
    )
}

fn select_update_with_install_availability(
    releases: Vec<GitHubRelease>,
    current_version: &str,
    install_availability: InstallAvailability,
    platform: ManualDownloadPlatform,
) -> Option<AppUpdateInfo> {
    let current = parse_version(current_version)?;

    releases
        .into_iter()
        .filter(|release| !release.draft && !release.prerelease)
        .filter_map(|release| {
            update_info_from_release(
                release,
                &current,
                current_version,
                &install_availability,
                platform,
            )
        })
        .max_by(|left, right| {
            parse_version(&left.version)
                .cmp(&parse_version(&right.version))
                .then_with(|| left.published_at.cmp(&right.published_at))
        })
}

fn update_info_from_release(
    release: GitHubRelease,
    current: &Version,
    current_version: &str,
    install_availability: &InstallAvailability,
    platform: ManualDownloadPlatform,
) -> Option<AppUpdateInfo> {
    let version = parse_version(&release.tag_name)?;
    if version <= *current {
        return None;
    }

    let update_manifest_asset = current_update_manifest_asset();
    let update_json_url = release
        .assets
        .iter()
        .find(|asset| asset.name == update_manifest_asset)
        .map(|asset| asset.browser_download_url.clone())?;

    let manual_download = if install_availability.can_install {
        None
    } else {
        Some(manual_download_for_release(&release, platform))
    };

    Some(AppUpdateInfo {
        version: version.to_string(),
        current_version: current_version.to_string(),
        title: release
            .name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| release.tag_name.clone()),
        release_page_url: release.html_url,
        can_install: install_availability.can_install,
        update_json_url: Some(update_json_url),
        manual_download_url: manual_download
            .as_ref()
            .map(|download| download.url.clone()),
        manual_download_label: manual_download
            .as_ref()
            .map(|download| download.label.clone()),
        install_unavailable_reason: install_availability.unavailable_reason.clone(),
        published_at: release.published_at,
        body: release.body,
    })
}

fn parse_version(value: &str) -> Option<Version> {
    let normalized = value.trim().trim_start_matches('v');
    Version::parse(normalized).ok()
}

fn current_install_availability() -> InstallAvailability {
    match update_public_key() {
        Ok(_) => InstallAvailability::available(),
        Err(reason) => InstallAvailability::unavailable(reason),
    }
}

fn manual_download_for_release(
    release: &GitHubRelease,
    platform: ManualDownloadPlatform,
) -> ManualDownload {
    let flavor = release_flavor();
    let asset = match platform {
        ManualDownloadPlatform::MacOs => release
            .assets
            .iter()
            .find(|asset| matches_macos_download_asset(&asset.name, flavor))
            .map(|asset| ManualDownload {
                url: asset.browser_download_url.clone(),
                label: "Download macOS installer".to_string(),
            }),
        ManualDownloadPlatform::Windows => release
            .assets
            .iter()
            .find(|asset| matches_windows_setup_download_asset(&asset.name, flavor))
            .or_else(|| {
                release
                    .assets
                    .iter()
                    .find(|asset| matches_windows_msi_download_asset(&asset.name, flavor))
            })
            .map(|asset| ManualDownload {
                url: asset.browser_download_url.clone(),
                label: "Download Windows installer".to_string(),
            }),
        ManualDownloadPlatform::Other => None,
    };

    asset.unwrap_or_else(|| ManualDownload {
        url: release.html_url.clone(),
        label: "Open release page".to_string(),
    })
}

fn dev_update_enabled() -> bool {
    cfg!(debug_assertions) && env_truthy(DEV_UPDATE_FLAG)
}

fn env_truthy(key: &str) -> bool {
    std::env::var(key)
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn dev_update_info(current_version: &str) -> AppUpdateInfo {
    let version = std::env::var(DEV_UPDATE_VERSION_ENV)
        .ok()
        .filter(|version| parse_version(version).is_some())
        .unwrap_or_else(|| default_dev_update_version(current_version));

    AppUpdateInfo {
        version: parse_version(&version)
            .map(|version| version.to_string())
            .unwrap_or(version),
        current_version: current_version.to_string(),
        title: "MCPViews development update".to_string(),
        release_page_url: "https://github.com/DeeJanuz/mcpviews/releases".to_string(),
        update_json_url: Some(DEV_UPDATE_MANIFEST_URL.to_string()),
        manual_download_url: None,
        manual_download_label: None,
        install_unavailable_reason: None,
        published_at: None,
        body: Some("Development-only mock update generated by MCPVIEWS_DEV_UPDATE.".to_string()),
        can_install: true,
    }
}

fn default_dev_update_version(current_version: &str) -> String {
    if let Some(current) = parse_version(current_version) {
        return format!(
            "{}.{}.{}-rc.0",
            current.major,
            current.minor,
            current.patch.saturating_add(1)
        );
    }
    "999.0.0-rc.0".to_string()
}

fn update_public_key() -> Result<String, String> {
    if let Some(value) = option_env!("MCPVIEWS_UPDATER_PUBLIC_KEY") {
        let value = value.trim();
        if !value.is_empty() {
            return normalize_update_public_key(value);
        }
    }

    if let Ok(value) = std::env::var("MCPVIEWS_UPDATER_PUBLIC_KEY") {
        let value = value.trim();
        if !value.is_empty() {
            return normalize_update_public_key(value);
        }
    }

    Err("MCPViews updater public key is not configured. Set MCPVIEWS_UPDATER_PUBLIC_KEY at build time for signed update installs.".to_string())
}

fn normalize_update_public_key(value: &str) -> Result<String, String> {
    let value = value.trim();
    if is_raw_tauri_public_key_text(value) {
        return Ok(base64::engine::general_purpose::STANDARD.encode(value.as_bytes()));
    }

    let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(value) else {
        return Err(
            "MCPViews updater public key must be the encoded Tauri .pub file contents.".to_string(),
        );
    };
    let Ok(decoded) = std::str::from_utf8(&decoded) else {
        return Err(
            "MCPViews updater public key must decode to the Tauri public key text.".to_string(),
        );
    };
    if !is_raw_tauri_public_key_text(decoded.trim()) {
        return Err("MCPViews updater public key must decode to a Tauri public key text with the minisign comment and RW key line.".to_string());
    }

    Ok(value.to_string())
}

fn is_raw_tauri_public_key_text(value: &str) -> bool {
    let mut lines = value.trim().lines();
    let comment = lines.next().unwrap_or_default();
    let key = lines.next().unwrap_or_default();
    lines.next().is_none()
        && comment.starts_with("untrusted comment: minisign public key: ")
        && comment
            .strip_prefix("untrusted comment: minisign public key: ")
            .map(|key_id| !key_id.is_empty() && key_id.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .unwrap_or(false)
        && key.starts_with("RW")
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
}

fn validate_update_manifest_url(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value).map_err(|err| format!("Invalid update URL: {}", err))?;
    if url.scheme() != "https" {
        return Err("Update manifests must be served over HTTPS.".to_string());
    }
    if url.host_str() != Some(GITHUB_RELEASE_HOST) {
        return Err(
            "Update manifests must come from the MCPViews GitHub releases page.".to_string(),
        );
    }

    let segments = url
        .path_segments()
        .map(|segments| segments.collect::<Vec<_>>())
        .unwrap_or_default();

    if segments.len() < 6
        || segments[0] != GITHUB_OWNER
        || segments[1] != GITHUB_REPO
        || segments[2] != "releases"
        || segments[3] != "download"
        || segments.last().copied() != Some(current_update_manifest_asset())
    {
        return Err(
            "Update manifests must be the expected flavor-specific latest asset from an MCPViews GitHub release."
                .to_string(),
        );
    }

    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag_name: &str, prerelease: bool, assets: Vec<&str>) -> GitHubRelease {
        GitHubRelease {
            tag_name: tag_name.to_string(),
            name: Some(format!("MCPViews {tag_name}")),
            html_url: format!("https://github.com/DeeJanuz/mcpviews/releases/tag/{tag_name}"),
            draft: false,
            prerelease,
            published_at: Some("2026-05-21T12:00:00Z".to_string()),
            body: Some("Release notes".to_string()),
            assets: assets
                .into_iter()
                .map(|name| GitHubReleaseAsset {
                    name: name.to_string(),
                    browser_download_url: format!(
                        "https://github.com/DeeJanuz/mcpviews/releases/download/{tag_name}/{name}"
                    ),
                })
                .collect(),
        }
    }

    #[test]
    fn selects_newer_release_that_is_not_a_github_prerelease() {
        let selected = select_update(
            vec![
                release("v0.2.5-rc.12", false, vec!["latest.json"]),
                release("v0.2.5", false, vec!["latest.json"]),
                release("v0.2.7-rc.1", true, vec!["latest.json"]),
                release("v0.2.5-rc.10", false, vec!["latest.json"]),
            ],
            "0.2.5-rc.17",
        )
        .expect("expected an update");

        assert_eq!(selected.version, "0.2.5");
        assert_eq!(
            selected.update_json_url.as_deref(),
            Some("https://github.com/DeeJanuz/mcpviews/releases/download/v0.2.5/latest.json")
        );
    }

    #[test]
    fn includes_macos_manual_download_when_install_key_is_missing() {
        let selected = select_update_with_install_availability(
            vec![release(
                "v0.2.7",
                false,
                vec![
                    "latest.json",
                    "DecidR-MCPViews-macOS.dmg",
                    "MCPViews.app.tar.gz",
                    "MCPViews_0.2.7_aarch64.dmg",
                ],
            )],
            "0.2.6",
            InstallAvailability::unavailable("missing updater key"),
            ManualDownloadPlatform::MacOs,
        )
        .expect("expected an update");

        assert!(!selected.can_install);
        assert_eq!(
            selected.manual_download_url.as_deref(),
            Some("https://github.com/DeeJanuz/mcpviews/releases/download/v0.2.7/MCPViews_0.2.7_aarch64.dmg")
        );
        assert_eq!(
            selected.manual_download_label.as_deref(),
            Some("Download macOS installer")
        );
        assert_eq!(
            selected.install_unavailable_reason.as_deref(),
            Some("missing updater key")
        );
    }

    #[test]
    fn generic_manual_download_ignores_branded_aliases() {
        let selected = select_update_with_install_availability(
            vec![release(
                "v0.2.7",
                false,
                vec![
                    "latest.json",
                    "DecidR-MCPViews-macOS.dmg",
                    "DecidR-MCPViews-Windows-setup.exe",
                    "MCPViews_0.2.7_x64-setup.exe",
                    "MCPViews_0.2.7_aarch64.dmg",
                ],
            )],
            "0.2.6",
            InstallAvailability::unavailable("missing updater key"),
            ManualDownloadPlatform::MacOs,
        )
        .expect("expected an update");

        assert_eq!(
            selected.manual_download_url.as_deref(),
            Some("https://github.com/DeeJanuz/mcpviews/releases/download/v0.2.7/MCPViews_0.2.7_aarch64.dmg")
        );
    }

    #[test]
    fn recognizes_flavor_specific_download_assets() {
        assert!(matches_macos_download_asset(
            "MCPViews_0.2.7_aarch64.dmg",
            ReleaseFlavor::Generic
        ));
        assert!(!matches_macos_download_asset(
            "DecidR-MCPViews-macOS.dmg",
            ReleaseFlavor::Generic
        ));
        assert!(matches_macos_download_asset(
            "DecidR-MCPViews-macOS.dmg",
            ReleaseFlavor::Decidr
        ));
        assert!(matches_windows_setup_download_asset(
            "MCPViews_0.2.7_x64-setup.exe",
            ReleaseFlavor::Generic
        ));
        assert!(!matches_windows_setup_download_asset(
            "DecidR-MCPViews-Windows-setup.exe",
            ReleaseFlavor::Generic
        ));
        assert!(matches_windows_setup_download_asset(
            "DecidR-MCPViews-Windows-setup.exe",
            ReleaseFlavor::Decidr
        ));
    }

    #[test]
    fn prefers_windows_exe_manual_download_over_msi() {
        let selected = select_update_with_install_availability(
            vec![release(
                "v0.2.7",
                false,
                vec![
                    "latest.json",
                    "MCPViews_0.2.7_x64_en-US.msi",
                    "MCPViews_0.2.7_x64-setup.exe",
                ],
            )],
            "0.2.6",
            InstallAvailability::unavailable("missing updater key"),
            ManualDownloadPlatform::Windows,
        )
        .expect("expected an update");

        assert_eq!(
            selected.manual_download_url.as_deref(),
            Some("https://github.com/DeeJanuz/mcpviews/releases/download/v0.2.7/MCPViews_0.2.7_x64-setup.exe")
        );
        assert_eq!(
            selected.manual_download_label.as_deref(),
            Some("Download Windows installer")
        );
    }

    #[test]
    fn falls_back_to_release_page_when_platform_installer_is_missing() {
        let selected = select_update_with_install_availability(
            vec![release("v0.2.7", false, vec!["latest.json"])],
            "0.2.6",
            InstallAvailability::unavailable("missing updater key"),
            ManualDownloadPlatform::Other,
        )
        .expect("expected an update");

        assert_eq!(
            selected.manual_download_url.as_deref(),
            Some("https://github.com/DeeJanuz/mcpviews/releases/tag/v0.2.7")
        );
        assert_eq!(
            selected.manual_download_label.as_deref(),
            Some("Open release page")
        );
    }

    #[test]
    fn installable_updates_do_not_include_manual_fallback_fields() {
        let selected = select_update_with_install_availability(
            vec![release(
                "v0.2.7",
                false,
                vec!["latest.json", "MCPViews_0.2.7_aarch64.dmg"],
            )],
            "0.2.6",
            InstallAvailability::available(),
            ManualDownloadPlatform::MacOs,
        )
        .expect("expected an update");

        assert!(selected.can_install);
        assert!(selected.manual_download_url.is_none());
        assert!(selected.manual_download_label.is_none());
        assert!(selected.install_unavailable_reason.is_none());
    }

    #[test]
    fn ignores_invalid_semver_and_github_prereleases() {
        let selected = select_update(
            vec![
                release("v0.2.6", true, vec!["latest.json"]),
                release("not-a-version", false, vec!["latest.json"]),
            ],
            "0.2.5-rc.11",
        );

        assert!(selected.is_none());
    }

    #[test]
    fn ignores_release_candidates_without_tauri_update_manifest() {
        let selected = select_update(
            vec![release("v0.2.5-rc.12", false, vec!["MCPViews.dmg"])],
            "0.2.5-rc.11",
        );

        assert!(selected.is_none());
    }

    #[test]
    fn default_dev_update_version_bumps_patch_as_release_candidate() {
        assert_eq!(default_dev_update_version("0.2.5-rc.11"), "0.2.6-rc.0");
        assert_eq!(default_dev_update_version("0.2.5"), "0.2.6-rc.0");
        assert_eq!(default_dev_update_version("not-semver"), "999.0.0-rc.0");
    }

    #[test]
    fn dev_update_info_uses_private_mock_manifest() {
        let info = dev_update_info("0.2.5-rc.11");

        assert_eq!(info.version, "0.2.6-rc.0");
        assert_eq!(
            info.update_json_url.as_deref(),
            Some(DEV_UPDATE_MANIFEST_URL)
        );
        assert!(info.can_install);
    }

    #[test]
    fn encodes_updater_public_key_text_for_tauri() {
        let raw_key = "untrusted comment: minisign public key: 4FF87EF154A8A8BE\nRWS+qKhU8X74T7zeyW06trBF2HhrY0R/xG7qyyfQfQ/a/3sDH2bzs/oy";

        assert_eq!(
            normalize_update_public_key(raw_key).expect("expected key to normalize"),
            "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDRGRjg3RUYxNTRBOEE4QkUKUldTK3FLaFU4WDc0VDd6ZXlXMDZ0ckJGMkhoclkwUi94RzdxeXlmUWZRL2EvM3NESDJienMvb3k="
        );
    }

    #[test]
    fn accepts_encoded_updater_public_key() {
        let encoded_key =
            "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDRGRjg3RUYxNTRBOEE4QkUKUldTK3FLaFU4WDc0VDd6ZXlXMDZ0ckJGMkhoclkwUi94RzdxeXlmUWZRL2EvM3NESDJienMvb3k=";

        assert_eq!(
            normalize_update_public_key(encoded_key).expect("expected key to normalize"),
            encoded_key
        );
    }

    #[test]
    fn rejects_invalid_updater_public_key() {
        assert!(normalize_update_public_key("not-a-tauri-key").is_err());
        assert!(normalize_update_public_key(
            "RWS+qKhU8X74T7zeyW06trBF2HhrY0R/xG7qyyfQfQ/a/3sDH2bzs/oy"
        )
        .is_err());
    }

    #[test]
    fn rejects_update_manifest_urls_outside_github_releases() {
        assert!(validate_update_manifest_url(
            "https://example.com/DeeJanuz/mcpviews/releases/download/v0.2.5-rc.12/latest.json"
        )
        .is_err());
        assert!(validate_update_manifest_url(
            "https://github.com/DeeJanuz/mcpviews/releases/download/v0.2.5-rc.12/latest.json"
        )
        .is_ok());
    }
}
