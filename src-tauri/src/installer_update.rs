pub(crate) const GENERIC_UPDATE_MANIFEST_ASSET: &str = "latest.json";
pub(crate) const DECIDR_UPDATE_MANIFEST_ASSET: &str = "decidr-latest.json";

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ManualDownloadPlatform {
    MacOs,
    Windows,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReleaseFlavor {
    Generic,
    Decidr,
}

pub(crate) fn release_flavor() -> ReleaseFlavor {
    match option_env!("MCPVIEWS_RELEASE_FLAVOR")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "decidr" => ReleaseFlavor::Decidr,
        _ => ReleaseFlavor::Generic,
    }
}

pub(crate) fn current_update_manifest_asset() -> &'static str {
    update_manifest_asset(release_flavor())
}

pub(crate) fn update_manifest_asset(flavor: ReleaseFlavor) -> &'static str {
    match flavor {
        ReleaseFlavor::Generic => GENERIC_UPDATE_MANIFEST_ASSET,
        ReleaseFlavor::Decidr => DECIDR_UPDATE_MANIFEST_ASSET,
    }
}

pub(crate) fn current_manual_download_platform() -> ManualDownloadPlatform {
    #[cfg(target_os = "macos")]
    {
        return ManualDownloadPlatform::MacOs;
    }

    #[cfg(target_os = "windows")]
    {
        return ManualDownloadPlatform::Windows;
    }

    #[allow(unreachable_code)]
    ManualDownloadPlatform::Other
}

pub(crate) fn matches_macos_download_asset(name: &str, flavor: ReleaseFlavor) -> bool {
    match flavor {
        ReleaseFlavor::Generic => name.starts_with("MCPViews_") && name.ends_with("_aarch64.dmg"),
        ReleaseFlavor::Decidr => name == "DecidR-MCPViews-macOS.dmg",
    }
}

pub(crate) fn matches_windows_setup_download_asset(name: &str, flavor: ReleaseFlavor) -> bool {
    match flavor {
        ReleaseFlavor::Generic => name.starts_with("MCPViews_") && name.ends_with("_x64-setup.exe"),
        ReleaseFlavor::Decidr => name == "DecidR-MCPViews-Windows-setup.exe",
    }
}

pub(crate) fn matches_windows_msi_download_asset(name: &str, flavor: ReleaseFlavor) -> bool {
    match flavor {
        ReleaseFlavor::Generic => name.starts_with("MCPViews_") && name.ends_with("_x64_en-US.msi"),
        ReleaseFlavor::Decidr => name == "DecidR-MCPViews-Windows.msi",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_asset_matches_release_flavor() {
        assert_eq!(update_manifest_asset(ReleaseFlavor::Generic), "latest.json");
        assert_eq!(
            update_manifest_asset(ReleaseFlavor::Decidr),
            "decidr-latest.json"
        );
    }

    #[test]
    fn windows_setup_asset_patterns_are_flavor_specific() {
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
    fn windows_msi_asset_patterns_are_flavor_specific() {
        assert!(matches_windows_msi_download_asset(
            "MCPViews_0.2.7_x64_en-US.msi",
            ReleaseFlavor::Generic
        ));
        assert!(!matches_windows_msi_download_asset(
            "DecidR-MCPViews-Windows.msi",
            ReleaseFlavor::Generic
        ));
        assert!(matches_windows_msi_download_asset(
            "DecidR-MCPViews-Windows.msi",
            ReleaseFlavor::Decidr
        ));
    }
}
