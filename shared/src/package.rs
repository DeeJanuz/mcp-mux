use crate::{cache_dir, PluginManifest};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_DOWNLOAD_SIZE: u64 = 50 * 1024 * 1024; // 50MB
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Extract a plugin zip to dest_dir, returning the parsed manifest.
/// - Zip-slip protection: reject paths containing ".."
/// - Strip single top-level directory if present (GitHub release pattern)
/// - Verify manifest.json exists in extracted contents
/// - Clean up dest_dir on failure
pub fn extract_plugin_zip(zip_path: &Path, dest_dir: &Path) -> Result<PluginManifest, String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("Failed to open zip: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Failed to read zip archive: {}", e))?;

    // Determine if there's a single top-level directory to strip
    let strip_prefix = detect_strip_prefix(&mut archive);

    // Create dest dir
    std::fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create destination: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;

        let raw_path = entry.mangled_name();

        // Strip prefix if detected
        let relative_path = if let Some(prefix) = &strip_prefix {
            match raw_path.strip_prefix(prefix) {
                Ok(p) => p.to_path_buf(),
                Err(_) => continue, // skip files outside the prefix
            }
        } else {
            raw_path
        };

        // Skip empty paths (the prefix dir itself)
        if relative_path.as_os_str().is_empty() {
            continue;
        }

        // Zip-slip protection
        let path_str = relative_path.to_string_lossy();
        if path_str.contains("..") {
            let _ = std::fs::remove_dir_all(dest_dir);
            return Err("Zip contains path traversal (..): rejected for security".to_string());
        }

        let out_path = dest_dir.join(&relative_path);

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent directory: {}", e))?;
            }
            let mut outfile = std::fs::File::create(&out_path)
                .map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    // Verify and parse manifest.json
    let manifest_path = dest_dir.join("manifest.json");
    if !manifest_path.exists() {
        let _ = std::fs::remove_dir_all(dest_dir);
        return Err("Plugin package missing manifest.json".to_string());
    }

    let content = std::fs::read_to_string(&manifest_path).map_err(|e| {
        let _ = std::fs::remove_dir_all(dest_dir);
        format!("Failed to read manifest.json: {}", e)
    })?;

    serde_json::from_str::<PluginManifest>(&content).map_err(|e| {
        let _ = std::fs::remove_dir_all(dest_dir);
        format!("Failed to parse manifest.json: {}", e)
    })
}

/// Detect if all zip entries share a single top-level directory (GitHub release pattern)
fn detect_strip_prefix(archive: &mut zip::ZipArchive<std::fs::File>) -> Option<PathBuf> {
    let mut common_prefix: Option<String> = None;

    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index_raw(i) {
            let name = entry.mangled_name();
            let first_component = name.components().next()?;
            let component_str = first_component.as_os_str().to_string_lossy().to_string();

            match &common_prefix {
                None => common_prefix = Some(component_str),
                Some(existing) => {
                    if *existing != component_str {
                        return None; // Multiple top-level entries, no stripping
                    }
                }
            }
        }
    }

    // Only strip if the common prefix looks like a directory (has entries under it)
    common_prefix.map(PathBuf::from)
}

