# MCP Mux

A standalone Tauri v2 desktop app that serves as a rich display for AI agents. Replaces the companion Node.js server with a native app featuring system tray, auto-start, and a built-in HTTP push API.

## Architecture

- **Rust backend** (axum): HTTP server on `:4200` for push API + review workflow
- **WebView frontend**: Vanilla JS renderers (ported from companion) for 14+ content types
- **Node.js sidecar**: SSE bridge for remote server connections
- **System tray**: Hide-to-tray, click to show, auto-start on login

## Development

```bash
# Install dependencies
npm install

# Dev mode (hot reload frontend + Rust backend)
npm run dev

# Build frontend only
npm run build:frontend

# Build Rust backend only (from src-tauri/)
cargo build

# Build full Tauri app (frontend + backend + installer)
npm run build
```

## Testing the Push API

```bash
# Health check
curl http://localhost:4200/health

# Push rich content
curl -X POST http://localhost:4200/api/push \
  -H 'Content-Type: application/json' \
  -d '{"toolName":"rich_content","result":{"data":{"title":"Test","body":"## Hello\n\nThis is a test."}}}'

# Push with review (blocks until user decides)
curl -X POST http://localhost:4200/api/push \
  -H 'Content-Type: application/json' \
  -d '{"toolName":"write_document","result":{"data":{"operations":[{"type":"replace","target":"Introduction","replacement":"New intro text"}]}},"reviewRequired":true}'
```

## SSE Sidecar

Connects to a remote app's companion stream and forwards events to the local HTTP server.

```bash
# Build
cd sidecar && bash build.sh

# Run
node sidecar/dist/sse-bridge.mjs --app-host https://app.example.com --key lf_companion_xxx
```

## Project Structure

```
mcp-mux/
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs         # Tauri entry, tray, plugin setup
│   │   ├── http_server.rs  # axum HTTP server (:4200)
│   │   ├── session.rs      # In-memory session store
│   │   ├── review.rs       # Pending review channels (oneshot)
│   │   ├── commands.rs     # Tauri IPC commands
│   │   └── state.rs        # Shared app state
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                    # Frontend (Vite entry)
│   └── index.html          # HTML shell
├── public/                 # Static assets (copied to dist)
│   ├── main.js             # App bootstrap (Tauri IPC)
│   ├── styles.css          # All styles
│   └── renderers/          # 14 content renderers
├── sidecar/                # Node.js SSE bridge
│   ├── sse-bridge.ts
│   └── build.sh
├── package.json
└── vite.config.ts
```
