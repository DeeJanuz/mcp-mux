use std::path::{Path, PathBuf};

#[cfg(not(target_os = "windows"))]
use std::process::Command;
use tauri::Manager;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadedFile {
    filename: String,
    path: String,
    revealed: bool,
    reveal_error: Option<String>,
}

pub(crate) fn download_handler(
    surface_label: &'static str,
    app_handle: tauri::AppHandle,
) -> impl Fn(tauri::Webview, tauri::webview::DownloadEvent<'_>) -> bool + Send + Sync + 'static {
    move |_webview, event| match event {
        tauri::webview::DownloadEvent::Requested { url, destination } => {
            match prepare_download_destination(&app_handle, &url, destination) {
                Ok(path) => {
                    *destination = path;
                }
                Err(error) => {
                    eprintln!(
                        "[mcpviews] Failed to prepare download destination for {surface_label}: {error}"
                    );
                }
            }
            true
        }
        tauri::webview::DownloadEvent::Finished { url, path, success } => {
            if success {
                if let Some(path) = path {
                    if let Err(error) = reveal_downloaded_file_path(&path) {
                        eprintln!(
                            "[mcpviews] Failed to reveal downloaded file for {surface_label} ({url}): {error}"
                        );
                    }
                } else {
                    eprintln!(
                        "[mcpviews] Download finished for {surface_label} without a saved path: {url}"
                    );
                }
            } else {
                eprintln!("[mcpviews] Download failed for {surface_label}: {url}");
            }
            true
        }
        _ => true,
    }
}

pub(crate) fn save_base64_download(
    app_handle: tauri::AppHandle,
    filename: String,
    mime_type: Option<String>,
    data_base64: String,
) -> Result<DownloadedFile, String> {
    use base64::Engine;

    let _ = mime_type;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("Failed to decode download bytes: {}", e))?;

    save_download_bytes(&app_handle, &filename, &bytes)
}

fn save_download_bytes(
    app_handle: &tauri::AppHandle,
    filename: &str,
    bytes: &[u8],
) -> Result<DownloadedFile, String> {
    let download_dir = downloads_dir(app_handle)?;
    let path = download_path_for_dir(&download_dir, filename)?;
    let expected_len = bytes.len() as u64;
    std::fs::write(&path, bytes).map_err(|e| format!("Failed to write downloaded file: {}", e))?;
    downloaded_file_result(path, expected_len)
}

fn downloads_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let download_dir = app_handle
        .path()
        .download_dir()
        .map_err(|e| format!("Failed to resolve Downloads directory: {}", e))?;
    std::fs::create_dir_all(&download_dir)
        .map_err(|e| format!("Failed to create Downloads directory: {}", e))?;
    download_dir
        .canonicalize()
        .map_err(|e| format!("Failed to verify Downloads directory: {}", e))
}

fn prepare_download_destination(
    app_handle: &tauri::AppHandle,
    url: &url::Url,
    suggested_destination: &Path,
) -> Result<PathBuf, String> {
    let download_dir = downloads_dir(app_handle)?;
    download_destination_for_request(&download_dir, url, suggested_destination)
}

fn download_destination_for_request(
    download_dir: &Path,
    url: &url::Url,
    suggested_destination: &Path,
) -> Result<PathBuf, String> {
    let filename = filename_for_download_request(url, suggested_destination);
    download_path_for_dir(download_dir, &filename)
}

fn filename_for_download_request(url: &url::Url, suggested_destination: &Path) -> String {
    if let Some(filename) = suggested_destination
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return filename.to_string();
    }

    url.path_segments()
        .and_then(|segments| {
            segments
                .rev()
                .find(|segment| !segment.trim().is_empty())
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| "download".to_string())
}

fn verify_saved_download(path: &Path, expected_len: u64) -> Result<PathBuf, String> {
    let saved_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let metadata = std::fs::metadata(&saved_path)
        .map_err(|e| format!("Failed to verify downloaded file: {}", e))?;
    if !metadata.is_file() {
        return Err("Downloaded path is not a file.".to_string());
    }
    if metadata.len() != expected_len {
        return Err(format!(
            "Downloaded file size mismatch: wrote {} bytes but found {} bytes.",
            expected_len,
            metadata.len()
        ));
    }
    Ok(saved_path)
}

fn downloaded_file_result(path: PathBuf, expected_len: u64) -> Result<DownloadedFile, String> {
    let saved_path = verify_saved_download(&path, expected_len)?;
    let reveal_result = reveal_downloaded_file_path(&saved_path);
    let saved_filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("download")
        .to_string();

    Ok(DownloadedFile {
        filename: saved_filename,
        path: saved_path.to_string_lossy().to_string(),
        revealed: reveal_result.is_ok(),
        reveal_error: reveal_result.err(),
    })
}

