# Changelog

All notable changes to MCPViews will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.9] - 2026-06-07

### Changed
- Rebuilt the DecidR-branded installer bundle after manual/codex@installer-pipeline-bootstrap, staging the latest stable bundled plugin releases.


## [0.2.8-e2e.1] - 2026-06-06

## [0.2.7] - 2026-06-06

## [0.2.6] - 2026-05-25

### Changed
- Built-in MCPViews review guidance now asks agents to reserve `push_review` for destructive, high-impact, ambiguous, or 3+ mutation batches instead of interrupting for every small external write.

### Fixed
- TribeX AI thread answers now render durable `fileRefs` as clickable Workspace files links that open the referenced file in the workspace file browser instead of showing raw JSON.

## [0.2.5] - 2026-05-21

### Changed
- macOS release builds now notarize, staple, validate, and Gatekeeper-check the DMG itself after Tauri builds the signed app bundle.
- In-app update discovery now accepts newer clean SemVer releases, not only `-rc` SemVer tags, while still ignoring GitHub pre-releases and drafts.

## [0.2.5-rc.17] - 2026-05-21

### Added
- Full release-candidate rollup notes for the 0.2.5 train so the release page captures the signed-updater launch, renderer/rules upgrades, hosted AI workspace improvements, and CI hardening in one compressed entry.

### Changed
- Desktop agent setup now relies entirely on the canonical copy-paste install prompt in `docs/install-prompt.md`; the app no longer exposes or auto-launches bundled setup scripts on clean installs.
- The release flow now generates updater manifests from the same local script used in validation, selecting Tauri v2 artifacts consistently across macOS and Windows.
- Release-candidate builds continue to publish as normal GitHub releases so the in-app updater can discover signed RCs while ignoring GitHub pre-releases.

### Fixed
- Clean macOS and Linux installs no longer open the deprecated `setup-integrations.sh` terminal flow on first launch.
- RC updater signing now uses the full encoded Tauri `.pub` file value, passes signing secrets into both platform builds, and writes a `latest.json` manifest with signed macOS and Windows artifacts.
- Windows updater metadata now points at the signed Tauri v2 setup installer instead of expecting an obsolete `.zip` updater archive.
- The 0.2.5 RC train also includes the renderer review targeting rules, hosted AI workspace polish, Windows OAuth launch fix, release lockfile/version bumps, Node 24 CI setup, Windows MSI prerelease normalization, and stale artifact cache removal from earlier RCs.

### Removed
- Removed the remaining macOS/Linux legacy agent integration setup script from app resources.
- Removed the tray "Setup Agent Integrations" action and the first-run setup sentinel path.

## [0.2.5-rc.16] - 2026-05-21

## [0.2.5-rc.15] - 2026-05-21

### Fixed
- Release builds now pass the full Tauri updater `.pub` value into updater artifact generation instead of the inner minisign key line.
- Update installs now normalize Tauri updater public key text before passing it to Tauri's updater plugin.

## [0.2.5-rc.14] - 2026-05-21

### Fixed
- Release builds now inject the updater public key into `tauri.conf.json` before Tauri creates updater artifacts.

## [0.2.5-rc.13] - 2026-05-21

### Fixed
- Release builds now pass the updater signing key material into the macOS and Windows Tauri bundlers before publishing updater artifacts.

## [0.2.5-rc.12] - 2026-05-21

### Added
- In-app update discovery now surfaces newer signed MCPViews release-candidate builds from GitHub releases with changelog and install actions.
- Debug builds can force a mock update banner through `MCPVIEWS_DEV_UPDATE=1` or `npm run dev:update-test` for repeatable desktop UI testing.

### Changed
- Release-candidate GitHub releases are published as normal releases with updater archives, signatures, and a combined `latest.json` manifest so the desktop updater can discover them.
- The AI workspace entrypoint stays hidden on clean installs until a hosted AI provider base URL is configured.

## [0.2.5-rc.11] - 2026-05-20

### Removed
- Windows builds no longer bundle or launch the deprecated `setup-integrations.ps1` PowerShell script.

