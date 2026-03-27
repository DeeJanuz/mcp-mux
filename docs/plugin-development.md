# Plugin Development Guide

This guide walks you through creating a plugin for MCP Mux, from a minimal manifest to a full plugin with custom renderers, authentication, and registry publishing.

## Architecture Overview

```mermaid
graph TD
    subgraph "AI Agent"
        A[Claude / MCP Client]
    end

    subgraph "MCP Mux Desktop App"
        B["/mcp endpoint<br/>(Streamable HTTP)"]
        C["Tool Dispatch<br/>(mcp_tools.rs)"]
        D["Plugin Registry<br/>(plugin.rs)"]
        E["Tool Cache<br/>(tool_cache.rs)"]
        F["Renderer Scanner<br/>(renderer_scanner.rs)"]
        G["Auth Resolver<br/>(PluginAuth)"]
        H["WebView<br/>(renderers/*.js)"]
    end

    subgraph "Plugin MCP Server"
        I["Your MCP Server<br/>(HTTP endpoint)"]
    end

    subgraph "Filesystem"
        J["~/.mcp-mux/plugins/<br/>manifest.json + renderers/"]
        K["~/.mcp-mux/auth/<br/>tokens"]
        L["~/.mcp-mux/cache/<br/>tool lists"]
    end

    A -->|"POST /mcp<br/>(JSON-RPC)"| B
    B --> C
    C -->|"Built-in tool?"| H
    C -->|"Plugin tool?"| D
    D --> E
    E -->|"Cache miss"| I
    D --> G
    G -->|"Resolve token"| K
    G -->|"Proxy call"| I
    I -->|"Tool result"| C
    C -->|"Map to renderer"| H
    D -->|"Load manifests"| J
    E -->|"Persist"| L
    F -->|"Discover custom JS"| J
```

## Plugin Lifecycle

```mermaid
sequenceDiagram
    participant User
    participant MuxApp as MCP Mux
    participant Disk as ~/.mcp-mux/plugins/
    participant PluginMCP as Plugin MCP Server
    participant Agent as AI Agent

    Note over User,Agent: Installation
    User->>MuxApp: Install plugin (CLI or GUI)
    MuxApp->>Disk: Write manifest.json
    MuxApp->>MuxApp: Load into PluginRegistry

    Note over User,Agent: Tool Discovery
    Agent->>MuxApp: POST /mcp (tools/list)
    MuxApp->>PluginMCP: initialize + tools/list
    PluginMCP-->>MuxApp: Tool definitions
    MuxApp->>MuxApp: Prefix tool names, cache results
    MuxApp-->>Agent: Built-in + plugin tools

    Note over User,Agent: Tool Execution
    Agent->>MuxApp: POST /mcp (tools/call "myplugin_search")
    MuxApp->>MuxApp: Strip prefix, resolve auth
    MuxApp->>PluginMCP: tools/call "search"
    PluginMCP-->>MuxApp: Result JSON
    MuxApp->>MuxApp: Map tool → renderer
    MuxApp->>MuxApp: Push to WebView
    MuxApp-->>Agent: Tool result
```

## Quick Start: Minimal Plugin

The simplest plugin is a JSON manifest with no MCP server -- it only maps existing tools to renderers.

### 1. Create the manifest

Create `my-plugin/manifest.json`:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "renderers": {}
}
```

### 2. Install it

```bash
# Copy to the plugins directory
mkdir -p ~/.mcp-mux/plugins/my-plugin
cp manifest.json ~/.mcp-mux/plugins/my-plugin/

# Or use the CLI
mcp-mux-cli plugin add-custom ./manifest.json
```

### 3. Verify

```bash
mcp-mux-cli plugin list
```

## Full Plugin: MCP Server + Renderers + Auth

### Step 1: Build an MCP Server

Your server must implement the [Model Context Protocol](https://spec.modelcontextprotocol.io/) over HTTP. MCP Mux connects via Streamable HTTP and performs this handshake:

1. `POST /mcp` with `initialize` request
2. `POST /mcp` with `notifications/initialized`
3. `POST /mcp` with `tools/list` to discover available tools

Any MCP SDK (TypeScript, Python, Rust, etc.) can be used. Example with the TypeScript SDK:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer({
  name: "my-analysis-server",
  version: "1.0.0",
});

server.tool("analyze_code", { path: z.string() }, async ({ path }) => {
  const results = await performAnalysis(path);
  return {
    content: [{ type: "text", text: JSON.stringify(results) }],
  };
});
```

