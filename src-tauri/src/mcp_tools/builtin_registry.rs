use mcpviews_shared::RendererDef;
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::AsyncAppState;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum HostedVisibility {
    HostedModelFacing,
    LocalOnly,
}

#[derive(Clone, Copy)]
pub(crate) struct CoreConnectorGroupMeta {
    pub name: &'static str,
    pub hint: &'static str,
}

pub(crate) type BuiltinToolFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Value, String>> + Send + 'a>>;

pub(crate) type BuiltinToolHandler =
    for<'a> fn(Value, &'a Arc<TokioMutex<AsyncAppState>>) -> BuiltinToolFuture<'a>;

#[derive(Clone, Copy)]
pub(crate) struct BuiltinToolSpec {
    pub name: &'static str,
    pub definition: fn(&[RendererDef]) -> Value,
    pub handler: BuiltinToolHandler,
    pub hosted_visibility: HostedVisibility,
    pub core_connector_group: Option<CoreConnectorGroupMeta>,
}

fn renderer_list(renderers: &[RendererDef]) -> String {
    let renderer_names: Vec<String> = renderers.iter().map(|r| r.name.clone()).collect();
    if renderer_names.is_empty() {
        "rich_content".to_string()
    } else {
        renderer_names.join(", ")
    }
}

fn rich_content_definition(renderers: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "rich_content",
        "description": super::renderer_description(
            renderers,
            "rich_content",
            "Display rich markdown content, diagrams, citations, and embedded tables in the MCPViews window."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": { "type": "string", "description": "Optional heading shown above the rich content body." },
                "body": { "type": "string", "description": "Markdown body. Supports mermaid fences, code blocks, suggestions, and embedded structured_data table references." },
                "suggestions": { "type": "object", "description": "Optional inline text suggestions keyed by suggestion id." },
                "tables": { "type": "array", "description": "Optional embedded structured_data tables referenced from the body." },
                "citations": { "type": "object", "description": "Optional citation metadata keyed by source." }
            }
        }
    })
}

fn structured_data_definition(renderers: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "structured_data",
        "description": super::renderer_description(
            renderers,
            "structured_data",
            "Display interactive tabular data with hierarchical rows in the MCPViews window. Use push_content for read-only tables and push_review when the user must approve table changes."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": { "type": "string", "description": "Optional heading shown above the table." },
                "tables": { "type": "array", "description": "Structured table definitions. Each table must include id, name, columns, and rows. Each row must include id, cells, and children." }
            },
            "required": ["tables"]
        }
    })
}

fn push_content_definition(renderers: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "push_content",
        "description": "Display content in the MCPViews window. Supports multiple content types.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tool_name": {
                    "type": "string",
                    "description": format!("Content type identifier for renderer selection. Available renderers: {}. Use 'rich_content' for generic markdown display.", renderer_list(renderers))
                },
                "data": {
                    "type": "object",
                    "description": super::build_data_description(renderers, "Content payload — shape depends on tool_name.")
                },
                "meta": {
                    "type": "object",
                    "description": "Optional metadata (e.g., citation data, source info)."
                }
            },
            "required": ["tool_name", "data"]
        }
    })
}

fn push_review_definition(renderers: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "push_review",
        "description": "Display content in the MCPViews companion window for user review. Use this with structured_data when the user must approve row, column, or cell changes. Returns immediately with a session_id. Call await_review(session_id) to wait for the user's decision. If your transport times out, call await_review again with the same session_id — the review session persists on the server.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tool_name": {
                    "type": "string",
                    "description": format!("Content type identifier for renderer selection. Available renderers: {}.", renderer_list(renderers))
                },
                "data": {
                    "type": "object",
                    "description": super::build_data_description(renderers, "Content payload for review display — shape depends on tool_name.")
                },
                "meta": {
                    "type": "object",
                    "description": "Optional metadata."
                },
                "timeout": {
                    "type": "integer",
                    "description": "Review timeout in seconds. Default: 120. The timeout resets on user activity (heartbeat)."
                }
            },
            "required": ["tool_name", "data"]
        }
    })
}