fn is_windows_reserved_download_stem(stem: &str) -> bool {
    let normalized = stem
        .trim_matches(|ch| matches!(ch, ' ' | '.'))
        .to_ascii_uppercase();
    matches!(
        normalized.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn sanitized_download_filename(filename: &str) -> String {
    let normalized = filename.replace('\\', "/");
    let basename = normalized.rsplit('/').next().unwrap_or("").trim();
    let mut clean = String::new();
    for ch in basename.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '-' | '_' | '.' | '(' | ')') {
            clean.push(ch);
        } else {
            clean.push('_');
        }
    }
    let clean = clean.trim_matches(|ch| matches!(ch, ' ' | '.'));
    let mut clean = if clean.is_empty() {
        "download".to_string()
    } else {
        clean.to_string()
    };

    let (stem, extension) = split_download_filename(&clean);
    if is_windows_reserved_download_stem(&stem) {
        clean = match extension {
            Some(ext) => format!("download-{}.{}", stem, ext),
            None => format!("download-{}", stem),
        };
    }

    if clean.chars().count() > 160 {
        let (stem, extension) = split_download_filename(&clean);
        let limited_stem: String = stem.chars().take(120).collect();
        clean = match extension {
            Some(ext) => format!("{}.{}", limited_stem, ext),
            None => limited_stem,
        };
    }

    clean
}

fn split_download_filename(filename: &str) -> (String, Option<String>) {
    if let Some((stem, extension)) = filename.rsplit_once('.') {
        if !stem.is_empty() && !extension.is_empty() {
            return (stem.to_string(), Some(extension.to_string()));
        }
    }
    (filename.to_string(), None)
}

