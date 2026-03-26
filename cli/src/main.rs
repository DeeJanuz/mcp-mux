use clap::{Parser, Subcommand};
use mcp_mux_shared::*;
use std::fs;

const DEFAULT_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/anthropics/mcp-mux-registry/main/registry.json";

#[derive(Parser)]
#[command(name = "mcp-mux-cli", about = "MCP Mux plugin manager CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Manage plugins
    Plugin {
        #[command(subcommand)]
        action: PluginAction,
    },
}

#[derive(Subcommand)]
enum PluginAction {
    /// List installed plugins
    List,
    /// Install a plugin from the registry
    Add {
        /// Plugin name from the registry
        name: String,
    },
    /// Remove an installed plugin
    Remove {
        /// Plugin name to remove
        name: String,
    },
    /// Install a plugin from a local JSON manifest file
    AddCustom {
        /// Path to the manifest JSON file
        path: String,
    },
    /// Search the plugin registry
    Search {
        /// Optional search query (filters by name, description, tags)
        query: Option<String>,
    },
}

fn get_registry_url() -> String {
    if let Ok(content) = fs::read_to_string(config_path()) {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(url) = config.get("registry_url").and_then(|v| v.as_str()) {
                return url.to_string();
            }
        }
    }
    DEFAULT_REGISTRY_URL.to_string()
}

async fn fetch_registry() -> Result<Vec<RegistryEntry>, String> {
    let url = get_registry_url();
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch registry: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Registry returned HTTP {}", resp.status()));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read registry response: {}", e))?;

    let registry: RemoteRegistry =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse registry: {}", e))?;

    Ok(registry.plugins)
}

fn plugin_list() {
    let dir = plugins_dir();
    if !dir.exists() {
        println!("No plugins installed.");
        return;
    }

    let entries: Vec<_> = fs::read_dir(&dir)
        .unwrap_or_else(|_| {
            println!("No plugins installed.");
            std::process::exit(0);
        })
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "json")
                .unwrap_or(false)
        })
        .collect();

    if entries.is_empty() {
        println!("No plugins installed.");
        return;
    }

    let mut plugins: Vec<PluginManifest> = Vec::new();
    for entry in entries {
        if let Ok(content) = fs::read_to_string(entry.path()) {
            if let Ok(manifest) = serde_json::from_str::<PluginManifest>(&content) {
                plugins.push(manifest);
            }
        }
    }

    if plugins.is_empty() {
        println!("No plugins installed.");
        return;
    }

    // Calculate column widths
    let name_width = plugins.iter().map(|p| p.name.len()).max().unwrap_or(4).max(4);
    let version_width = plugins
        .iter()
        .map(|p| p.version.len())
        .max()
        .unwrap_or(7)
        .max(7);

    println!("Installed Plugins:");
    for plugin in &plugins {
        let auth_type = match &plugin.mcp {
            Some(mcp) => match &mcp.auth {
                Some(PluginAuth::Bearer { .. }) => "bearer auth".to_string(),
                Some(PluginAuth::ApiKey { .. }) => "api key auth".to_string(),
                Some(PluginAuth::OAuth { .. }) => "oauth".to_string(),
                None => "no auth".to_string(),
            },
            None => "no mcp".to_string(),
        };
        let mcp_url = plugin
            .mcp
            .as_ref()
            .map(|m| m.url.as_str())
            .unwrap_or("-");

        println!(
            "  {:<name_width$}  {:<version_width$}  {:<14}  {}",
            plugin.name,
            plugin.version,
            auth_type,
            mcp_url,
            name_width = name_width,
            version_width = version_width,
        );
    }
}

