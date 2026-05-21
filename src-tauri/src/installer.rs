#[cfg(target_os = "windows")]
use tauri::Manager;

#[cfg(target_os = "windows")]
const LEGACY_WINDOWS_SETUP_SCRIPT: &str = "scripts/setup-integrations.ps1";

/// Remove the deprecated Windows setup script if it was left behind by an older install.
///
/// New Windows builds no longer bundle or execute the PowerShell setup flow, but upgrades may
/// leave old resource files in place depending on installer behavior.
pub fn cleanup_legacy_windows_setup_script(app: &tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    {
        match app.path().resolve(
            LEGACY_WINDOWS_SETUP_SCRIPT,
            tauri::path::BaseDirectory::Resource,
        ) {
            Ok(path) if path.exists() => {
                if let Err(error) = std::fs::remove_file(&path) {
                    eprintln!(
                        "[mcpviews] Failed to remove legacy Windows setup script {}: {}",
                        path.display(),
                        error
                    );
                }
            }
            Ok(_) => {}
            Err(error) => {
                eprintln!(
                    "[mcpviews] Failed to resolve legacy Windows setup script path: {}",
                    error
                );
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
    }
}
