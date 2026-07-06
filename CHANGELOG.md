# Changelog

All notable changes to MCPViews will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- Store multi-organization email-code OAuth responses for every returned org under both DecidR and Ludflow plugin credential stores, while keeping token material redacted from renderer and AI-visible responses.
- Collapse Apps menu organization rows by default when their plugin auth context is not valid, while keeping valid org rows expanded and manually expandable rows available for reconnect paths.

## [0.2.69] - 2026-07-06

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.59, staging the latest stable bundled plugin releases.


## [0.2.68] - 2026-07-01

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.58, staging the latest stable bundled plugin releases.

## [0.2.67] - 2026-06-29

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.57, staging the latest stable bundled plugin releases.


## [0.2.66] - 2026-06-29

### Added
- Add a token-safe context layer for org/account-scoped plugins, including `list_contexts`, `set_context_default`, local Tauri context commands, project defaults in `mcpviews-init.json`, and compact `init_session` context default reporting.
- Add DecidR/Ludflow organization context metadata and Apps menu context selection with project-default actions.

### Changed
- Resolve project defaults before token-store defaults for context-aware routing, cache label/catalog details lazily, and keep context discovery token-free by default.

### Fixed
- Invalidate the context catalog from hosted auth/update/default flows so context lists do not retain stale auth or label state.
- Harden MCPViews startup-rule reconciliation so setup-sourced rules use current manifest text after plugin updates, hash invisible text drift consistently, and refuse to mark native startup rules current unless the exact marker exists in the agent rule file.

## [0.2.65] - 2026-06-28

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.56, staging the latest stable bundled plugin releases.


## [0.2.64] - 2026-06-27

### Fixed
- Open review-table cell edits in a multiline textarea so users can comfortably edit long mutation text, preserve newlines, and submit the edited value.

## [0.2.63] - 2026-06-24

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.55, staging the latest stable bundled plugin releases.


### Changed
- Sync the DecidR plugin registry entry to v0.1.55 with decision-first work logging rule v5.

### Fixed
- Add startup-rule coverage so setup-sourced DecidR work logging upgrades stale v4 rules to v5 without preserving canonical Work Session wording.

## [0.2.62] - 2026-06-24

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.54, staging the latest stable bundled plugin releases.


## [0.2.61] - 2026-06-23

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.53, staging the latest stable bundled plugin releases.


## [0.2.60] - 2026-06-23

### Changed
- Include the v0.2.59 source/release hardening changes after the v0.2.59 tag failed before publishing release assets.

### Fixed
- Make lane configuration tests path-separator agnostic so Windows release CI can validate staging and production homes.

## [0.2.59] - 2026-06-23

### Added
- Add explicit production/staging MCPViews lanes with separate homes, ports, app identity, plugin setup/install helpers, and lane tests.
- Add a `file_preview` desktop adapter so trusted renderers can open supported office-style files through sanitized cache paths and OS default apps.
- Allow plugins to declare extra `connect_origins` for signed upload targets such as R2.
- Publish Linux `.deb`, `.rpm`, and AppImage release artifacts with an Ubuntu 24.04 build and loopback smoke gate.

### Changed
- Keep updater artifacts disabled for local/source builds while release builds inject the configured signing public key and enable signed updater artifacts.
- Default the local MCP HTTP server to loopback with narrowed CORS for loopback desktop/plugin origins, leaving `MCPVIEWS_BIND_ADDR` as the explicit network-bind opt-in.
- Declare the supported Node.js engine range and refresh frontend dependencies to clear the source-install audit report.
- Load renderer/browser-harness scripts as modules to reduce release build warning noise.
- Order production DecidR/Ludflow apps before staging app groups in the Apps menu.
- Stage DecidR plugin v0.1.52 and Ludflow plugin v0.5.20 in the DecidR-branded bundle.

## [0.2.58] - 2026-06-22

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/ludflow-mcpviews@v0.5.20, staging the latest stable bundled plugin releases.


## [0.2.57] - 2026-06-21

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/ludflow-mcpviews@v0.5.19, staging the latest stable bundled plugin releases.


## [0.2.56] - 2026-06-21

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.51, staging the latest stable bundled plugin releases.


## [0.2.55] - 2026-06-19

### Changed
- Update API, plugin, CLI, and Windows/Tauri docs to match current renderer names, plugin storage, app update, org auth, native panel, file export, hosted AI, and local bridge surfaces.

### Fixed
- Anchor nested drawer-stack sidecars beside the open AI drawer and keep parent panels layered above child sidecars.

## [0.2.54] - 2026-06-19

### Added
- Add the `mcpviews-core:push_plans_to_mcpviews` startup rule so setup writes instructions for agents to mirror user-facing plans into MCPViews rich content with Mermaid diagrams when helpful.

