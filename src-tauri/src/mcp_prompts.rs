use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::AsyncAppState;

const ONBOARDING_PROMPT: &str = r#"# MCPViews Plugin Onboarding

You are helping the user discover and install MCPViews plugins. Follow these steps:

## Step 1: Show Available Plugins

Call `list_registry` to see all available plugins. Present them to the user in a clear format showing:
- Plugin name and description
- Whether it's already installed
- Whether auth is needed
- Whether an update is available

## Step 2: Install Plugins

Ask the user which plugins they'd like to install. For each one:
1. Call `mcpviews_install_plugin` with the `download_url` from the registry entry
2. Report success or failure

## Step 3: Authenticate Plugins

For plugins that require authentication:
1. Call `start_plugin_auth` with the plugin name
2. For OAuth plugins, this will open the user's browser — wait for them to complete the flow
3. For Bearer/ApiKey plugins, tell the user which environment variable to set

## Step 4: Verify

Call `init_session` to verify all plugins are loaded and authenticated.

## Troubleshooting Tips

- If a plugin's tools don't appear after install, the MCP connection may need to be refreshed. Suggest the user reconnect MCP (e.g., `/mcp` in Claude Code).
- For OAuth auth failures, suggest retrying `start_plugin_auth` — the browser flow may have timed out.
- For Bearer/ApiKey auth, remind the user to restart their agent after setting environment variables.
- If `list_registry` returns empty, the registry may be unreachable — check network connectivity.
"#;

fn builtin_prompt_definitions() -> Vec<(&'static str, &'static str, Vec<Value>, &'static str)> {
    vec![
        (
            "onboarding",
            "Guided setup to discover, install, and authenticate MCPViews plugins.",
            vec![],
            ONBOARDING_PROMPT,
        ),
    ]
}

/// Return all prompts available (built-in + plugin prompts) in MCP format.
pub async fn list_prompts(state: &Arc<TokioMutex<AsyncAppState>>) -> Vec<Value> {
    let mut prompts: Vec<Value> = Vec::new();

    // Built-in prompts
    for (name, description, arguments, _content) in builtin_prompt_definitions() {
        prompts.push(serde_json::json!({
            "name": name,
            "description": description,
            "arguments": arguments,
        }));
    }

    // Plugin prompts (namespaced as {plugin}/{prompt})
    {
        let state_guard = state.lock().await;
        let registry = state_guard.inner.plugin_registry.lock().unwrap();
        for manifest in &registry.manifests {
            for prompt_def in &manifest.prompt_definitions {
                let namespaced = format!("{}/{}", manifest.name, prompt_def.name);
                prompts.push(serde_json::json!({
                    "name": namespaced,
                    "description": prompt_def.description,
                    "arguments": prompt_def.arguments.iter().map(|a| serde_json::json!({
                        "name": a.name,
                        "description": a.description,
                        "required": a.required,
                    })).collect::<Vec<Value>>(),
                }));
            }
        }
    }

    prompts
}

/// Look up a built-in prompt by name. Returns the content if found.
fn resolve_builtin_prompt(name: &str) -> Option<&'static str> {
    builtin_prompt_definitions()
        .into_iter()
        .find(|(n, _, _, _)| *n == name)
        .map(|(_, _, _, content)| content)
}