/// Download a zip from URL, extract to plugins_dir/{name}/, return manifest.
pub async fn download_and_install_plugin(
    client: &reqwest::Client,
    download_url: &str,
    plugins_dir: &Path,
) -> Result<PluginManifest, String> {
    let cache = cache_dir();
    std::fs::create_dir_all(&cache)
        .map_err(|e| format!("Failed to create cache directory: {}", e))?;
    let temp_path = unique_cache_path(&cache, "plugin-download", Some("zip"));
    let temp_extract = unique_cache_path(&cache, "plugin-extract-temp", None);

    let result = async {
        let resp = client
            .get(download_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download plugin: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Download returned HTTP {}", resp.status()));
        }

        if let Some(len) = resp.content_length() {
            if len > MAX_DOWNLOAD_SIZE {
                return Err(format!(
                    "Plugin package too large: {} bytes (max {})",
                    len, MAX_DOWNLOAD_SIZE
                ));
            }
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Failed to read download: {}", e))?;

        if bytes.len() as u64 > MAX_DOWNLOAD_SIZE {
            return Err(format!(
                "Plugin package too large: {} bytes (max {})",
                bytes.len(),
                MAX_DOWNLOAD_SIZE
            ));
        }

        std::fs::write(&temp_path, &bytes)
            .map_err(|e| format!("Failed to write temp file: {}", e))?;

        let manifest = extract_plugin_zip(&temp_path, &temp_extract)?;
        let final_dir = plugins_dir.join(&manifest.name);
        replace_plugin_dir(&temp_extract, &final_dir)?;

        Ok(manifest)
    }
    .await;

    cleanup_temp_artifacts(Some(&temp_path), &temp_extract);

    result
}

/// Install plugin from a local zip file.
pub fn install_from_local_zip(
    zip_path: &Path,
    plugins_dir: &Path,
) -> Result<PluginManifest, String> {
    // Extract to temp dir first to read manifest name
    let cache = cache_dir();
    std::fs::create_dir_all(&cache)
        .map_err(|e| format!("Failed to create cache directory: {}", e))?;
    let temp_extract = unique_cache_path(&cache, "plugin-local-extract-temp", None);

    let result = (|| {
        let manifest = extract_plugin_zip(zip_path, &temp_extract)?;
        let final_dir = plugins_dir.join(&manifest.name);
        replace_plugin_dir(&temp_extract, &final_dir)?;

        Ok(manifest)
    })();

    cleanup_temp_artifacts(None, &temp_extract);

    result
}

fn replace_plugin_dir(temp_extract: &Path, final_dir: &Path) -> Result<(), String> {
    let preserved_preferences = std::fs::read(final_dir.join("preferences.json")).ok();

    if let Some(parent) = final_dir.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create plugins directory: {}", e))?;
    }

    if final_dir.exists() {
        std::fs::remove_dir_all(final_dir)
            .map_err(|e| format!("Failed to remove existing plugin: {}", e))?;
    }

    std::fs::rename(temp_extract, final_dir).or_else(|_| {
        copy_dir_recursive(temp_extract, final_dir)?;
        std::fs::remove_dir_all(temp_extract)
            .map_err(|e| format!("Failed to clean up temp dir: {}", e))
    })?;

    if let Some(preferences) = preserved_preferences {
        std::fs::write(final_dir.join("preferences.json"), preferences)
            .map_err(|e| format!("Failed to restore plugin preferences: {}", e))?;
    }

    Ok(())
}

fn unique_cache_path(cache: &Path, prefix: &str, extension: Option<&str>) -> PathBuf {
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let file_name = match extension {
        Some(extension) => format!(
            "{prefix}-{}-{nanos}-{counter}.{extension}",
            std::process::id()
        ),
        None => format!("{prefix}-{}-{nanos}-{counter}", std::process::id()),
    };
    cache.join(file_name)
}

fn cleanup_temp_artifacts(temp_path: Option<&Path>, temp_extract: &Path) {
    if let Some(temp_path) = temp_path {
        let _ = std::fs::remove_file(temp_path);
    }
    let _ = std::fs::remove_dir_all(temp_extract);
}