fn await_review_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "await_review",
        "description": "Wait for a pending review decision. Blocks until the user submits their review in the companion window, or the server-side timeout expires. If your transport times out before the user decides, call this again with the same session_id to reconnect — the review session persists. Returns the full decision payload: status, decision, operationDecisions (structured_data rows), comments, modifications, suggestionDecisions (rich_content inline suggestions), tableDecisions (rich_content embedded tables).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "The session_id returned by push_review."
                }
            },
            "required": ["session_id"]
        }
    })
}

fn push_check_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "push_check",
        "description": "Non-blocking status check for a review session. Returns current status without waiting. Use await_review to block until decision.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "The session ID returned by push_review."
                }
            },
            "required": ["session_id"]
        }
    })
}

fn describe_connector_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "describe_connector",
        "description": "Describe a hosted breadcrumb connector, including representative tools and discovery metadata for the current MCPViews session.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": "Connector key from the hosted discovery catalog."
                }
            },
            "required": ["key"]
        }
    })
}

fn describe_tool_group_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "describe_tool_group",
        "description": "Describe a hosted discovery tool group for a connector, including the tools in that group.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "connector_key": {
                    "type": "string",
                    "description": "Connector key from the hosted discovery catalog."
                },
                "name": {
                    "type": "string",
                    "description": "Tool group name to expand."
                }
            },
            "required": ["connector_key", "name"]
        }
    })
}

fn describe_tool_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "describe_tool",
        "description": "Describe one hosted MCPViews tool, including its schema and usage summary.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Literal tool name from the hosted catalog."
                }
            },
            "required": ["name"]
        }
    })
}

fn init_session_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "init_session",
        "description": "Initialize MCPViews for this session. Returns current renderer definitions, behavioral rules, plugin auth status, and persistence instructions. Should be called at the start of every new agent session.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent_type": {
                    "type": "string",
                    "description": "The agent platform calling this tool. Supported: 'claude_code', 'claude_desktop', 'codex', 'cursor', 'windsurf', 'opencode', 'antigravity'. If omitted or unrecognized, returns instructions that ask the user how to persist rules."
                }
            }
        }
    })
}

fn mcpviews_setup_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "mcpviews_setup",
        "description": "One-time setup for MCPViews. Returns instructions for persisting a session-start rule that ensures init_session is called automatically in every new session. Also returns current rules and plugin status.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent_type": {
                    "type": "string",
                    "description": "The agent platform calling this tool. Supported: 'claude_code', 'claude_desktop', 'codex', 'cursor', 'windsurf', 'opencode', 'antigravity'. If omitted or unrecognized, returns generic instructions."
                }
            }
        }
    })
}

fn install_plugin_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "mcpviews_install_plugin",
        "description": "Install a plugin into MCPViews. Provide a plugin manifest as JSON, and optionally a download URL for a .zip package containing renderer assets.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "manifest_json": {
                    "type": "string",
                    "description": "JSON string of a PluginManifest object defining the plugin's name, version, renderers, MCP config, and tool rules."
                },
                "download_url": {
                    "type": "string",
                    "description": "Optional URL to a .zip package to download and install. If provided, the manifest is extracted from the package and the manifest_json parameter is not used."
                },
                "trigger_auth": {
                    "type": "boolean",
                    "description": "If true, automatically start OAuth authentication after install if the plugin requires it. Defaults to false."
                }
            },
            "required": ["manifest_json"]
        }
    })
}

fn get_plugin_docs_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "get_plugin_docs",
        "description": "Fetch detailed usage docs for a plugin's tools and renderers. Call after init_session identifies which plugin you need.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "plugin": {
                    "type": "string",
                    "description": "Plugin name (e.g., 'ludflow', 'decidr')"
                },
                "groups": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional: specific tool group names to fetch (e.g., ['Search', 'Code Analysis'])"
                },
                "tools": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional: specific tool names to fetch (unprefixed, e.g., ['search_codebase'])"
                },
                "renderers": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional: specific renderer names to fetch (e.g., ['code_units', 'search_results'])"
                }
            },
            "required": ["plugin"]
        }
    })
}

