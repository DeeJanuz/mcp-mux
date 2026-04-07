# Changelog

All notable changes to MCPViews will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.4] - 2026-04-07

### Fixed
- **Windows plugin OAuth flows are now functional.** `auth::open_browser` on Windows previously invoked `cmd /C start "" "{url}"`, which was broken in two ways: Rust's `Command` arg escaping re-quoted the `start "" "..."` string and mangled its tokenization, and `cmd.exe` treated the `&` query-param separators in OAuth URLs as command terminators — truncating the launch and producing the dialog *"Windows cannot find '\\'. Make sure you typed the name correctly, and then try again."* Every plugin OAuth flow was affected. Replaced with `rundll32 url.dll,FileProtocolHandler <url>`, which receives the URL as a single argument with no shell parsing. (`src-tauri/src/auth.rs`)

## [0.2.3] - 2026-04-06

### Added
- `docs/install-prompt.md` — canonical agent-driven install prompt. Users paste it into Claude Code, Codex CLI, Cursor, Windsurf, OpenCode, or Antigravity, and the agent registers MCPViews in the tool's user-level MCP config (reading first, asking on existing entries, preserving unrelated keys).
- Claude Desktop manual fallback using the `npx -y mcp-remote http://localhost:4200/mcp` stdio bridge, documented in both `docs/install.md` and `README.md`.

### Changed
- `docs/install.md` "Next Steps" section now leads with the agent install prompt (embedded inline via `<details>`) and reorders verification to call `init_session` from the `mcpviews` server. The legacy bare-URL Claude Desktop JSON is replaced with the correct `mcp-remote` bridge config.
- `src-tauri/scripts/setup-integrations.{sh,ps1}` now print a deprecation banner pointing at `install-prompt.md` and wait 5 seconds before continuing. Scripts remain functional for one release and will be removed next.
- Re-tiered the `styles.css` z-index scale with a new semantic `--z-app-chrome` (2000) token for the persistent app shell, and bumped `--z-modal` from 200 to 5000 so true modal dialogs sit above plugin renderer content (observed up to ~1001). Layering tiers are now documented inline: `base`/`raised`/`sticky` → `overlay` (100) → plugin (~1000) → `app-chrome` (2000) → `modal` (5000) → `dropdown` (9999).
- `src-tauri/tauri.conf.json`: `beforeBuildCommand` now touches `src-tauri/build.rs` after the frontend build so Tauri always re-runs the build script and picks up fresh frontend assets.

### Fixed
- `#main-header` now uses `--z-app-chrome` (2000) instead of the overloaded `--z-dropdown` tier, so the persistent app shell correctly layers above plugin renderer slideouts (e.g. decidr-list panels at z-index ~1001) while leaving `--z-dropdown` reserved for popouts within a stacking context (apps menu).
- `README.md` and `docs/install.md` Claude Desktop config examples previously showed `{"url": "..."}` which cannot work — Claude Desktop only speaks stdio to MCP servers. Replaced with the `mcp-remote` bridge config.

### Removed
- `.github/workflows/build-release.yml`: removed the macOS and Windows "Cache build artifacts" steps. The cache was masking source changes and producing stale binaries; registry and Node caches are retained.

## [0.2.1] - 2026-04-05

### Added
- MCP `resources/list` and `resources/templates/list` stub handlers returning empty arrays
- MCP `initialize` response now advertises `resources` capability (`listChanged: false`, `subscribe: false`)
- Session creation from POST `initialize` — Streamable HTTP clients that POST before opening SSE get a server-side session with `mcp-session-id` response header
- `GET /mcp` accepts optional `mcp-session-id` request header to subscribe to an existing session
- 30-second grace period (`SESSION_GRACE_PERIOD`) on session GC so newly created sessions survive before their first SSE subscriber connects
- `created_at` timestamp on `McpSession` for grace period tracking
- Grace period unit tests for `retain_active` (within window + expired)

### Changed
- Notifications return `202 Accepted` with empty body instead of `200 OK` with `null` JSON
- `mcp_handler` return type changed to `(StatusCode, Option<serde_json::Value>)` to distinguish empty vs JSON responses
- Refactored `mcp_post_handler` (SRP): parse body once, extracted `maybe_create_session` and `build_mcp_response` helpers
- Removed redundant timing/diagnostic `eprintln!` calls from `mcp.rs` and `http_server.rs`; kept operationally useful logs

### Fixed
- `test_retain_active_removes_sessions_with_no_receivers` and `test_retain_active_removes_all_when_no_receivers` now set `created_at` in the past to account for the 30s grace period

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
