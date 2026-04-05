# Changelog

All notable changes to MCPViews will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- MCP `resources/list` and `resources/templates/list` stub handlers returning empty arrays
- MCP `initialize` response now advertises `resources` capability (`listChanged: false`, `subscribe: false`)
- Session creation from POST `initialize` — Streamable HTTP clients that POST before opening SSE get a server-side session with `mcp-session-id` response header
- `GET /mcp` accepts optional `mcp-session-id` request header to subscribe to an existing session
- 30-second grace period (`SESSION_GRACE_PERIOD`) on session GC so newly created sessions survive before their first SSE subscriber connects
- `created_at` timestamp on `McpSession` for grace period tracking

### Changed
- Notifications return `202 Accepted` with empty body instead of `200 OK` with `null` JSON
- `mcp_handler` return type changed to `(StatusCode, Option<serde_json::Value>)` to distinguish empty vs JSON responses

## [0.2.0] - 2026-04-05

### Changed
- Extracted suggestion widget system (`renderMarkdownWithSuggestions`, `buildSuggestionWidget`) from `shared.js` into dedicated `suggestion-widgets.js` module (~210 lines)
- Extracted `buildCombinedSubmitBar` from inline code in `rich-content.js` into a dedicated function (~100 lines)
- Replaced hard-coded if/else plugin type-to-tool mapping in `citation-panel.js` with `PLUGIN_TYPE_TO_TOOL` lookup table
- Replaced decision type if/else chain in `main.js` `onDecision` with `DECISION_HANDLERS` registry object
- Deduplicated `renderer_selection` rule string to `RENDERER_SELECTION_RULE` shared constant in `mcp_tools.rs`
- Added 49 JS tests (suggestion widgets, table embeds, decision handlers) and 15 Rust tests (`get_plugin_auth_header`, `list_prompts`, `get_prompt`)

### Added
- Inline edit suggestions in rich_content: `{{suggest:id=X}}` markers with accept/reject toggles and comment buttons, supporting replace/insert/delete types and block-level multiline diffs
- Embedded structured_data tables in rich_content: ` ```structured_data:tableId``` ` fenced blocks render fully interactive tables within markdown documents
- Plugin citations: `[label](cite:plugin:SOURCE:TYPE:ID)` links that open a slideout panel with lazy-fetched plugin data via companion proxy
- Combined review payload (`rich_content_decisions`) with `suggestionDecisions` and `tableDecisions` fields returned by `await_review`
- Plugin detail renderer in citation panel for rendering plugin components in slideout panels
- `invokeRenderer` helper on `__companionUtils` for programmatically rendering plugin components
- Ludflow theme CSS variables (`--lf-*`) mapped to core design tokens for consistent plugin styling
- Suggestion widget CSS styles (inline and block-level) with accept/reject/comment visual states
- Install guide (`docs/install.md`) with platform-specific instructions for macOS, Windows, and Linux, plus agent connection setup, plugin installation, and troubleshooting
- CI auto-updates download links in install page when bumping versions
- Plugin rules system: plugins can declare `plugin_rules` in their manifest — high-level behavioral rules agents see every session via `init_session`, `mcpviews_setup`, and `get_plugin_docs`
- Plugin update consent flow: `init_session` evaluates per-plugin update preferences and returns `plugin_update_actions` with `auto_update` vs `ask_user` splits
- New MCP tool `save_update_preference` for persisting user update choices (`once`, `always`, `skip`)
- Plugin preferences storage (`preferences.json` per plugin) with load/save methods
- Auto-update toggle in plugin manager UI (Installed tab) — persists preference via Tauri commands
- Apps button for launching standalone plugin renderers
- Bulk action review rule: agents must present 2+ mutations via `push_review` for user approval before executing
- Rules auto-update: `init_session` includes `rules_version` and stale-detection so persisted rules stay current
- CHANGELOG.md with Keep a Changelog format
- Version-controlled release pipeline: `workflow_dispatch` with optional `version` input bumps all files, updates changelog, tags, and triggers build+release

### Changed
- Bumped `RULES_VERSION` from "4" to "5" — triggers agents to re-persist rules files with renderer convergence capabilities
- Updated `renderer_selection` built-in rule to document inline suggestions, embedded tables, and plugin citations in rich_content
- Updated `structured_data` built-in rule to emphasize hierarchical row nesting with `children` arrays instead of flat column workarounds
- Updated `await_review` tool description to include `suggestionDecisions` and `tableDecisions` response fields
- Updated `rich_content` renderer data hint to document suggestions, tables, and plugin citation schemas
- Moved `buildCitationMap` and `CITE_TYPE_MAP` from rich-content renderer to shared utilities
- Bumped `RULES_VERSION` from "2" to "3" — triggers agents to re-persist rules files with new plugin rules

### Fixed
- Quote URL in Windows browser-open command to handle special characters
- Always populate `oauth_info` so 401 retry can refresh token
- Retry MCP proxy calls on 401 with forced token refresh
- Use `claude mcp add` for Claude Code CLI in PowerShell setup script

## [0.1.0] - 2025-05-01

### Added
- Initial release with rich_content and structured_data renderers
- Plugin system with OAuth authentication
- MCP server with push_content, push_review, and push_check tools
- macOS (arm64) and Windows builds with Apple code signing
