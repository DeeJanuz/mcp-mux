# Technical Debt & Enhancement Log

**Last Updated:** 2026-03-26
**Total Active Issues:** 5
**Resolved This Month:** 15

---

## Active Issues

### Critical

_None_

### High

#### H-006: No tests for new Tauri commands and HTTP handlers (partial)
- **File(s):** `src-tauri/src/commands.rs`, `src-tauri/src/http_server.rs`
- **Principle:** Quality / Reliability
- **Description:** McpSessionManager now has 14 unit tests (added in 6c7538b), but the Tauri command wrappers (`install_plugin_from_registry`, `install_plugin_from_zip`, `update_plugin`, `get_registry_sources`, `add_registry_source`, `remove_registry_source`, `toggle_registry_source`, `get_plugin_renderers`) and HTTP handlers (`mcp_sse_handler`, `mcp_post_handler`, `mcp_delete_handler`) still lack test coverage.
- **Suggested Fix:** Extract testable service layers from the Tauri command wrappers. The `install_or_update_from_entry` helper is a good candidate for unit testing once its AppState dependency is narrowed.
- **Detected:** 2026-03-26 (commit 0fb86a3), partially addressed in 6c7538b

#### H-007: No tests for setup_agent_rules or build_instructions
- **File(s):** `src-tauri/src/mcp_tools.rs`, `src-tauri/src/mcp.rs`
- **Principle:** Quality / Reliability
- **Description:** The `call_setup_agent_rules` function (120 lines) and `build_instructions` function (80 lines) are the primary new features in commit ebb9643 but have zero test coverage. These functions assemble rules from plugins, report auth status, and generate MCP server instructions -- all critical behavioral contracts.
- **Suggested Fix:** Extract rule collection, auth status collection, and persistence instruction generation into testable helpers. Create unit tests with mock state containing plugins with various auth configurations.
- **Detected:** 2026-03-26 (commit ebb9643)

### Medium

#### M-008: call_setup_agent_rules has three responsibilities
- **File(s):** `src-tauri/src/mcp_tools.rs` (call_setup_agent_rules)
- **Principle:** SRP
- **Description:** The 120-line function collects renderer/tool rules, collects plugin auth status, and dispatches agent-type-specific persistence instructions. It also acquires the async state lock twice in sequence (once for rules, once for auth status) which could be unified. As more rule categories or agent types are added, this function will grow further.
- **Suggested Fix:** Extract `collect_rules(registry) -> Vec<Value>`, `collect_auth_status(registry) -> Vec<Value>`, and `persistence_instructions(agent_type) -> &str` as separate functions.
- **Detected:** 2026-03-26 (commit ebb9643)

#### M-009: Duplicated OAuth refresh-and-log pattern
- **File(s):** `src-tauri/src/mcp_tools.rs` (lookup_plugin_tool), `src-tauri/src/plugin.rs` (refresh_stale_plugins)
- **Principle:** DRY / SRP
- **Description:** The pattern of calling `refresh_oauth_token`, logging success with `eprintln`, and logging failure with `eprintln` is duplicated across two call sites with near-identical structure. Both construct `"Bearer {}"` format strings from the result.
- **Suggested Fix:** Extract a `try_refresh_oauth(oauth_info, client) -> Option<String>` helper that handles the refresh attempt, logging, and Bearer formatting in one place.
- **Detected:** 2026-03-26 (commit ebb9643)

### Low

#### L-003: find_plugin_for_tool returns a 5-element tuple
- **File(s):** `src-tauri/src/plugin.rs` (find_plugin_for_tool)
- **Principle:** Readability / Maintainability
- **Description:** The return type `Option<(String, Option<String>, String, HashMap<String, String>, Option<OAuthRefreshInfo>)>` is unwieldy. Callers must destructure positionally, which is fragile and hard to read. The tuple has grown from 4 to 5 elements in this commit.
- **Suggested Fix:** Replace with a `PluginToolResult` struct with named fields: `mcp_url`, `auth_header`, `unprefixed_name`, `renderer_map`, `oauth_info`.
- **Detected:** 2026-03-26 (commit ebb9643)

---

## Resolved Issues

### Resolved 2026-03-26 (commit 6c7538b)

- **H-005:** Duplicated install/update orchestration in commands.rs -- extracted `install_or_update_from_entry` helper used by both `install_plugin_from_registry` and `update_plugin`
- **M-003:** PluginStore instantiated as concrete dependency in PluginRegistry methods -- `PluginStore` now injected as a field via `load_plugins_with_store(store)` constructor
- **M-006:** detect_content_type is effectively dead code -- replaced with `const CONTENT_TYPE: &str = "rich_content"`
- **M-007:** reload_plugins_handler mixes HTTP and plugin lifecycle concerns -- extracted `AppState::reload_plugins()` method, handler now delegates
- **L-002:** Settings stored/loaded as raw serde_json::Value -- replaced with typed `Settings` struct in `shared/src/settings.rs`
- **H-006 (partial):** No tests for McpSessionManager -- 14 unit tests added covering creation, broadcast, subscribe, removal, and retain_active

### Resolved 2026-03-25 (commit 102813b)

- **M-004:** Token reading logic duplicated across PluginAuth match arms and auth module -- extracted to `shared/src/token_store.rs` with `load_stored_token`, `store_token`, `has_stored_token`
- **M-005:** PluginAuth accumulating multiple responsibilities -- filesystem I/O extracted to `token_store` module, `PluginAuth` now delegates instead of doing inline JSON parsing

### Resolved 2026-03-25 (commit e4ca382)

- **H-001:** CLI duplicates registry fetch logic from Tauri backend -- extracted to `shared/src/registry.rs`
- **H-002:** CLI duplicates plugin add/remove filesystem logic -- extracted to `shared/src/plugin_store.rs`
- **H-003:** PluginRegistry God class -- split into `PluginRegistry` (coordination) + `ToolCache` (caching) + `PluginStore` (disk I/O)
- **H-004:** No tests for any new functionality -- 32 tests added across workspace
- **M-001:** Auth type matching uses string literals -- centralized in `PluginAuth::display_name()` + `Display` impl
- **M-002:** OAuth token expiry not checked on load -- expiry checks added in both `load_token()` and `resolve_header()`
- **L-001:** Settings saved to localStorage instead of config file -- frontend now uses Tauri IPC to persist to `config.json`

---

## Review History

| Commit | Date | Score | Rating |
|--------|------|-------|--------|
| ebb9643 | 2026-03-26 | 68/100 | Acceptable |
| 6c7538b | 2026-03-26 | 85/100 | Good |
| 0fb86a3 | 2026-03-26 | 52/100 | Acceptable |
| 102813b | 2026-03-25 | 88/100 | Good |
| 6ebae60 | 2026-03-25 | 58/100 | Acceptable |
| e4ca382 | 2026-03-25 | 82/100 | Good |
| ba492ce | 2026-03-25 | 42/100 | Needs Improvement |