## [0.2.53] - 2026-06-18

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.50, staging the latest stable bundled plugin releases.


## [0.2.52] - 2026-06-18

### Fixed
- Allow the dense scatter renderer regression test more time on Windows release runners.

## [0.2.51] - 2026-06-18

### Changed
- Stage DecidR plugin v0.1.49 in the bundled registry with a 2500 ms DecidR init-context timeout.

### Fixed
- Call manifest-declared plugin `init_context` providers directly during `init_session`, so DecidR recent-decision breadcrumbs are not blocked by cold plugin tool-list warmup.

## [0.2.50] - 2026-06-18

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.49, staging the latest stable bundled plugin releases.

## [0.2.49] - 2026-06-18

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.48, staging the latest stable bundled plugin releases.
- Replaced the hardcoded DecidR Active Work Session init bootstrap with plugin-declared `init_context` providers, allowing trusted plugins to supply compact `init_session` breadcrumbs through their own MCP tools.
- Emit Codex startup-rule cleanup blocks when removed plugin rules are still present in the managed `AGENTS.md` block, so setup can drop stale native rules such as DecidR Work Session bootstrap.

## [0.2.48] - 2026-06-18

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.47, staging the latest stable bundled plugin releases.


## [0.2.47] - 2026-06-18

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.46, staging the latest stable bundled plugin releases.

## [0.2.46] - 2026-06-18

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.45, staging the latest stable bundled plugin releases.

## [0.2.45] - 2026-06-17

### Fixed
- Preserve plugin setup answers and update preferences during ZIP installs, updates, and reinstalls, so setup-sourced startup rules keep their configured policy across plugin upgrades.
- Clean up unique plugin download temp files and extraction directories on failed installs.

## [0.2.44] - 2026-06-17

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.44, staging the latest stable bundled plugin releases.


## [0.2.43] - 2026-06-17

### Added
- Added compact DecidR Active Work Session context to default `init_session` responses so fresh agents can recover cross-session handoff state without storing raw transcript.

### Changed
- Made default `init_session` lean by omitting runtime `rules`, `plugin_registry`, and `rules_update`; agents can request full runtime breadcrumbs with `include_runtime_context: true`.
- Kept MCPViews startup-rule reconciliation local-rule first by omitting the native startup rule block when installed startup rules are already current.

## [0.2.42] - 2026-06-12

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.42, staging the latest stable bundled plugin releases.


## [0.2.41] - 2026-06-12

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.41, staging the latest stable bundled plugin releases.


## [0.2.40] - 2026-06-12

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.40, staging the latest stable bundled plugin releases.


## [0.2.39] - 2026-06-11

### Fixed
- Keep the Apps launcher on the shared in-window DOM dropdown path without moving embedded app panels when the menu opens.
- Restore Ludflow embedded app renderers to the authenticated iframe handoff path so the launcher remains in front without hiding the Ludflow tab.

## [0.2.38] - 2026-06-11

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/ludflow-mcpviews@v0.5.16, staging the latest stable bundled plugin releases.

## [0.2.37] - 2026-06-11

### Fixed
- Keep embedded Ludflow native panels visible while the Apps launcher is open instead of moving them offscreen.

## [0.2.36] - 2026-06-11

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/ludflow-mcpviews@v0.5.15, staging the latest stable bundled plugin releases.


### Fixed
- Keep mounted native app panels below the MCPViews session tab bar so embedded Ludflow content does not cover tab labels.

## [0.2.35] - 2026-06-11

## [0.2.34] - 2026-06-10

### Changed
- Published the plugin registry entries for DecidR v0.1.39 and GronkSpeak v0.1.4 after their release assets became available.
- Corrected the release line after the DecidR plugin dispatch created v0.2.30 from the previously published release baseline.

### Fixed
- Replaced the DecidR breadcrumb regression test's local mac-dev bundled manifest dependency with an inline checked-in fixture so clean Windows release CI can compile.

## [0.2.30] - 2026-06-10

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.39, staging the latest stable bundled plugin releases.


### Added
- Added plugin `startup_rules`, project-local `mcpviews-init.json` reconciliation, and the `save_startup_rule_state` MCP tool so true session-start behavior can be installed into agent-native rule files without overloading workflow breadcrumbs.
- Added a core MCPViews startup rule for project-specific `init_session` calls and Codex-style startup-rule block metadata for native rule files.
- Added Codex `AGENTS.md` context diagnostics so setup/init responses identify the exact startup-rule target file and warn when parent-only or nested `AGENTS.md` files can make rules look installed in the wrong project root.
- Added `plugin_rule_definitions` for filterable plugin-level workflow breadcrumbs scoped by tools/groups while preserving legacy global `plugin_rules`.

