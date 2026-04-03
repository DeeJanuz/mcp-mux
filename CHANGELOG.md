# Changelog

All notable changes to MCPViews will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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