fn update_plugins_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "update_plugins",
        "description": "Update installed plugins to their latest versions from the registry. Uses remote manifest resolution to discover available updates.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "plugin_name": {
                    "type": "string",
                    "description": "Specific plugin to update. If omitted, updates all plugins with available updates."
                },
                "trigger_auth": {
                    "type": "boolean",
                    "description": "If true, automatically start OAuth authentication after update for plugins that require it. Defaults to false."
                }
            }
        }
    })
}

fn get_plugin_prompt_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "get_plugin_prompt",
        "description": "Fetch a prompt from a plugin. Returns the prompt content that should be used as system instructions for a guided workflow.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "plugin": { "type": "string", "description": "Plugin name" },
                "prompt": { "type": "string", "description": "Prompt name" },
                "arguments": {
                    "type": "object",
                    "description": "Optional arguments to template into the prompt",
                    "additionalProperties": { "type": "string" }
                }
            },
            "required": ["plugin", "prompt"]
        }
    })
}

fn list_registry_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "list_registry",
        "description": "List all available plugins from the MCPViews registry, including install status, auth status, and available updates.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tag": { "type": "string", "description": "Optional: filter plugins by tag" }
            }
        }
    })
}

fn start_plugin_auth_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "start_plugin_auth",
        "description": "Start authentication for an installed plugin. Opens browser for OAuth, or checks env var for Bearer/ApiKey.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "plugin_name": { "type": "string", "description": "Name of the plugin to authenticate" },
                "organization_id": { "type": "string", "description": "Optional organization ID to scope the auth flow to a specific org" }
            },
            "required": ["plugin_name"]
        }
    })
}

fn save_update_preference_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "save_update_preference",
        "description": "Save the user's update preference for a plugin after asking them about a pending update.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "plugin": {
                    "type": "string",
                    "description": "Plugin name"
                },
                "policy": {
                    "type": "string",
                    "enum": ["once", "always", "skip"],
                    "description": "Update policy: 'once' (update this time only), 'always' (auto-update), 'skip' (skip this version)"
                },
                "version": {
                    "type": "string",
                    "description": "The version this preference applies to"
                }
            },
            "required": ["plugin", "policy", "version"]
        }
    })
}

fn direct_renderer_handler<'a>(
    renderer_name: &'static str,
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::presentation::call_direct_renderer_content(
        renderer_name,
        arguments,
        state,
    ))
}

fn rich_content_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    direct_renderer_handler("rich_content", arguments, state)
}

fn structured_data_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    direct_renderer_handler("structured_data", arguments, state)
}

fn push_content_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::presentation::call_push_content(arguments, state))
}

fn push_review_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::presentation::call_push_review(arguments, state))
}

fn await_review_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::presentation::call_await_review(arguments, state))
}

fn push_check_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::presentation::call_push_check(arguments, state))
}

fn describe_connector_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::discovery::call_describe_connector(arguments, state))
}

fn describe_tool_group_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::discovery::call_describe_tool_group(arguments, state))
}

fn describe_tool_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::discovery::call_describe_tool(arguments, state))
}

fn init_session_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::session::call_init_session(arguments, state))
}

fn mcpviews_setup_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::session::call_mcpviews_setup(arguments, state))
}

fn install_plugin_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::lifecycle::call_install_plugin(arguments, state))
}

fn get_plugin_docs_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::session::call_get_plugin_docs(arguments, state))
}

fn get_plugin_prompt_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(crate::mcp_prompts::call_get_plugin_prompt(arguments, state))
}

fn update_plugins_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::lifecycle::call_update_plugins(arguments, state))
}

fn list_registry_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(crate::mcp_registry_tools::call_list_registry(arguments, state))
}

fn start_plugin_auth_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(crate::mcp_registry_tools::call_start_plugin_auth(arguments, state))
}