### Step 2: Choose Renderers

MCP Mux ships with built-in renderers for general-purpose content. Domain-specific renderers are delivered via plugins (e.g., the [Ludflow plugin](https://github.com/DeeJanuz/ludflow-mcp-mux) provides renderers for code analysis, data governance, and knowledge management).

#### Built-in Renderers

These are general-purpose renderers bundled with MCP Mux. If no renderer is specified for a tool, `rich_content` is used as the default fallback.

| Renderer | Best For | Data Shape |
|----------|----------|------------|
| `rich_content` | Markdown, mermaid diagrams, general text | `{ title?, body, citations? }` |
| `document_preview` | Rendered markdown document | `{ title, content, status? }` |
| `document_diff` | Two-column diff with accept/reject | `{ operations: [{ type, target, replacement }] }` |
| `citation_panel` | Citation list (used as sub-component) | `{ citations: {} }` |

#### Plugin-Provided Renderers

Plugins can bundle their own renderers as JavaScript files in a `renderers/` subdirectory (see [Custom Renderers](#advanced-custom-renderers) below). For example, the Ludflow plugin provides these renderers:

| Renderer | Best For | Data Shape |
|----------|----------|------------|
| `search_results` | Grouped search results with type chips | `{ results: [{ type, items }] }` |
| `code_units` | Source code with complexity badges | `{ units: [{ name, source, complexity }] }` |
| `module_overview` | File tree + exports + dependencies | `{ files, exports, dependencies }` |
| `analysis_stats` | Metric cards + repository list | `{ stats: {}, repositories? }` |
| `knowledge_dex` | Table with bulk accept/reject | `{ entries: [{ name, type, status }] }` |
| `data_schema` | Expandable table/column view | `{ tables: [{ name, columns }] }` |
| `column_context` | Breadcrumb navigation + related entities | `{ breadcrumb, column, related }` |
| `data_draft_diff` | Grid-based draft review | `{ columns: [], changes: {} }` |
| `dependencies` | Grouped imports by source file | `{ dependencies: [{ file, imports }] }` |
| `file_content` | Source with line numbers | `{ path, content, language? }` |

### Step 3: Configure Authentication

Choose one of three auth types:

**Bearer Token** (simplest -- recommended for API keys):
```json
{
  "type": "bearer",
  "token_env": "MY_API_KEY"
}
```

**API Key** (custom header):
```json
{
  "type": "api_key",
  "header_name": "X-Custom-Key",
  "key_env": "MY_SERVICE_KEY"
}
```

**OAuth** (browser redirect flow):
```json
{
  "type": "oauth",
  "client_id": "abc123",
  "auth_url": "https://provider.com/authorize",
  "token_url": "https://provider.com/token",
  "scopes": ["read", "write"]
}
```

Token resolution order:
1. Stored token from `~/.mcp-mux/auth/<plugin-name>.json` (set via GUI prompt on install)
2. Environment variable fallback (`token_env` / `key_env`)

For OAuth, MCP Mux handles the full redirect flow, token storage, and automatic refresh.

### Step 4: Write the Manifest

```json
{
  "name": "my-analysis-tool",
  "version": "1.0.0",
  "renderers": {
    "analyze_code": "code_units",
    "search_files": "search_results",
    "get_summary": "rich_content"
  },
  "mcp": {
    "url": "http://localhost:9000/mcp",
    "auth": {
      "type": "bearer",
      "token_env": "MY_TOOL_API_KEY"
    },
    "tool_prefix": "mytool_"
  }
}
```

The `tool_prefix` is prepended to all your tool names to avoid collisions. An agent sees `mytool_analyze_code`; MCP Mux strips the prefix before forwarding to your server as `analyze_code`.

### Step 5: Test Locally

```bash
# Install the plugin
mcp-mux-cli plugin add-custom ./my-analysis-tool.json

# Verify it loaded
mcp-mux-cli plugin list

# Test a tool directly via the push API
curl -X POST http://localhost:4200/api/push \
  -H 'Content-Type: application/json' \
  -d '{
    "toolName": "code_units",
    "result": {
      "data": {
        "units": [{"name": "test_fn", "source": "fn test() {}", "complexity": 1}]
      }
    }
  }'
```

## Advanced: Custom Renderers

If the built-in renderers don't fit your data, you can bundle custom renderer JavaScript files with your plugin.

### Renderer File Structure

```
my-plugin/
  manifest.json
  renderers/
    my-custom-view.js
```

### Writing a Custom Renderer

Renderers register on `window.__renderers` and export a `render(data, container)` function:

```javascript
(function () {
  'use strict';

  window.__renderers = window.__renderers || {};

  window.__renderers['my_custom_view'] = {
    render: function (data, container) {
      // data = the tool result's data field
      // container = DOM element to render into

      var heading = document.createElement('h2');
      heading.textContent = data.title || 'Custom View';
      container.appendChild(heading);

      var content = document.createElement('div');
      content.innerHTML = data.body || '';
      container.appendChild(content);
    }
  };
})();
```

### Accessing Custom Renderers

Custom renderer JS files are served via the `plugin://` URI scheme:

```
plugin://localhost/{plugin-name}/renderers/{file-name}.js
```

The renderer scanner (`renderer_scanner.rs`) automatically discovers JS files in each plugin's `renderers/` directory. Map your tools to the custom renderer in the manifest:

```json
{
  "renderers": {
    "my_special_tool": "my_custom_view"
  }
}
```

## Advanced: Agent Rule Bootstrapping

Plugins can provide behavioral rules that AI agents persist for guided tool usage. This is done via two manifest fields:

### renderer_definitions

Structured metadata about your renderers, used by the `setup_agent_rules` MCP tool:

```json
{
  "renderer_definitions": [
    {
      "name": "my_custom_view",
      "description": "Custom visualization for analysis results",
      "scope": "universal",
      "tools": [],
      "data_hint": "{ \"title\": \"string\", \"body\": \"markdown\" }",
      "rule": "When displaying analysis results, use push_content with tool_name 'my_custom_view'."
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `scope` | `"universal"` = any agent can use it. `"tool"` = tied to specific MCP tools. |
| `tools` | For tool-scoped renderers: which tool names trigger this renderer. |
| `data_hint` | JSON schema hint so agents know what data to pass. |
| `rule` | Behavioral rule text returned by `setup_agent_rules`. |

### tool_rules

Per-tool behavioral rules (tool names are auto-prefixed):

```json
{
  "tool_rules": {
    "analyze_code": "Always include the file path when calling this tool.",
    "search_files": "Limit results to 50 items for performance."
  }
}
```

## Suppressing Auto-Push for Mutation Tools

By default, when a plugin tool is called, MCP Mux auto-pushes the result to the companion window. This works well for read/query tools whose results benefit from rich rendering. However, mutation tools (writes, deletes, management operations) typically return thin confirmation responses like `{"success": true}` that overwrite the current companion display with empty or broken previews.

Use the `no_auto_push` field to declare which tools should skip auto-push:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "no_auto_push": [
    "write_document",
    "delete_document",
    "manage_settings"
  ],
  "mcp": { ... }
}
```

Tools listed in `no_auto_push` still return their results to the calling agent normally -- only the automatic companion window push is suppressed. The coordinator agent can still explicitly push content via `push_content` when appropriate.

## ZIP Plugin Packages

For distribution, plugins can be packaged as ZIP archives:

```
my-plugin.zip
  manifest.json
  renderers/
    my-custom-view.js
  assets/
    icon.png
```

**Conventions:**
- The ZIP must contain a valid `manifest.json`
- GitHub release pattern: if all files share a single top-level directory, it's automatically stripped during extraction
- Zip-slip protection: paths containing `..` are rejected
- Max download size: 50MB for remote downloads

Plugins are extracted to `~/.mcp-mux/plugins/{plugin-name}/`.

### Distributing via Download URL

Add a `download_url` to your registry entry pointing to the ZIP:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My analysis plugin",
  "download_url": "https://github.com/you/my-plugin/releases/download/v1.0.0/my-plugin.zip",
  "manifest": { ... }
}
```

## Publishing to the Registry

To list your plugin in the official registry:

1. Create a `RegistryEntry` with your manifest, description, and tags:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Short description for search results and the GUI",
  "author": "Your Name",
  "homepage": "https://github.com/you/my-plugin",
  "tags": ["analysis", "code-quality"],
  "manifest": {
    "name": "my-plugin",
    "version": "1.0.0",
    "renderers": { ... },
    "mcp": { ... }
  }
}
```

2. Submit a pull request to the registry repository adding your entry to `registry.json`.

## Hosting a Private Registry

Organizations can host their own plugin registries. A registry is a JSON file with this structure:

```json
{
  "version": "1",
  "plugins": [ ... ]
}
```

Configure MCP Mux to use it by editing `~/.mcp-mux/config.json`:

```json
{
  "registry_sources": [
    { "name": "Default", "url": "https://...", "enabled": true },
    { "name": "Internal", "url": "https://corp.example.com/registry.json", "enabled": true }
  ]
}
```

Multiple sources are merged; last source wins on name conflicts. Each source has its own 1-hour disk cache.

## Complete Example Manifest

A full-featured plugin manifest with all optional fields:

```json
{
  "name": "acme-analysis",
  "version": "2.1.0",
  "renderers": {
    "analyze_code": "code_units",
    "search_files": "search_results",
    "get_overview": "module_overview",
    "custom_report": "acme_report"
  },
  "renderer_definitions": [
    {
      "name": "acme_report",
      "description": "Custom ACME analysis report with charts and metrics",
      "scope": "tool",
      "tools": ["custom_report"],
      "data_hint": "{ \"title\": \"string\", \"metrics\": [{\"name\": \"string\", \"value\": \"number\"}], \"body\": \"markdown\" }",
      "rule": "Use push_content with tool_name 'acme_report' when displaying analysis reports."
    }
  ],
  "tool_rules": {
    "analyze_code": "Always specify language parameter for best results.",
    "search_files": "Limit to 100 results per call."
  },
  "no_auto_push": [
    "write_report",
    "delete_analysis"
  ],
  "mcp": {
    "url": "https://api.acme.com/mcp",
    "auth": {
      "type": "oauth",
      "client_id": "acme-mux-plugin",
      "auth_url": "https://auth.acme.com/authorize",
      "token_url": "https://auth.acme.com/token",
      "scopes": ["read", "analyze"]
    },
    "tool_prefix": "acme_"
  }
}
```

## Troubleshooting

**Plugin not loading:**
- Check `mcp-mux-cli plugin list` -- is it listed?
- Look at the MCP Mux logs for `[mcp-mux] Failed to parse plugin` errors
- Verify `manifest.json` is valid JSON with required `name` and `version` fields

**Tools not appearing:**
- Ensure your MCP server is running and accessible at the configured URL
- Tool discovery has a 5-minute cache TTL -- use `POST /api/reload-plugins` to force refresh
- Check that `tool_prefix` is set (required for MCP plugins)

**Auth failures:**
- Bearer/API Key: check the environment variable is set, or configure via the Plugin Manager GUI
- OAuth: verify `auth_url` and `token_url` are correct and the redirect flow completes
- Tokens are stored in `~/.mcp-mux/auth/<plugin-name>.json` -- delete this file to re-authenticate

**Custom renderer not rendering:**
- Verify the JS file is in `{plugin-dir}/renderers/` with a `.js` extension
- Check that the renderer key in `window.__renderers['key']` matches the `renderers` mapping in the manifest
- The `plugin://` URI scheme must be accessible -- check the Tauri dev tools console for errors

**Hot reload:**
- `POST /api/reload-plugins` reloads all plugins from disk
- Connected MCP clients receive a `notifications/tools/list_changed` notification
