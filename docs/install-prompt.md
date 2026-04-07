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
2. After restart, paste the **verification prompt** (next section) into the
   agent to confirm the server is reachable

Do not restart the tool yourself — ask me to do it.

---

## Verification prompt — paste after restarting your tool

Copy this into a new session of your agent tool (after fully restarting it):

> Verify that the MCPViews MCP server is installed and reachable.
>
> 1. Check that an MCP server named `mcpviews` is in your available tool list.
> 2. Call the `init_session` tool from the `mcpviews` server (the exact
>    surfacing name depends on your tool — it may appear as `init_session`,
>    `mcpviews__init_session`, `mcpviews.init_session`, or similar).
> 3. Report:
>    - Whether the server is listed in your tools
>    - Whether `init_session` returned successfully
>    - If either failed: the exact error, the config file path, and any
>      relevant logs so I can debug

---

## After verification — continue setup

Once verification succeeds, there are two more steps documented in
[`install.md`](./install.md):

1. **Run `mcpviews_setup`** — persists session-start rules so `init_session`
   is called automatically in every future conversation, and returns renderer
   docs + behavioral rules.
2. **Install plugins** — call `list_registry` to browse available plugins,
   then `mcpviews_install_plugin` to install them.