fn save_update_preference_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::lifecycle::call_save_update_preference(arguments, state))
}

pub(crate) fn builtin_tool_specs() -> Vec<BuiltinToolSpec> {
    let presentation_group = CoreConnectorGroupMeta {
        name: "Presentation",
        hint: "Open or review renderer-backed MCPViews content.",
    };
    let discovery_group = CoreConnectorGroupMeta {
        name: "Discovery",
        hint: "Describe connectors, tool groups, and individual tools before acting.",
    };

    vec![
        BuiltinToolSpec {
            name: "rich_content",
            definition: rich_content_definition,
            handler: rich_content_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: Some(presentation_group),
        },
        BuiltinToolSpec {
            name: "structured_data",
            definition: structured_data_definition,
            handler: structured_data_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: Some(presentation_group),
        },
        BuiltinToolSpec {
            name: "push_content",
            definition: push_content_definition,
            handler: push_content_handler,
            hosted_visibility: HostedVisibility::LocalOnly,
            core_connector_group: None,
        },
        BuiltinToolSpec {
            name: "push_review",
            definition: push_review_definition,
            handler: push_review_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: Some(presentation_group),
        },
        BuiltinToolSpec {
            name: "await_review",
            definition: await_review_definition,
            handler: await_review_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: Some(presentation_group),
        },
        BuiltinToolSpec {
            name: "push_check",
            definition: push_check_definition,
            handler: push_check_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: Some(presentation_group),
        },
        BuiltinToolSpec {
            name: "describe_connector",
            definition: describe_connector_definition,
            handler: describe_connector_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: Some(discovery_group),
        },
        BuiltinToolSpec {
            name: "describe_tool_group",
            definition: describe_tool_group_definition,
            handler: describe_tool_group_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: Some(discovery_group),
        },
        BuiltinToolSpec {
            name: "describe_tool",
            definition: describe_tool_definition,
            handler: describe_tool_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: Some(discovery_group),
        },
        BuiltinToolSpec {
            name: "init_session",
            definition: init_session_definition,
            handler: init_session_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: None,
        },
        BuiltinToolSpec {
            name: "mcpviews_setup",
            definition: mcpviews_setup_definition,
            handler: mcpviews_setup_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: None,
        },
        BuiltinToolSpec {
            name: "mcpviews_install_plugin",
            definition: install_plugin_definition,
            handler: install_plugin_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: None,
        },
        BuiltinToolSpec {
            name: "get_plugin_docs",
            definition: get_plugin_docs_definition,
            handler: get_plugin_docs_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: None,
        },
        BuiltinToolSpec {
            name: "get_plugin_prompt",
            definition: get_plugin_prompt_definition,
            handler: get_plugin_prompt_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: None,
        },
        BuiltinToolSpec {
            name: "update_plugins",
            definition: update_plugins_definition,
            handler: update_plugins_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: None,
        },
        BuiltinToolSpec {
            name: "list_registry",
            definition: list_registry_definition,
            handler: list_registry_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: None,
        },
        BuiltinToolSpec {
            name: "start_plugin_auth",
            definition: start_plugin_auth_definition,
            handler: start_plugin_auth_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: None,
        },
        BuiltinToolSpec {
            name: "save_update_preference",
            definition: save_update_preference_definition,
            handler: save_update_preference_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: None,
        },
    ]
}

pub(crate) fn find_builtin_tool_spec(name: &str) -> Option<BuiltinToolSpec> {
    builtin_tool_specs()
        .into_iter()
        .find(|spec| spec.name == name)
}

pub(crate) fn builtin_tool_definitions(renderers: &[RendererDef]) -> Vec<Value> {
    builtin_tool_specs()
        .into_iter()
        .map(|spec| (spec.definition)(renderers))
        .collect()
}

pub(crate) fn is_hosted_model_facing_builtin(name: &str) -> bool {
    find_builtin_tool_spec(name)
        .map(|spec| spec.hosted_visibility == HostedVisibility::HostedModelFacing)
        .unwrap_or(false)
}