async fn plugin_add(name: &str) {
    let entries = match fetch_registry().await {
        Ok(e) => e,
        Err(err) => {
            eprintln!("Error: {}", err);
            std::process::exit(1);
        }
    };

    let entry = entries.iter().find(|e| e.name == name);
    match entry {
        Some(entry) => {
            let dir = plugins_dir();
            if let Err(e) = fs::create_dir_all(&dir) {
                eprintln!("Error creating plugins directory: {}", e);
                std::process::exit(1);
            }

            let path = dir.join(format!("{}.json", name));
            let json = serde_json::to_string_pretty(&entry.manifest).unwrap();
            if let Err(e) = fs::write(&path, json) {
                eprintln!("Error writing plugin file: {}", e);
                std::process::exit(1);
            }

            println!("Installed plugin '{}' v{}", entry.name, entry.version);
        }
        None => {
            eprintln!("Plugin '{}' not found in registry.", name);
            eprintln!();
            eprintln!("Available plugins:");
            for e in &entries {
                eprintln!("  {}  v{}  {}", e.name, e.version, e.description);
            }
            std::process::exit(1);
        }
    }
}

fn plugin_remove(name: &str) {
    let path = plugins_dir().join(format!("{}.json", name));
    if !path.exists() {
        eprintln!("Plugin '{}' is not installed.", name);
        std::process::exit(1);
    }

    if let Err(e) = fs::remove_file(&path) {
        eprintln!("Error removing plugin: {}", e);
        std::process::exit(1);
    }

    println!("Removed plugin '{}'.", name);
}

fn plugin_add_custom(path: &str) {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error reading file '{}': {}", path, e);
            std::process::exit(1);
        }
    };

    let manifest: PluginManifest = match serde_json::from_str(&content) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("Error parsing manifest: {}", e);
            std::process::exit(1);
        }
    };

    if manifest.name.is_empty() {
        eprintln!("Invalid manifest: plugin name is empty.");
        std::process::exit(1);
    }

    let dir = plugins_dir();
    if let Err(e) = fs::create_dir_all(&dir) {
        eprintln!("Error creating plugins directory: {}", e);
        std::process::exit(1);
    }

    let dest = dir.join(format!("{}.json", manifest.name));
    let json = serde_json::to_string_pretty(&manifest).unwrap();
    if let Err(e) = fs::write(&dest, json) {
        eprintln!("Error writing plugin file: {}", e);
        std::process::exit(1);
    }

    println!(
        "Installed custom plugin '{}' v{}",
        manifest.name, manifest.version
    );
}

async fn plugin_search(query: Option<&str>) {
    let entries = match fetch_registry().await {
        Ok(e) => e,
        Err(err) => {
            eprintln!("Error: {}", err);
            std::process::exit(1);
        }
    };

    let filtered: Vec<&RegistryEntry> = match query {
        Some(q) => {
            let q_lower = q.to_lowercase();
            entries
                .iter()
                .filter(|e| {
                    e.name.to_lowercase().contains(&q_lower)
                        || e.description.to_lowercase().contains(&q_lower)
                        || e.tags.iter().any(|t| t.to_lowercase().contains(&q_lower))
                })
                .collect()
        }
        None => entries.iter().collect(),
    };

    if filtered.is_empty() {
        match query {
            Some(q) => println!("No plugins found matching '{}'.", q),
            None => println!("No plugins available in the registry."),
        }
        return;
    }

    let name_width = filtered
        .iter()
        .map(|e| e.name.len())
        .max()
        .unwrap_or(4)
        .max(4);
    let version_width = filtered
        .iter()
        .map(|e| e.version.len())
        .max()
        .unwrap_or(7)
        .max(7);

    println!(
        "Registry ({} plugin{} available):",
        filtered.len(),
        if filtered.len() == 1 { "" } else { "s" }
    );
    for entry in &filtered {
        println!(
            "  {:<name_width$}  {:<version_width$}  {}",
            entry.name,
            entry.version,
            entry.description,
            name_width = name_width,
            version_width = version_width,
        );
    }
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Plugin { action } => match action {
            PluginAction::List => plugin_list(),
            PluginAction::Add { name } => plugin_add(&name).await,
            PluginAction::Remove { name } => plugin_remove(&name),
            PluginAction::AddCustom { path } => plugin_add_custom(&path),
            PluginAction::Search { query } => plugin_search(query.as_deref()).await,
        },
    }
}