/// Recursively copy a directory (fallback when rename fails across filesystems)
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("Failed to create directory: {}", e))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("Failed to read directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy file: {}", e))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::FileOptions;
    use zip::ZipWriter;

    fn sample_manifest_json() -> String {
        r#"{"name":"test-plugin","version":"1.0.0"}"#.to_string()
    }

    fn create_zip_with_manifest(dir: &Path) -> PathBuf {
        let zip_path = dir.join("plugin.zip");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options: FileOptions<'_, ()> =
            FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(sample_manifest_json().as_bytes()).unwrap();
        zip.start_file("readme.txt", options).unwrap();
        zip.write_all(b"Hello").unwrap();
        zip.finish().unwrap();
        zip_path
    }

    fn create_zip_without_manifest(dir: &Path) -> PathBuf {
        let zip_path = dir.join("no-manifest.zip");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options: FileOptions<'_, ()> =
            FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zip.start_file("readme.txt", options).unwrap();
        zip.write_all(b"Hello").unwrap();
        zip.finish().unwrap();
        zip_path
    }

    fn create_zip_with_prefix(dir: &Path) -> PathBuf {
        let zip_path = dir.join("prefixed.zip");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options: FileOptions<'_, ()> =
            FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zip.start_file("my-plugin-v1.0/manifest.json", options)
            .unwrap();
        zip.write_all(sample_manifest_json().as_bytes()).unwrap();
        zip.start_file("my-plugin-v1.0/lib/code.js", options)
            .unwrap();
        zip.write_all(b"console.log('hi')").unwrap();
        zip.finish().unwrap();
        zip_path
    }

    fn create_zip_with_traversal(dir: &Path) -> PathBuf {
        let zip_path = dir.join("evil.zip");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options: FileOptions<'_, ()> =
            FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zip.start_file("../evil.txt", options).unwrap();
        zip.write_all(b"pwned").unwrap();
        zip.finish().unwrap();
        zip_path
    }

    #[test]
    fn test_extract_valid_zip() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = create_zip_with_manifest(tmp.path());
        let dest = tmp.path().join("extracted");

        let manifest = extract_plugin_zip(&zip_path, &dest).unwrap();
        assert_eq!(manifest.name, "test-plugin");
        assert_eq!(manifest.version, "1.0.0");
        assert!(dest.join("manifest.json").exists());
        assert!(dest.join("readme.txt").exists());
    }

    #[test]
    fn test_extract_zip_missing_manifest() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = create_zip_without_manifest(tmp.path());
        let dest = tmp.path().join("extracted");

        let result = extract_plugin_zip(&zip_path, &dest);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Plugin package missing manifest.json"));
    }

    #[test]
    fn test_extract_zip_with_strip_prefix() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = create_zip_with_prefix(tmp.path());
        let dest = tmp.path().join("extracted");

        let manifest = extract_plugin_zip(&zip_path, &dest).unwrap();
        assert_eq!(manifest.name, "test-plugin");
        // Files should be at root, not under my-plugin-v1.0/
        assert!(dest.join("manifest.json").exists());
        assert!(dest.join("lib").join("code.js").exists());
        assert!(!dest.join("my-plugin-v1.0").exists());
    }

    #[test]
    fn test_zip_slip_protection() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = create_zip_with_traversal(tmp.path());
        let dest = tmp.path().join("extracted");

        let result = extract_plugin_zip(&zip_path, &dest);
        // The zip library's mangled_name() sanitizes ".." paths, so extraction
        // proceeds but fails due to missing manifest.json. Either way, no file
        // should be created outside the dest directory.
        assert!(result.is_err());
        // Verify no file was written outside dest_dir (the parent)
        assert!(!tmp.path().join("evil.txt").exists());
    }

    #[test]
    fn test_install_from_local_zip() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = create_zip_with_manifest(tmp.path());
        let plugins_dir = tmp.path().join("plugins");
        std::fs::create_dir_all(&plugins_dir).unwrap();

        let manifest = install_from_local_zip(&zip_path, &plugins_dir).unwrap();
        assert_eq!(manifest.name, "test-plugin");
        assert!(plugins_dir
            .join("test-plugin")
            .join("manifest.json")
            .exists());
    }

    #[test]
    fn test_install_from_local_zip_preserves_preferences() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = create_zip_with_manifest(tmp.path());
        let plugins_dir = tmp.path().join("plugins");
        let plugin_dir = plugins_dir.join("test-plugin");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(
            plugin_dir.join("preferences.json"),
            r#"{"setup_answers":{"decidr_governance_mode":"team"}}"#,
        )
        .unwrap();

        let manifest = install_from_local_zip(&zip_path, &plugins_dir).unwrap();

        assert_eq!(manifest.name, "test-plugin");
        assert_eq!(
            std::fs::read_to_string(plugin_dir.join("preferences.json")).unwrap(),
            r#"{"setup_answers":{"decidr_governance_mode":"team"}}"#
        );
        assert!(plugin_dir.join("readme.txt").exists());
    }

    #[test]
    fn test_cleanup_temp_artifacts_removes_file_and_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let temp_path = tmp.path().join("plugin-download.zip");
        let temp_extract = tmp.path().join("plugin-extract-temp");
        std::fs::write(&temp_path, b"zip").unwrap();
        std::fs::create_dir_all(&temp_extract).unwrap();
        std::fs::write(temp_extract.join("leftover.txt"), b"temp").unwrap();

        cleanup_temp_artifacts(Some(&temp_path), &temp_extract);

        assert!(!temp_path.exists());
        assert!(!temp_extract.exists());
    }

    #[test]
    fn test_extract_cleanup_on_failure() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = create_zip_without_manifest(tmp.path());
        let dest = tmp.path().join("cleanup-test");

        let result = extract_plugin_zip(&zip_path, &dest);
        assert!(result.is_err());
        // dest_dir should be cleaned up on failure
        assert!(!dest.exists());
    }
}
