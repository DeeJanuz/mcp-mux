# Technical Debt & Enhancement Log

**Last Updated:** 2026-03-26
**Total Active Issues:** 6
**Resolved This Month:** 9

---

## Active Issues

### Critical

_None_

### High

#### H-005: Duplicated install/update orchestration in commands.rs
- **File(s):** `src-tauri/src/commands.rs` (install_plugin_from_registry, update_plugin)
- **Principle:** SRP / DRY
- **Description:** `install_plugin_from_registry` and `update_plugin` contain near-identical logic: download zip via `download_and_install_plugin`, remove existing plugin from registry, add new manifest, emit `reload_renderers`. This duplication means bug fixes or flow changes must be applied in two places.
- **Suggested Fix:** Extract a shared `install_or_update_plugin(client, entry, registry, app_handle)` helper function or service that both commands delegate to.
- **Detected:** 2026-03-26 (commit 0fb86a3)

#### H-006: No tests for new Tauri commands and HTTP handlers
- **File(s):** `src-tauri/src/commands.rs`, `src-tauri/src/http_server.rs`
- **Principle:** Quality / Reliability
- **Description:** New commands (`install_plugin_from_registry`, `install_plugin_from_zip`, `update_plugin`, `get_registry_sources`, `add_registry_source`, `remove_registry_source`, `toggle_registry_source`, `get_plugin_renderers`) and HTTP handlers (`mcp_sse_handler`, `mcp_post_handler`, `mcp_delete_handler`, `reload_plugins_handler`) have no test coverage. These handle critical plugin lifecycle and MCP transport operations.
- **Suggested Fix:** Add integration/unit tests, at minimum for the orchestration logic. Consider extracting testable service layers from the Tauri command wrappers.
- **Detected:** 2026-03-26 (commit 0fb86a3)

### Medium

#### M-003: PluginStore instantiated as concrete dependency in PluginRegistry methods
- **File(s):** `src-tauri/src/plugin.rs` (add_plugin, remove_plugin, load_plugins)
- **Principle:** DIP
- **Description:** `PluginStore::new()` is constructed inline within `PluginRegistry` methods. While `PluginStore` has a `with_dir()` constructor for tests, the `PluginRegistry` itself cannot be tested for add/remove behavior without hitting the real filesystem. Injecting the store or passing it as a parameter would improve testability.
- **Suggested Fix:** Accept a `PluginStore` reference (or a trait) in `PluginRegistry::new()` / `load_plugins()`, or store it as a field.
- **Detected:** 2026-03-25 (commit e4ca382)

#### M-006: detect_content_type is effectively dead code
- **File(s):** `src-tauri/src/http_server.rs` (detect_content_type)
- **Principle:** SRP / Dead Code
- **Description:** After removing all specific tool-name mappings, `detect_content_type` now returns `"rich_content"` for every input. The function and its match statement serve no purpose.
- **Suggested Fix:** Replace with a constant `const DEFAULT_CONTENT_TYPE: &str = "rich_content"` or remove entirely.
- **Detected:** 2026-03-26 (commit 0fb86a3)

#### M-007: reload_plugins_handler mixes HTTP and plugin lifecycle concerns
- **File(s):** `src-tauri/src/http_server.rs` (reload_plugins_handler)
- **Principle:** SRP
- **Description:** The HTTP handler directly constructs a `PluginRegistry`, replaces shared state, and broadcasts SSE notifications. This mixes three concerns: HTTP request handling, plugin registry lifecycle, and notification dispatch.
- **Suggested Fix:** Extract reload logic into a method on `AppState` or a dedicated service, have the HTTP handler call it.
- **Detected:** 2026-03-26 (commit 0fb86a3)

### Low

#### L-002: Settings stored/loaded as raw serde_json::Value
- **File(s):** `src-tauri/src/commands.rs` (get_settings, save_settings)
- **Principle:** Type Safety / OCP
- **Description:** `save_settings` replaces the entire config.json with whatever JSON is passed from the frontend. As settings grow, this risks accidental key loss and lacks compile-time validation. A typed `Settings` struct would be safer.
- **Suggested Fix:** Define a `Settings` struct in the shared crate with typed fields, serialize/deserialize through it.
- **Detected:** 2026-03-25 (commit e4ca382)

---

## Resolved Issues

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
| 0fb86a3 | 2026-03-26 | 52/100 | Acceptable |
| 102813b | 2026-03-25 | 88/100 | Good |
| 6ebae60 | 2026-03-25 | 58/100 | Acceptable |
| e4ca382 | 2026-03-25 | 82/100 | Good |
| ba492ce | 2026-03-25 | 42/100 | Needs Improvement |
