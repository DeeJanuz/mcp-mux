fn main() {
    for key in [
        "MCPVIEWS_BUNDLE_AI_PROVIDER_BASE_URL",
        "MCPVIEWS_BUNDLE_AI_PROVIDER_RELAY_BASE_URL",
        "MCPVIEWS_BUNDLE_AI_PROVIDER_DEVICE_BASE_URL",
        "MCPVIEWS_BUNDLE_AI_PROVIDER_AUTH_URL",
        "MCPVIEWS_BUNDLE_AI_PROVIDER_TOKEN_URL",
        "MCPVIEWS_BUNDLE_AI_PROVIDER_CLIENT_ID",
        "MCPVIEWS_UPDATER_PUBLIC_KEY",
        "MCPVIEWS_RELEASE_FLAVOR",
        "MCPVIEWS_BUILD_LANE",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
        if let Ok(value) = std::env::var(key) {
            println!("cargo:rustc-env={key}={value}");
        }
    }

    tauri_build::build()
}