### Changed
- Replaced broad runtime-rule persistence instructions with startup-only installation guidance; `plugin_rules`, renderer guidance, DecidR/Ludflow workflow guidance, setup questions, plugin docs, and tool docs now remain runtime breadcrumbs only.
- Updated the bundled GronkSpeak plugin to v0.1.4 with rule v4, keeping ordinary final answers, directory summaries, repo reports, test summaries, and internal reports in GronkSpeak unless the user asks for public/polished prose.
- Kept `init_session` plugin registry breadcrumbs compact by including only legacy global `plugin_rules` and structured rules marked `always_include`; detailed structured plugin rules are returned by `get_plugin_docs` only when relevant to requested tools/groups.

### Fixed
- Made missing `project_path` a loud `project_path_required` startup-rule status so agents rerun init/setup before treating startup rules as reconciled.

## [0.2.29] - 2026-06-10

### Changed
- Removed the mandatory Windows WebDriver release smoke from CI and moved
  `tauri-driver` automation to backlog discovery after VMware and human Windows
  QA passed.
- Hardened Windows/Tauri release readiness around adapter-owned platform
  behavior, VMware smoke evidence, human QA sign-off, and Mac regression smoke.

### Fixed
- Resolved the Windows Apps launcher and Ludflow interaction regressions by
  avoiding native child-panel/popup paths that could leave blank or blocking
  WebView surfaces on Windows.

## [0.2.28] - 2026-06-09

## [0.2.27] - 2026-06-09

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.38, staging the latest stable bundled plugin releases.


## [0.2.26] - 2026-06-09

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/ludflow-mcpviews@v0.5.14, staging the latest stable bundled plugin releases.


## [0.2.25] - 2026-06-09

### Changed
- Moved Gronk Speak setup out of MCPViews core and into an optional installable registry plugin, so users see those mode/scope setup questions only after installing `mcpviews-gronk-speak`.
- Extended plugin `setup_questions` to preserve optional `guidance`, `recommended_value`, and `example_outputs` fields for richer one-question-at-a-time setup prompts.

## [0.2.24] - 2026-06-09

### Changed
- `mcpviews_setup` now tells agents to explain setup questions conversationally, including Gronk Speak guidance, option fit, defaults, and examples before waiting for one answer at a time.

## [0.2.23] - 2026-06-09

## [0.2.22] - 2026-06-08

## [0.2.21] - 2026-06-08

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.35, staging the latest stable bundled plugin releases.


## [0.2.20] - 2026-06-08

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.34, staging the latest stable bundled plugin releases.


## [0.2.19] - 2026-06-07

## [0.2.18] - 2026-06-07

## [0.2.17] - 2026-06-07

### Fixed
- Email-code organization selection now gives the create-organization action proper spacing, and DecidR Setup now treats a returned organization ID as completed auth before falling back to organization-selection prompts.

## [0.2.16] - 2026-06-07

### Changed
- DecidR Setup no longer bundles its own copy of the generic `plugin_email_code_auth` renderer; the renderer is provided by MCPViews core, and branded bundle verification now rejects duplicate setup copies.

## [0.2.15] - 2026-06-07

### Fixed
- Generic MCPViews now ships the built-in `plugin_email_code_auth` renderer, so installed OAuth plugins with six-digit email-code auth can open the in-app sign-in screen without requiring the DecidR Setup bundle.

## [0.2.14] - 2026-06-07

## [0.2.13] - 2026-06-07

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/decidr-plugin@0.1.33, staging the latest stable bundled plugin releases.


## [0.2.12] - 2026-06-07

### Added
- DecidR-branded bundle support now stages release plugin assets for `decidr` and `ludflow`, bundles a first-party DecidR Setup renderer, verifies bundled plugin hashes, and publishes stable macOS/Windows alias artifacts for DecidR-facing downloads.
- The DecidR Setup renderer now supports native 6-digit email-code authentication, organization selection/creation, and shared DecidR/Ludflow token provisioning without collecting passwords or raw OAuth tokens in renderer code.

### Changed
- App-resource bundled plugins can now be discovered from release and mac-dev resource directories, preserving user preferences, avoiding downgrades, and reinstalling same-version bundles only when their packaged content hash changes.
- The Plugin Manager now checks GitHub prerelease metadata for beta installs only when the user asks to install a beta plugin, avoiding eager registry-load API fan-out.

### Fixed
- Native plugin email-code verification now chooses token storage plugin namespaces on the Rust side and redacts OAuth token fields before returning success data to renderer JavaScript.

## [0.2.11] - 2026-06-07

### Changed
- Rebuilt the DecidR-branded installer bundle after DeeJanuz/ludflow-mcpviews@v0.5.13, staging the latest stable bundled plugin releases.

## [0.2.10] - 2026-06-07

### Changed
- Rebuilt the DecidR-branded installer bundle after manual/codex@installer-pipeline-bootstrap-rerun, staging the latest stable bundled plugin releases.

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