/// Resolve a prompt by name and return MCP-formatted messages.
pub async fn get_prompt(
    name: &str,
    arguments: Option<Value>,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    // Check built-in prompts first
    if let Some(content) = resolve_builtin_prompt(name) {
        return Ok(serde_json::json!({
            "messages": [{
                "role": "user",
                "content": {
                    "type": "text",
                    "text": content
                }
            }]
        }));
    }

    // Check plugin prompts ({plugin}/{prompt} format)
    if let Some((plugin_name, prompt_name)) = name.split_once('/') {
        let mut args = serde_json::json!({
            "plugin": plugin_name,
            "prompt": prompt_name,
        });
        if let Some(template_args) = arguments {
            args.as_object_mut().unwrap().insert("arguments".to_string(), template_args);
        }
        let result = call_get_plugin_prompt(args, state).await?;
        // Transform plugin prompt result into MCP prompt format
        let text = result
            .get("content")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
            .and_then(|item| item.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or("");
        return Ok(serde_json::json!({
            "messages": [{
                "role": "user",
                "content": {
                    "type": "text",
                    "text": text
                }
            }]
        }));
    }

    Err(format!("Unknown prompt: {}", name))
}

/// Fetch a prompt from a plugin by reading its source file and applying template arguments.
pub(crate) async fn call_get_plugin_prompt(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let plugin_name = arguments
        .get("plugin")
        .and_then(|v| v.as_str())
        .ok_or("Missing required parameter: plugin")?;

    let prompt_name = arguments
        .get("prompt")
        .and_then(|v| v.as_str())
        .ok_or("Missing required parameter: prompt")?;

    let template_args: std::collections::HashMap<String, String> = arguments
        .get("arguments")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let (source_path, plugins_dir) = {
        let state_guard = state.lock().await;
        let registry = state_guard.inner.plugin_registry.lock().unwrap();

        let (_, manifest) = registry
            .find_plugin_by_name(plugin_name)
            .ok_or_else(|| format!("Plugin '{}' not found", plugin_name))?;

        let prompt_def = manifest
            .prompt_definitions
            .iter()
            .find(|p| p.name == prompt_name)
            .ok_or_else(|| format!("Prompt '{}' not found in plugin '{}'", prompt_name, plugin_name))?;

        (prompt_def.source.clone(), state_guard.inner.plugins_dir().to_path_buf())
    };

    let path = plugins_dir.join(plugin_name).join(&source_path);
    let mut content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read prompt '{}' from plugin '{}': {}", source_path, plugin_name, e))?;

    // Template arguments: replace {{arg_name}} with provided values
    for (key, value) in &template_args {
        let placeholder = format!("{{{{{}}}}}", key);
        content = content.replace(&placeholder, value);
    }

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": content
        }]
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builtin_prompt_definitions_has_onboarding() {
        let defs = builtin_prompt_definitions();
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].0, "onboarding");
        assert!(!defs[0].3.is_empty()); // content is non-empty
    }

    #[test]
    fn test_resolve_builtin_prompt_found() {
        let content = resolve_builtin_prompt("onboarding");
        assert!(content.is_some());
        assert!(content.unwrap().contains("MCPViews Plugin Onboarding"));
    }

    #[test]
    fn test_resolve_builtin_prompt_not_found() {
        let content = resolve_builtin_prompt("nonexistent");
        assert!(content.is_none());
    }

    #[test]
    fn test_builtin_prompt_definitions_structure() {
        let defs = builtin_prompt_definitions();
        for (name, desc, _args, content) in &defs {
            assert!(!name.is_empty(), "name should not be empty");
            assert!(!desc.is_empty(), "description should not be empty");
            assert!(!content.is_empty(), "content should not be empty");
        }
    }

    // --- M-028: Integration tests for list_prompts / get_prompt logic ---
    // Note: `list_prompts` and `get_prompt` are async functions that require
    // `Arc<TokioMutex<AsyncAppState>>`, which needs a Tauri `AppHandle` that
    // cannot be constructed in unit tests. These tests exercise the underlying
    // data paths and logic that those async functions read from.

    use crate::test_utils::{test_app_state, test_manifest};

    #[test]
    fn test_list_prompts_builtin_format() {
        // Verifies the built-in prompt produces the same JSON structure
        // that list_prompts would return.
        let defs = builtin_prompt_definitions();
        let (name, description, arguments, _content) = &defs[0];
        let entry = serde_json::json!({
            "name": name,
            "description": description,
            "arguments": arguments,
        });
        assert_eq!(entry["name"], "onboarding");
        assert!(entry["description"].as_str().unwrap().len() > 0);
        assert!(entry["arguments"].is_array());
    }

    #[test]
    fn test_list_prompts_plugin_prompt_data_path() {
        // Exercises the same registry data path that list_prompts reads:
        // registry.manifests -> prompt_definitions -> namespaced name.
        let (state, _dir) = test_app_state();

        let mut manifest = test_manifest("my-plugin");
        manifest.prompt_definitions.push(mcpviews_shared::PromptDef {
            name: "setup-guide".to_string(),
            description: "Setup instructions".to_string(),
            arguments: vec![mcpviews_shared::PromptArgument {
                name: "env".to_string(),
                description: "Target environment".to_string(),
                required: true,
            }],
            source: "prompts/setup.md".to_string(),
        });

        {
            let mut registry = state.plugin_registry.lock().unwrap();
            registry.add_plugin(manifest).unwrap();
        }

        // Simulate what list_prompts does with plugin prompts
        let registry = state.plugin_registry.lock().unwrap();
        let mut plugin_prompts: Vec<Value> = Vec::new();
        for manifest in &registry.manifests {
            for prompt_def in &manifest.prompt_definitions {
                let namespaced = format!("{}/{}", manifest.name, prompt_def.name);
                plugin_prompts.push(serde_json::json!({
                    "name": namespaced,
                    "description": prompt_def.description,
                    "arguments": prompt_def.arguments.iter().map(|a| serde_json::json!({
                        "name": a.name,
                        "description": a.description,
                        "required": a.required,
                    })).collect::<Vec<Value>>(),
                }));
            }
        }

        assert_eq!(plugin_prompts.len(), 1);
        assert_eq!(plugin_prompts[0]["name"], "my-plugin/setup-guide");
        assert_eq!(plugin_prompts[0]["description"], "Setup instructions");
        let args = plugin_prompts[0]["arguments"].as_array().unwrap();
        assert_eq!(args.len(), 1);
        assert_eq!(args[0]["name"], "env");
        assert_eq!(args[0]["required"], true);
    }

    #[test]
    fn test_list_prompts_includes_builtin_and_plugin() {
        // Verifies the combined result would include both built-in and plugin prompts.
        let (state, _dir) = test_app_state();

        let mut manifest = test_manifest("test-plugin");
        manifest.prompt_definitions.push(mcpviews_shared::PromptDef {
            name: "hello".to_string(),
            description: "Hello prompt".to_string(),
            arguments: vec![],
            source: "prompts/hello.md".to_string(),
        });

        {
            let mut registry = state.plugin_registry.lock().unwrap();
            registry.add_plugin(manifest).unwrap();
        }

        // Build the same list that list_prompts would
        let mut prompts: Vec<Value> = Vec::new();
        for (name, description, arguments, _content) in builtin_prompt_definitions() {
            prompts.push(serde_json::json!({
                "name": name,
                "description": description,
                "arguments": arguments,
            }));
        }
        {
            let registry = state.plugin_registry.lock().unwrap();
            for manifest in &registry.manifests {
                for prompt_def in &manifest.prompt_definitions {
                    let namespaced = format!("{}/{}", manifest.name, prompt_def.name);
                    prompts.push(serde_json::json!({
                        "name": namespaced,
                        "description": prompt_def.description,
                        "arguments": prompt_def.arguments.iter().map(|a| serde_json::json!({
                            "name": a.name,
                            "description": a.description,
                            "required": a.required,
                        })).collect::<Vec<Value>>(),
                    }));
                }
            }
        }

        assert_eq!(prompts.len(), 2);
        assert_eq!(prompts[0]["name"], "onboarding");
        assert_eq!(prompts[1]["name"], "test-plugin/hello");
    }

    #[test]
    fn test_get_prompt_builtin_returns_mcp_format() {
        // Exercises the same logic as get_prompt for a built-in prompt name.
        let content = resolve_builtin_prompt("onboarding").unwrap();
        let result = serde_json::json!({
            "messages": [{
                "role": "user",
                "content": {
                    "type": "text",
                    "text": content
                }
            }]
        });
        assert!(result["messages"].is_array());
        let messages = result["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[0]["content"]["type"], "text");
        assert!(messages[0]["content"]["text"].as_str().unwrap().contains("MCPViews Plugin Onboarding"));
    }

    #[test]
    fn test_get_prompt_unknown_name_error() {
        // Exercises the error path: name is not built-in and has no "/" (so not a plugin prompt).
        let content = resolve_builtin_prompt("totally-unknown");
        assert!(content.is_none());
        // In get_prompt, after failing builtin and not matching plugin format,
        // the result would be Err("Unknown prompt: totally-unknown").
    }

    #[test]
    fn test_get_prompt_plugin_name_parsing() {
        // Verifies the name.split_once('/') parsing that get_prompt uses for plugin prompts.
        let name = "my-plugin/setup-guide";
        let (plugin_name, prompt_name) = name.split_once('/').unwrap();
        assert_eq!(plugin_name, "my-plugin");
        assert_eq!(prompt_name, "setup-guide");

        // Single segment (no slash) should not match
        assert!("just-a-name".split_once('/').is_none());
    }

    #[test]
    fn test_plugin_prompt_template_replacement() {
        // Tests the template replacement logic used in call_get_plugin_prompt.
        let mut content = "Hello {{name}}, welcome to {{env}}!".to_string();
        let args: std::collections::HashMap<String, String> = [
            ("name".to_string(), "Alice".to_string()),
            ("env".to_string(), "production".to_string()),
        ]
        .into_iter()
        .collect();

        for (key, value) in &args {
            let placeholder = format!("{{{{{}}}}}", key);
            content = content.replace(&placeholder, value);
        }

        assert_eq!(content, "Hello Alice, welcome to production!");
    }

    #[test]
    fn test_plugin_prompt_template_no_args() {
        // Template with no arguments should remain unchanged.
        let content = "Static prompt content with {{placeholder}}.".to_string();
        let args: std::collections::HashMap<String, String> = std::collections::HashMap::new();

        let mut result = content.clone();
        for (key, value) in &args {
            let placeholder = format!("{{{{{}}}}}", key);
            result = result.replace(&placeholder, value);
        }

        assert_eq!(result, content);
    }

    #[test]
    fn test_plugin_prompt_file_read_and_template() {
        // Integration test: creates a real prompt file on disk and verifies
        // the same read + template logic that call_get_plugin_prompt uses.
        let (state, _dir) = test_app_state();

        let mut manifest = test_manifest("file-plugin");
        manifest.prompt_definitions.push(mcpviews_shared::PromptDef {
            name: "greet".to_string(),
            description: "Greeting prompt".to_string(),
            arguments: vec![mcpviews_shared::PromptArgument {
                name: "user".to_string(),
                description: "User name".to_string(),
                required: true,
            }],
            source: "prompts/greet.md".to_string(),
        });

        {
            let mut registry = state.plugin_registry.lock().unwrap();
            registry.add_plugin(manifest).unwrap();
        }

        // Create the prompt file on disk at plugins_dir/file-plugin/prompts/greet.md
        let plugins_dir = state.plugins_dir();
        let prompt_dir = plugins_dir.join("file-plugin").join("prompts");
        std::fs::create_dir_all(&prompt_dir).unwrap();
        std::fs::write(prompt_dir.join("greet.md"), "Hello {{user}}, how are you?").unwrap();

        // Simulate call_get_plugin_prompt logic
        let registry = state.plugin_registry.lock().unwrap();
        let (_, found_manifest) = registry.find_plugin_by_name("file-plugin").unwrap();
        let prompt_def = found_manifest
            .prompt_definitions
            .iter()
            .find(|p| p.name == "greet")
            .unwrap();

        let path = plugins_dir.join("file-plugin").join(&prompt_def.source);
        let mut content = std::fs::read_to_string(&path).unwrap();

        let template_args: std::collections::HashMap<String, String> =
            [("user".to_string(), "Bob".to_string())].into_iter().collect();
        for (key, value) in &template_args {
            let placeholder = format!("{{{{{}}}}}", key);
            content = content.replace(&placeholder, value);
        }

        assert_eq!(content, "Hello Bob, how are you?");

        // Verify MCP format output
        let result = serde_json::json!({
            "content": [{
                "type": "text",
                "text": content
            }]
        });
        assert_eq!(result["content"][0]["text"], "Hello Bob, how are you?");
    }

    #[test]
    fn test_plugin_prompt_file_not_found() {
        // When the prompt source file doesn't exist on disk, reading should fail.
        let (state, _dir) = test_app_state();

        let mut manifest = test_manifest("missing-file-plugin");
        manifest.prompt_definitions.push(mcpviews_shared::PromptDef {
            name: "missing".to_string(),
            description: "Missing prompt".to_string(),
            arguments: vec![],
            source: "prompts/does-not-exist.md".to_string(),
        });

        {
            let mut registry = state.plugin_registry.lock().unwrap();
            registry.add_plugin(manifest).unwrap();
        }

        let registry = state.plugin_registry.lock().unwrap();
        let (_, found_manifest) = registry.find_plugin_by_name("missing-file-plugin").unwrap();
        let prompt_def = found_manifest
            .prompt_definitions
            .iter()
            .find(|p| p.name == "missing")
            .unwrap();

        let plugins_dir = state.plugins_dir();
        let path = plugins_dir.join("missing-file-plugin").join(&prompt_def.source);
        let result = std::fs::read_to_string(&path);
        assert!(result.is_err());
    }
}