### Fixed
- App startup now removes a leftover Windows `scripts/setup-integrations.ps1` resource from older installs when possible.

## [0.2.5-rc.10] - 2026-05-20

### Changed
- `mcpviews_setup` and persisted-rule guidance now tell agents to update an existing MCPViews rules section or memory when plugin updates add missing rule details, and built-in rules are bumped to version 14.
- TribeX AI hosted-provider auth now uses 6-digit email-code sign-in copy, commands, and provider-contract docs instead of the old magic-link flow.

## [0.2.5-rc.9] - 2026-05-20

### Added
- Human-centered renderer UX principles now document the default interaction standards for operational plugin and built-in renderer flows.

### Changed
- The TribeX AI runtime surface now maximizes transcript space with a compact single-row header, tighter transcript spacing, and a resizing composer that only grows with entered text.
- New TribeX AI threads now ask only for the persona in the navigator composer, leaving titles to the provider-generated naming flow after the first response.

### Fixed
- TribeX AI thread loading and rehydration states now clamp width and overflow more defensively so long content does not crop the view before live layout settles.
- Large skill lists now render in a compact overlay with truncated labels and tooltips, preserving the text-entry area when many skills are available.

## [0.2.5-rc.8] - 2026-05-16

### Changed
- `push_review` guidance now requires visible review targets to use human-readable names, titles, paths, or labels instead of opaque backend IDs, and bumps built-in rules to version 13.

## [0.2.5-rc.7] - 2026-05-14

### Fixed
- `rich_content` now suppresses a duplicate leading document heading when it matches the renderer title, while preserving the original raw Markdown view.

## [0.2.5-rc.6] - 2026-05-12

### Added
- Native macOS development bundles now package local plugin assets for AI thread and Persona Studio testing.
- The AI chat surface now includes the refreshed action dock, workspace controls, and scroll behavior from the updated UX pattern.

### Changed
- AI chat status, naming, and runtime state handling were refined across native and hosted thread flows.
- Persona skill variable merging now preserves runtime-provided values more reliably.

### Fixed
- Replayed MCP review decisions now persist across retries and are documented in the API reference.
- Delayed assistant output now clears pending thread state when `turn_finish` arrives before the final assistant message.

## [0.2.5-rc.5] - 2026-05-02

### Fixed
- Windows release-candidate MSI packaging now uses a numeric-only Tauri bundle prerelease version while preserving the SemVer release tag.

## [0.2.5-rc.4] - 2026-05-02

### Changed
- Manual macOS release builds can now disable notarization while keeping code signing enabled, allowing release-candidate artifacts when Apple notarization agreements need renewal.
- Release builds now use the npm-pinned Tauri CLI instead of compiling `cargo-tauri` in CI.

### Fixed
- macOS release verification now skips Gatekeeper assessment when notarization is intentionally disabled.

## [0.2.5-rc.3] - 2026-05-02

### Fixed
- Main session routing tests now normalize CRLF line endings before instrumenting `public/main.js`, so Windows release CI can run the same assertions as macOS/Linux.

## [0.2.5-rc.2] - 2026-05-02

### Changed
- Release builds now install Node.js 24 on GitHub Actions to match current package engine requirements.

### Fixed
- `package-lock.json` is back in sync with `package.json`, and the release workflow now bumps package and Cargo lockfile versions during release preparation so `npm ci` can run in release builds and release tags stay consistent.

## [0.2.5-rc.1] - 2026-05-02

### Changed
- `.github/workflows/build-release.yml`: versioned manual release runs now pass the created tag/version into downstream macOS, Windows, and release jobs so the same workflow run can build and publish the tagged release artifacts.
- Release-candidate versions with prerelease semver suffixes are now marked as prereleases in GitHub Releases.
- Windows release builds now run frontend tests, a frontend production build, and Rust workspace tests before packaging.

### Fixed
- Replaced deprecated `tempfile::TempDir::into_path()` usage in the MCP tools update-preference test and removed the committed `.DS_Store` file while ignoring future copies.

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
