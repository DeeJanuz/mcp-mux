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
                "body": { "type": "string", "description": "Markdown body. Supports mermaid fences, code blocks, suggestions, embedded structured_data table references, and embedded universal_graph graph references." },
                "suggestions": { "type": "object", "description": "Optional inline text suggestions keyed by suggestion id." },
                "tables": {
                    "type": "array",
                    "description": "Optional embedded structured_data tables referenced from the body. For large/repeated tables, use dataRef with the dataset_id and query_token returned by register_dataset.",
                    "items": { "type": "object" }
                },
                "graphs": {
                    "type": "array",
                    "description": "Optional embedded universal_graph graph specs referenced from the body. For large/repeated graph rows, use dataRef with the dataset_id and query_token returned by register_dataset.",
                    "items": { "type": "object" }
                },
                "instructionTemplate": {
                    "type": "object",
                    "description": "Optional reusable instruction template, such as audit_only_evidence_review_v1, plus variables."
                },
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
                "tables": {
                    "type": "array",
                    "description": "Structured table definitions. Each table must include id plus either columns/rows or dataRef. Use register_dataset + dataRef to avoid repeating large row sets.",
                    "items": { "type": "object" }
                },
                "instructionTemplate": {
                    "type": "object",
                    "description": "Optional reusable instruction template, such as audit_only_evidence_review_v1, plus variables."
                }
            },
            "required": ["tables"]
        }
    })
}

fn universal_graph_definition(renderers: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "universal_graph",
        "description": super::renderer_description(
            renderers,
            "universal_graph",
            "Display native read-only analytical graph packs in the MCPViews window using semantic graph specs. Supports standalone graph dashboards plus read-only rich_content and review embeds."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": { "type": "string", "description": "Optional heading shown above the graph pack." },
                "description": { "type": "string", "description": "Optional context shown above the graphs." },
                "graphs": {
                    "type": "array",
                    "description": "Graph definitions. Each graph must include id, type, encoding, and either data.columns/data.rows or dataRef. Use register_dataset + dataRef recipes to avoid repeating large row sets. Per-graph axes provide x/y labels and descriptions for business context. Per-graph role may be primary or drilldown. Per-graph options may include xScale/yScale, maxVisibleItems, showAll, otherBucket, binCount, plus waterfall showTotal/totalLabel. Per-graph interactions may include details, hover, drilldowns, and metricControls. Dense graphs auto-summarize with source-data inspection; funnels use uniform side slope with vertical stage thickness encoding value.",
                    "items": { "type": "object" }
                },
                "instructionTemplate": {
                    "type": "object",
                    "description": "Optional reusable instruction template, such as audit_only_evidence_review_v1, plus variables."
                }
            },
            "required": ["graphs"]
        }
    })
}

