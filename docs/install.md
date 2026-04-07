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

The canonical, copy-paste install flow lives in **[install-prompt.md](./install-prompt.md)**. Open that file, copy the entire prompt block, and paste it into your agent (Claude Code, Codex CLI, Cursor, Windsurf, OpenCode, or Antigravity). The agent will detect which tool it is running inside and write the correct user-level MCP config for you.

<details>
<summary>Show the install prompt inline</summary>

# MCPViews Agent Install Prompt

Copy this entire block and paste it into **Claude Code**, **Codex CLI**, **Cursor**, **Windsurf**, **OpenCode**, or **Antigravity**. The agent will register the MCPViews MCP server in your user-level (global) config for that tool.

> **Prerequisite:** MCPViews must already be installed and running. Check that it is in your system tray and that `curl -sSf http://localhost:4200/health` returns OK. If not, launch MCPViews first.

> **Claude Desktop users:** See the Claude Desktop section at the end — you can either run this prompt inside Claude Code (which will write the Desktop config for you) or follow the manual JSON copy-paste instructions.

---

## Paste everything below this line

Register the MCPViews MCP server for me at **user / global scope** so it is
available in every project I work on.

### Prerequisite check

Before doing anything, verify MCPViews is running:

```bash
curl -sSf http://localhost:4200/health
```

If that command fails or times out, stop and tell me to launch MCPViews from
my Applications folder (macOS), Start Menu (Windows), or by running the dev
build (Linux). Do not proceed until the health check returns successfully.

### Step 1 — Detect which agent tool you are running inside

Look at your environment, available tools, and shell config paths to determine
whether you are one of:

- Claude Code
- Codex CLI
- Cursor
- Windsurf
- OpenCode
- Antigravity
- Claude Desktop (unusual: you would typically only be able to install Desktop
  from a **different** agent tool, since Desktop cannot self-install)

If you cannot determine the tool with confidence, stop and ask me.

### Step 2 — Register MCPViews using the canonical config for the detected tool

Before writing anything: **read the target config file first** and check
whether an `mcpviews` entry already exists. If it does, **stop and ask me**
whether to **overwrite**, **skip**, or **merge** — do not decide on my behalf.

Scope boundaries:
- Only modify the `mcpviews` entry. Preserve all other MCP server entries and
  unrelated keys in the file exactly as they are.
- Only modify user/global config. Do not touch any project-level MCP config.
- If the config file does not exist yet, create it with only the `mcpviews`
  entry.

#### Claude Code

Use the native CLI. Do not edit config files directly.

```bash
claude mcp add \
  --transport http \
  --scope user \
  mcpviews \
  http://localhost:4200/mcp
```

To check for existing: `claude mcp list | grep mcpviews`

#### Cursor

Edit `~/.cursor/mcp.json` (the **user-level** file in your home directory, NOT
`.cursor/mcp.json` in any project). Add under `mcpServers`:

```json
{
  "mcpServers": {
    "mcpviews": {
      "url": "http://localhost:4200/mcp"
    }
  }
}
```

#### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`. Add under `mcpServers`:

```json
{
  "mcpServers": {
    "mcpviews": {
      "url": "http://localhost:4200/mcp"
    }
  }
}
```

#### Codex CLI

Edit `~/.codex/config.toml`. Append this block:

```toml
[mcp_servers.mcpviews]
type = "http"
url = "http://localhost:4200/mcp"
```

#### OpenCode

Edit `~/.config/opencode/opencode.json`. Add under the top-level `mcp` key
(note: **`mcp`**, not `mcpServers`):

```json
{
  "mcp": {
    "mcpviews": {
      "url": "http://localhost:4200/mcp"
    }
  }
}
```

#### Antigravity

Edit `~/.gemini/antigravity/mcp_config.json`. Add under `mcpServers`:

```json
{
  "mcpServers": {
    "mcpviews": {
      "url": "http://localhost:4200/mcp"
    }
  }
}
```

#### Claude Desktop (special case — stdio bridge required)

Claude Desktop **cannot speak Streamable HTTP** to MCP servers. It requires a
stdio bridge via the `mcp-remote` proxy.

Edit:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

Add under `mcpServers`:

```json
{
  "mcpServers": {
    "mcpviews": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:4200/mcp"]
    }
  }
}
```

This requires Node.js / npx to be available on the user's PATH. If it is not,
tell me to install Node.js first.

### Step 3 — Verify the config was written

After writing, re-read the target config file and confirm the `mcpviews` entry
is present with the correct shape. Report:

1. The exact file path you modified (or the `claude mcp add` command that
   succeeded)
2. The resulting entry, verbatim
3. Confirmation that no other entries in the file were changed

### Step 4 — Tell me what to do next

Explain that MCP servers are only loaded at tool startup, so I need to:

1. **Fully quit and relaunch** the agent tool (not just open a new session /
   new tab / new window — the entire process must restart)
2. After restart, paste the **verification prompt** into the agent to confirm
   the server is reachable

Do not restart the tool yourself — ask me to do it.

</details>

#### Claude Desktop (manual fallback)

Claude Desktop cannot speak Streamable HTTP and must use the `mcp-remote` stdio bridge. If you'd rather edit JSON by hand than run the agent prompt, edit:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

And add under `mcpServers`:

```json
{
  "mcpServers": {
    "mcpviews": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:4200/mcp"]
    }
  }
}
```

Requires Node.js / `npx` on your PATH.

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

After restarting your agent tool, ask it to call the `init_session` tool from the `mcpviews` server. The agent should report that the server is listed in its tools and that `init_session` returned successfully. See the verification prompt in [install-prompt.md](./install-prompt.md#verification-prompt--paste-after-restarting-your-tool) for the exact wording.

As a bonus check, you can also ask the agent to push a `rich_content` display with a short welcome message — it should appear in the MCPViews companion window.

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

> **Legacy:** The bundled `setup-integrations.sh` / `.ps1` script in `src-tauri/scripts/` is deprecated and will be removed in the next release. New installs should use the agent install prompt above.


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
