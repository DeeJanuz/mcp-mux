# Install MCPViews

MCPViews gives AI agents a visual companion window. Install the desktop app, connect your agent, and set up rules — all in under 5 minutes.

---

## Download

All installers are available on the [GitHub Releases](https://github.com/DeeJanuz/mcpviews/releases/latest) page.

### macOS (Apple Silicon)

1. Download **[MCPViews.dmg](https://github.com/DeeJanuz/mcpviews/releases/latest/download/MCPViews_0.2.1_aarch64.dmg)** from the latest release
2. Open the `.dmg` and drag MCPViews to your Applications folder
3. Launch MCPViews — it starts a local server on `http://localhost:4200`

> **Note:** On first launch, macOS may show a security prompt. Go to **System Settings > Privacy & Security** and click **Open Anyway**.

### Windows

Choose one:

| Installer | Format | Download |
|-----------|--------|----------|
| Setup wizard | `.exe` | [MCPViews_setup.exe](https://github.com/DeeJanuz/mcpviews/releases/latest/download/MCPViews_0.2.1_x64-setup.exe) |
| MSI package | `.msi` | [MCPViews.msi](https://github.com/DeeJanuz/mcpviews/releases/latest/download/MCPViews_0.2.1_x64_en-US.msi) |

Run the installer and launch MCPViews from your Start menu.

### Linux

Linux builds are not yet available as pre-built packages. Build from source:

```bash
# Install prerequisites (Debian/Ubuntu)
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

# Fedora
sudo dnf install webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel

# Arch
sudo pacman -S webkit2gtk-4.1 libappindicator-gtk3 librsvg

# Clone and build
git clone https://github.com/DeeJanuz/mcpviews.git
cd mcpviews
npm install
npm run build
```

The built application will be in `src-tauri/target/release/bundle/`.

---

## Next Steps

Once MCPViews is running, follow these steps in order.

### 1. Connect your AI agent

Add MCPViews as an MCP server in your agent's configuration. MCPViews runs a Streamable HTTP server on `http://localhost:4200/mcp`.

**Claude Code** — add to your global or project `.claude/settings.json`:
```json
{
  "mcpServers": {
    "mcpviews": {
      "type": "url",
      "url": "http://localhost:4200/mcp"
    }
  }
}
```

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "mcpviews": {
      "url": "http://localhost:4200/mcp"
    }
  }
}
```

**Cursor / Windsurf / other MCP clients** — point to `http://localhost:4200/mcp` as a Streamable HTTP MCP server.

### 2. Run setup

In your first conversation after connecting, tell your agent:

```
Call the mcpviews_setup tool to configure MCPViews for this agent.
```

This does two things:
- **Persists session-start rules** so `init_session` is called automatically in every future conversation (e.g., creates `.claude/rules/mcpviews-init.md` for Claude Code)
- **Returns renderer documentation and behavioral rules** so the agent knows how to use the companion window

> **This step is required.** Without it, your agent won't know MCPViews is available or how to use its renderers.

### 3. Verify it works

Ask your agent to push something to the companion window:

```
Push a rich_content display with the title "Hello MCPViews" and a short welcome message.
```

You should see the content appear in the MCPViews companion window.

### 4. Install plugins

Plugins extend MCPViews with tools from third-party MCP servers. Browse and install them through your agent:

```
Call list_registry to see available MCPViews plugins.
```

To install a plugin with authentication in one step:

```
Call mcpviews_install_plugin with trigger_auth: true to install [plugin name].
```

Or use the **GUI**: click the MCPViews system tray icon and select **Manage Plugins**.

---

## After Updating MCPViews

When you update to a new version of MCPViews:

1. **Re-run setup** to refresh your agent's rules with any new tool definitions or behavioral changes:
   ```
   Call the mcpviews_setup tool to update MCPViews rules for this agent.
   ```

2. **Check for plugin updates** — new MCPViews versions may include plugin compatibility changes:
   ```
   Call update_plugins to check for and apply available plugin updates.
   ```

---

## Troubleshooting

### MCPViews not connecting

- Verify the server is running: `curl http://localhost:4200/health`
- Check that port 4200 is not blocked by a firewall or used by another process
- Restart MCPViews from the system tray

### Agent doesn't use MCPViews tools

- Confirm the MCP server config points to `http://localhost:4200/mcp`
- Run `mcpviews_setup` again to re-persist the session-start rules
- Check that `init_session` is being called at the start of each conversation

### macOS security warning

Go to **System Settings > Privacy & Security**, scroll to the security section, and click **Open Anyway** next to the MCPViews message.

---

## Useful Links

- [Plugin Development Guide](plugin-development.md) — build your own plugins
- [Plugin System Reference](plugins.md) — manifest schema and auth reference
- [API Reference](api-reference.md) — HTTP and MCP tool documentation
- [Architecture](architecture.md) — system design and internals
- [Changelog](../CHANGELOG.md) — release notes