fn download_path_for_dir(download_dir: &Path, filename: &str) -> Result<PathBuf, String> {
    let safe_filename = sanitized_download_filename(filename);
    let (stem, extension) = split_download_filename(&safe_filename);
    for index in 0..1000 {
        let candidate = if index == 0 {
            safe_filename.clone()
        } else {
            match extension.as_deref() {
                Some(ext) => format!("{} ({}).{}", stem, index, ext),
                None => format!("{} ({})", stem, index),
            }
        };
        let path = download_dir.join(candidate);
        if !path.starts_with(download_dir) {
            return Err("Download path escaped the Downloads directory.".to_string());
        }
        if !path.exists() {
            return Ok(path);
        }
    }
    Err("Could not allocate a unique download filename.".to_string())
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
fn reveal_download_command_for_platform(
    path: &Path,
    platform: crate::auth_browser::BrowserPlatform,
) -> Result<crate::auth_browser::BrowserCommand, String> {
    let path_arg = path
        .to_str()
        .ok_or_else(|| "Download path is not valid UTF-8.".to_string())?
        .to_string();
    match platform {
        crate::auth_browser::BrowserPlatform::Linux => {
            let parent = path
                .parent()
                .ok_or_else(|| "Download path is missing a parent directory.".to_string())?;
            let parent_arg = parent
                .to_str()
                .ok_or_else(|| "Download directory path is not valid UTF-8.".to_string())?
                .to_string();
            Ok(crate::auth_browser::BrowserCommand {
                program: "xdg-open",
                args: vec![parent_arg],
            })
        }
        crate::auth_browser::BrowserPlatform::MacOs => Ok(crate::auth_browser::BrowserCommand {
            program: "open",
            args: vec!["-R".to_string(), path_arg],
        }),
        crate::auth_browser::BrowserPlatform::Windows => {
            let parent = path
                .parent()
                .ok_or_else(|| "Download path is missing a parent directory.".to_string())?;
            let parent_arg = parent
                .to_str()
                .ok_or_else(|| "Download directory path is not valid UTF-8.".to_string())?
                .to_string();
            Ok(crate::auth_browser::BrowserCommand {
                program: "explorer.exe",
                args: vec![parent_arg],
            })
        }
        crate::auth_browser::BrowserPlatform::Unsupported => {
            Err("Unsupported platform".to_string())
        }
    }
}

#[cfg(target_os = "windows")]
struct ComApartment {
    uninitialize: bool,
}

#[cfg(target_os = "windows")]
impl ComApartment {
    fn initialize() -> Result<Self, String> {
        use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};

        let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if result.is_ok() {
            Ok(Self { uninitialize: true })
        } else if result == RPC_E_CHANGED_MODE {
            Ok(Self {
                uninitialize: false,
            })
        } else {
            Err(format!(
                "Failed to initialize COM for file reveal: {result:?}"
            ))
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.uninitialize {
            unsafe {
                windows::Win32::System::Com::CoUninitialize();
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn wide_null_from_path(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(target_os = "windows")]
fn reveal_downloaded_file_path_windows(path: &Path) -> Result<(), String> {
    let path = path.to_path_buf();
    std::thread::spawn(move || reveal_downloaded_file_path_windows_sta(&path))
        .join()
        .map_err(|_| "Windows file reveal thread panicked.".to_string())?
}

#[cfg(target_os = "windows")]
fn reveal_downloaded_file_path_windows_sta(path: &Path) -> Result<(), String> {
    use std::ptr::null_mut;
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::{CoTaskMemFree, IBindCtx};
    use windows::Win32::UI::Shell::{SHOpenFolderAndSelectItems, SHParseDisplayName};

    let _com = ComApartment::initialize()?;
    let path_wide = wide_null_from_path(path);
    let mut item_id = null_mut();

    unsafe {
        SHParseDisplayName(
            PCWSTR(path_wide.as_ptr()),
            None::<&IBindCtx>,
            &mut item_id,
            0,
            None,
        )
        .map_err(|e| format!("Failed to resolve downloaded file for Explorer selection: {e}"))?;

        let select_result = SHOpenFolderAndSelectItems(item_id, None, 0)
            .map_err(|e| format!("Failed to select downloaded file in Explorer: {e}"));
        CoTaskMemFree(Some(item_id.cast()));
        select_result
    }
}

#[cfg(target_os = "windows")]
fn open_download_parent_windows(path: &Path) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let parent = path
        .parent()
        .ok_or_else(|| "Download path is missing a parent directory.".to_string())?;
    let parent_wide = wide_null_from_path(parent);
    let open_wide: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(open_wide.as_ptr()),
            PCWSTR(parent_wide.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };

    if result.0 as isize <= 32 {
        Err(format!(
            "Failed to open Downloads directory in Explorer: ShellExecuteW returned {}",
            result.0 as isize
        ))
    } else {
        Ok(())
    }
}

fn reveal_downloaded_file_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return reveal_downloaded_file_path_windows(path).or_else(|select_error| {
            open_download_parent_windows(path).map_err(|fallback_error| {
                format!("{select_error}; fallback open directory failed: {fallback_error}")
            })
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let command =
            reveal_download_command_for_platform(path, crate::auth_browser::current_platform())?;
        Command::new(command.program)
            .args(command.args)
            .spawn()
            .map_err(|e| format!("Failed to reveal downloaded file: {}", e))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_download_sanitizes_filename_path_traversal() {
        let filename = sanitized_download_filename("../../secret/../report?.txt");

        assert_eq!(filename, "report_.txt");
        assert!(!filename.contains('/'));
        assert!(!filename.contains('\\'));
        assert!(!filename.contains(".."));
    }

    #[test]
    fn file_download_avoids_windows_reserved_names() {
        assert_eq!(sanitized_download_filename("CON.txt"), "download-CON.txt");
        assert_eq!(sanitized_download_filename("nul"), "download-nul");
    }

    #[test]
    fn file_download_unique_path_adds_suffix() {
        let dir = tempfile::tempdir().unwrap();
        let existing = dir.path().join("report.txt");
        std::fs::write(&existing, b"old").unwrap();
        let path =
            download_path_for_dir(dir.path(), "report.txt").expect("expected unique download path");

        assert_eq!(
            path.file_name().unwrap().to_string_lossy(),
            "report (1).txt"
        );
        assert!(path.starts_with(dir.path()));
    }

    #[test]
    fn file_download_request_uses_suggested_filename() {
        let dir = tempfile::tempdir().unwrap();
        let url = url::Url::parse("https://app.ludflow.com/api/documents/export").unwrap();
        let suggested = Path::new("/tmp/Ludflow Report.pdf");

        let path = download_destination_for_request(dir.path(), &url, suggested)
            .expect("expected download destination");

        assert_eq!(
            path.file_name().unwrap().to_string_lossy(),
            "Ludflow Report.pdf"
        );
    }

    #[test]
    fn file_download_request_falls_back_to_url_filename() {
        let dir = tempfile::tempdir().unwrap();
        let url = url::Url::parse("https://app.ludflow.com/files/report.csv").unwrap();

        let path = download_destination_for_request(dir.path(), &url, Path::new(""))
            .expect("expected download destination");

        assert_eq!(path.file_name().unwrap().to_string_lossy(), "report.csv");
    }

    #[test]
    fn file_download_windows_fallback_opens_parent_directory() {
        let path = Path::new("C:/Users/Test User/Downloads/report.txt");
        let command = reveal_download_command_for_platform(
            path,
            crate::auth_browser::BrowserPlatform::Windows,
        )
        .expect("expected Windows fallback command");

        assert_eq!(command.program, "explorer.exe");
        assert_eq!(
            command.args,
            vec!["C:/Users/Test User/Downloads".to_string()]
        );
    }

    #[test]
    fn file_download_macos_reveal_selects_file() {
        let path = Path::new("/Users/test/Downloads/report.txt");
        let command =
            reveal_download_command_for_platform(path, crate::auth_browser::BrowserPlatform::MacOs)
                .expect("expected macOS reveal command");

        assert_eq!(command.program, "open");
        assert_eq!(
            command.args,
            vec![
                "-R".to_string(),
                "/Users/test/Downloads/report.txt".to_string()
            ]
        );
    }

    #[test]
    fn file_download_linux_reveal_opens_parent_directory() {
        let path = Path::new("/home/test/Downloads/report.txt");
        let command =
            reveal_download_command_for_platform(path, crate::auth_browser::BrowserPlatform::Linux)
                .expect("expected Linux reveal command");

        assert_eq!(command.program, "xdg-open");
        assert_eq!(command.args, vec!["/home/test/Downloads".to_string()]);
    }
}