fn register_dataset_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "register_dataset",
        "description": "Register small inline seed data or allowlisted local Markdown references in MCPViews' session-scoped cache, then use the returned dataset_id and query_token in renderer dataRef payloads. IMPORTANT: pass sources as object literals, not JSON strings. If a source is accidentally stringified, MCPViews parses it and returns a warning instead of forcing a duplicate call. Local Markdown references are restricted to ~/.mcpviews/cache/dataset-references or directories listed in MCPVIEWS_DATASET_REFERENCE_ROOTS. Returns dataset_id, query_token, source/schema summaries, hashes, row/column counts, TTL, and warnings. Use tables[].dataRef with review_rows/select_rows, or graphs[].dataRef with count_by, group_sum, trend, heatmap_by_pair, funnel_from_counts, waterfall_from_deltas, or select_rows. V1 is for output-token savings only: it does not ingest SQL, API, Excel, CSV, or MCP outputs.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset_id": { "type": "string", "description": "Optional stable dataset id. If omitted, MCPViews generates one." },
                "title": { "type": "string", "description": "Optional human-readable dataset title." },
                "columns": { "type": "array", "description": "Optional column definitions for top-level inline rows." },
                "rows": { "type": "array", "description": "Optional top-level inline seed rows." },
                "tables": { "type": "array", "description": "Optional structured_data-style tables to register as sources." },
                "graphs": { "type": "array", "description": "Optional universal_graph graph specs whose data.columns and data.rows should be registered as sources." },
                "sources": {
                    "type": "array",
                    "description": "Optional source objects with id, columns, rows, table, graph, or allowlisted local references. Correct: [{\"id\":\"reviews\",\"rows\":[...]}]. Do not stringify source objects. Local Markdown references support {\"kind\":\"markdown_json_blocks\",\"path\":\"/.../prepared-findings.md\"} and {\"id\":\"reviews\",\"kind\":\"markdown_table\",\"path\":\"/.../prepared-findings.md\",\"heading\":\"Recommended Evidence Reviews\"}, but the resolved file must be under ~/.mcpviews/cache/dataset-references or MCPVIEWS_DATASET_REFERENCE_ROOTS. Pass dataset_id, query_token, and source_id in dataRef when a dataset contains multiple sources."
                },
                "ttl_seconds": { "type": "integer", "description": "Optional session-cache TTL in seconds. Defaults to 30 minutes." }
            }
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
        "description": "Display content in the MCPViews companion window for user review. Use this with structured_data when the user must approve row, column, or cell changes. All visible review targets must use human-readable names, titles, paths, or display labels instead of opaque backend IDs; keep IDs only in stable row ids, metadata, or execution context. Returns immediately with a session_id. Call await_review(session_id) to wait for the user's decision. If await_review returns pending before the user decides, call it again with the same session_id — the review session persists on the server.",
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
                    "description": "Optional renderer metadata. Sensitive backend callback credentials are stripped server-side and are never exposed to renderers."
                },
                "backend_callback": {
                    "type": "object",
                    "description": "Optional backend-owned approval callback configuration with url and token. Stored server-side only; never exposed to renderers."
                },
                "session_id": {
                    "type": "string",
                    "description": "Optional caller-provided review session id. If omitted, MCPViews generates one."
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
        "description": "Wait for a pending review decision. Returns the full decision payload when the user submits. If no decision arrives before the MCP transport safety window, returns status=pending before the longer server-side review deadline expires; call await_review again or use push_check. Completed decisions are replayed from stored session state if an earlier wait response was lost.",
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
        "description": "Non-blocking status check for a review session. Returns current status without waiting. Use await_review to wait for the decision.",
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
        "description": "Initialize MCPViews for this session. Defaults to lean startup-rule reconciliation, plugin auth/update status, and compact ephemeral context. Call at the start of every new agent session; pass project_path so MCPViews can evaluate mcpviews-init.json. Set include_runtime_context=true only when full runtime breadcrumbs and plugin registry details are needed.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent_type": {
                    "type": "string",
                    "description": "The agent platform calling this tool. Supported: 'claude_code', 'claude_desktop', 'codex', 'cursor', 'windsurf', 'opencode', 'antigravity'. If omitted or unrecognized, returns instructions that ask the user how to persist rules."
                },
                "project_path": {
                    "type": "string",
                    "description": "Optional absolute path to the current project root. When provided, MCPViews creates/loads mcpviews-init.json there and returns startup rule install/update actions."
                },
                "include_runtime_context": {
                    "type": "boolean",
                    "description": "Optional. Defaults to false. When true, includes full runtime breadcrumbs such as rules, plugin_registry, and rules_update. Leave false for the normal lean startup path and lazy-load details with describe_connector, describe_tool, get_plugin_docs, or get_plugin_prompt."
                }
            }
        }
    })
}

