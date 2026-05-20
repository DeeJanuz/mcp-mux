use std::path::{Path, PathBuf};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::process::Command;
use tauri::Manager;

#[cfg(not(target_os = "windows"))]
const SETUP_SCRIPT: &str = "scripts/setup-integrations.sh";

#[cfg(target_os = "windows")]
const LEGACY_WINDOWS_SETUP_SCRIPT: &str = "scripts/setup-integrations.ps1";

/// Check if first-run setup has been completed.
/// Returns true if ~/.mcpviews/.setup-complete exists.
pub fn check_first_run() -> bool {
    dirs::home_dir()
        .map(|home| home.join(".mcpviews").join(".setup-complete").exists())
        .unwrap_or(false)
}

/// Remove the deprecated Windows setup script if it was left behind by an older install.
///
/// New Windows builds no longer bundle or execute the PowerShell setup flow, but upgrades may
/// leave old resource files in place depending on installer behavior.
pub fn cleanup_legacy_windows_setup_script(app: &tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    {
        match app
            .path()
            .resolve(LEGACY_WINDOWS_SETUP_SCRIPT, tauri::path::BaseDirectory::Resource)
        {
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

/// Resolve the bundled legacy shell setup path from Tauri resources.
/// Windows builds intentionally have no bundled setup script.
pub fn get_script_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        app.path()
            .resolve(SETUP_SCRIPT, tauri::path::BaseDirectory::Resource)
            .ok()
            .filter(|p: &PathBuf| p.exists())
    }
}

/// Open a terminal window running the installer script.
/// Uses std::process::Command to spawn a visible terminal window.
pub fn open_installer_terminal(script_path: &Path) -> Result<(), String> {
    let script = script_path
        .to_str()
        .ok_or_else(|| "Invalid script path encoding".to_string())?;

    #[cfg(target_os = "linux")]
    {
        let terminals: &[(&str, &[&str])] = &[
            ("x-terminal-emulator", &["-e"]),
            ("gnome-terminal", &["--"]),
            ("konsole", &["-e"]),
            ("xfce4-terminal", &["-e"]),
            ("xterm", &["-e"]),
        ];

        for (terminal, args) in terminals {
            if which_exists(terminal) {
                let mut cmd_args: Vec<&str> = args.to_vec();
                cmd_args.push(script);

                return Command::new(terminal)
                    .args(&cmd_args)
                    .spawn()
                    .map(|_| ())
                    .map_err(|e| format!("Failed to spawn {}: {}", terminal, e));
            }
        }

        Err("No supported terminal emulator found".to_string())
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal", script])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open Terminal.app: {}", e))
    }

    #[cfg(target_os = "windows")]
    {
        let _ = script;
        Err(concat!(
            "The legacy Windows PowerShell integration setup has been removed. ",
            "Use docs/install-prompt.md to configure agent integrations."
        )
        .to_string())
    }
}

#[cfg(target_os = "linux")]
fn which_exists(name: &str) -> bool {
    Command::new("which")
        .arg(name)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