fn list_contexts_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "list_contexts",
        "description": "List MCPViews plugin org/account contexts without exposing token material. Defaults to compact token/status summaries; request labels, apps, or rows only when needed.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "project_path": {
                    "type": "string",
                    "description": "Optional absolute project path. When supplied, MCPViews includes defaults from that project's mcpviews-init.json."
                },
                "plugin_names": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional plugin-name filter, such as [\"decidr\", \"ludflow\"]."
                },
                "include_contexts": {
                    "type": "boolean",
                    "description": "Include bounded context rows. Defaults to false."
                },
                "include_labels": {
                    "type": "boolean",
                    "description": "Fetch provider labels such as organization name/slug/role. Defaults to false to save tokens."
                },
                "include_apps": {
                    "type": "boolean",
                    "description": "Include standalone app launch templates for each plugin/context. Defaults to false."
                },
                "query": {
                    "type": "string",
                    "description": "Optional case-insensitive context search. May fetch provider labels."
                },
                "max_contexts_per_plugin": {
                    "type": "integer",
                    "description": "Maximum context rows per plugin. Defaults to 12."
                },
                "refresh_policy": {
                    "type": "string",
                    "description": "Reserved. Current behavior is lazy/no eager refresh unless a token is selected for provider lookup."
                },
                "refresh_catalog": {
                    "type": "boolean",
                    "description": "Bypass the short-lived label/catalog cache. Defaults to false."
                }
            }
        }
    })
}

fn set_context_default_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "set_context_default",
        "description": "Persist a project-scoped default org/account context in mcpviews-init.json. Does not write AGENTS.md or other harness rule files.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "project_path": {
                    "type": "string",
                    "description": "Absolute project path whose mcpviews-init.json should store the default."
                },
                "plugin_name": {
                    "type": "string",
                    "description": "Plugin name, such as decidr or ludflow."
                },
                "context_id": {
                    "type": "string",
                    "description": "Org/account context id to use by default."
                },
                "agent_type": {
                    "type": "string",
                    "description": "Optional caller harness. Stored defaults remain in mcpviews-init.json regardless of harness."
                },
                "scope": {
                    "type": "string",
                    "enum": ["plugin", "tool", "renderer", "app"],
                    "description": "Optional scope for the default. Defaults to plugin."
                },
                "target_name": {
                    "type": "string",
                    "description": "Optional tool, renderer, or app name when scope is narrower than plugin."
                },
                "label": {
                    "type": "string",
                    "description": "Optional human label to store with the default. No token material is stored."
                }
            },
            "required": ["project_path", "plugin_name", "context_id"]
        }
    })
}

fn mcpviews_setup_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "mcpviews_setup",
        "description": "Setup or refresh MCPViews startup rules. Returns runtime breadcrumbs plus startup-rule actions; only startup_rule_actions should be persisted into native rule files.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent_type": {
                    "type": "string",
                    "description": "The agent platform calling this tool. Supported: 'claude_code', 'claude_desktop', 'codex', 'cursor', 'windsurf', 'opencode', 'antigravity'. If omitted or unrecognized, returns generic instructions."
                },
                "project_path": {
                    "type": "string",
                    "description": "Optional absolute path to the current project root. When provided, MCPViews creates/loads mcpviews-init.json there and returns startup rule install/update actions."
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
        "description": "Fetch detailed usage docs for a plugin's tools and renderers. Call after tool discovery, plugin status, user intent, or opt-in full runtime context identifies which plugin you need.",
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
        "description": "Start authentication for an installed plugin. OAuth plugins that declare email-code auth open an in-app code flow by default; pass auth_flow='browser' only for advanced OAuth fallback.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "plugin_name": { "type": "string", "description": "Name of the plugin to authenticate" },
                "organization_id": { "type": "string", "description": "Optional organization ID to scope the auth flow to a specific org" },
                "auth_flow": {
                    "type": "string",
                    "enum": ["email_code", "browser"],
                    "description": "Optional auth flow. Defaults to email_code when the plugin declares support; use browser only for advanced fallback."
                }
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

fn save_setup_preference_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "save_setup_preference",
        "description": "Save the user's selected setup answer for an installed plugin. The persisted rule text is derived from the plugin manifest; callers provide only plugin, question_id, and option value.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "plugin": {
                    "type": "string",
                    "description": "Installed plugin name"
                },
                "question_id": {
                    "type": "string",
                    "description": "Stable setup question id from the plugin manifest"
                },
                "value": {
                    "type": "string",
                    "description": "Selected option value from the setup question"
                }
            },
            "required": ["plugin", "question_id", "value"]
        }
    })
}

fn save_startup_rule_state_definition(_: &[RendererDef]) -> Value {
    serde_json::json!({
        "name": "save_startup_rule_state",
        "description": "Record project-local startup rule install/update/opt-out state in mcpviews-init.json. MCPViews does not write agent-native rule files; callers install or update those first, then record the result here.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "project_path": {
                    "type": "string",
                    "description": "Absolute path to the project root containing mcpviews-init.json."
                },
                "plugin": {
                    "type": "string",
                    "description": "Plugin name that owns the startup rule."
                },
                "rule_id": {
                    "type": "string",
                    "description": "Startup rule id from the plugin manifest."
                },
                "rule_version": {
                    "type": "string",
                    "description": "Startup rule version from the plugin manifest."
                },
                "rule_hash": {
                    "type": "string",
                    "description": "sha256:... hash returned by startup_rule_actions for the rule text that was installed or declined."
                },
                "locations": {
                    "type": "array",
                    "description": "Agent-native rule file locations that were updated, relative to the project when possible.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "agent_type": { "type": "string" },
                            "path": { "type": "string" },
                            "label": { "type": "string" }
                        },
                        "required": ["agent_type", "path", "label"]
                    }
                },
                "do_not_install": {
                    "type": "boolean",
                    "description": "Set true when the user declined installing a missing startup rule. MCPViews will not ask again until explicitly changed."
                },
                "do_not_update": {
                    "type": "boolean",
                    "description": "Set true when the user declined updating an already installed startup rule. MCPViews will not auto-update that project rule until explicitly changed."
                }
            },
            "required": ["project_path", "plugin", "rule_id", "rule_version", "rule_hash"]
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

fn universal_graph_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    direct_renderer_handler("universal_graph", arguments, state)
}

fn register_dataset_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(crate::datasets::call_register_dataset(arguments, state))
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

fn list_contexts_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(async move {
        let app_state = {
            let state_guard = state.lock().await;
            state_guard.inner.clone()
        };
        crate::context_layer::list_contexts(arguments, &app_state).await
    })
}

fn set_context_default_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(async move {
        let app_state = {
            let state_guard = state.lock().await;
            state_guard.inner.clone()
        };
        crate::context_layer::set_context_default(arguments, &app_state).await
    })
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
    Box::pin(crate::mcp_registry_tools::call_list_registry(
        arguments, state,
    ))
}

fn start_plugin_auth_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(crate::mcp_registry_tools::call_start_plugin_auth(
        arguments, state,
    ))
}

fn save_update_preference_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::lifecycle::call_save_update_preference(
        arguments, state,
    ))
}

fn save_setup_preference_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::lifecycle::call_save_setup_preference(
        arguments, state,
    ))
}

fn save_startup_rule_state_handler<'a>(
    arguments: Value,
    state: &'a Arc<TokioMutex<AsyncAppState>>,
) -> BuiltinToolFuture<'a> {
    Box::pin(super::lifecycle::call_save_startup_rule_state(
        arguments, state,
    ))
}

pub(crate) fn builtin_tool_specs() -> Vec<BuiltinToolSpec> {
    let presentation_group = CoreConnectorGroupMeta {
        name: "Presentation",
        hint: "Open renderer-backed MCPViews content: graph packs, rich text embeds, structured tables, and review surfaces.",
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
            name: "universal_graph",
            definition: universal_graph_definition,
            handler: universal_graph_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: Some(presentation_group),
        },
        BuiltinToolSpec {
            name: "register_dataset",
            definition: register_dataset_definition,
            handler: register_dataset_handler,
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
            name: "list_contexts",
            definition: list_contexts_definition,
            handler: list_contexts_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: Some(discovery_group),
        },
        BuiltinToolSpec {
            name: "set_context_default",
            definition: set_context_default_definition,
            handler: set_context_default_handler,
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
        BuiltinToolSpec {
            name: "save_setup_preference",
            definition: save_setup_preference_definition,
            handler: save_setup_preference_handler,
            hosted_visibility: HostedVisibility::HostedModelFacing,
            core_connector_group: None,
        },
        BuiltinToolSpec {
            name: "save_startup_rule_state",
            definition: save_startup_rule_state_definition,
            handler: save_startup_rule_state_handler,
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
