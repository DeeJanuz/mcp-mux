# Native Build UI Debug Loop

Use this workflow when debugging the MCPViews AI chat surface in the real desktop client. The current dirty working tree is the artifact under test, so do not stash, reset, checkout, clean, or otherwise remove local changes before building.

For repeatable user-invoked test passes, use `docs/native-ai-thread-test-workflow.md`; that workflow starts by asking what the test focus should be, then follows this native build path.

## Command

```sh
npm run debug:native-build
```

The command:

1. Stops listeners on `1420` so Vite is not serving the UI.
2. Stops any existing listener on `4200` so the fresh built app owns the MCP server port.
3. Runs `npm run build -- --target aarch64-apple-darwin --bundles app` from the current dirty branch, producing the app bundle without waiting on DMG packaging.
4. Launches the fresh local app binary:

```text
target/aarch64-apple-darwin/release/bundle/macos/MCPViews.app/Contents/MacOS/mcpviews
```

5. Enables `MCPVIEWS_ENABLE_LOCAL_AI_DEBUG=1` for that launched process. This exposes the local-only `POST /api/debug/first-party-ai` compatibility proxy through the running app's configured hosted AI provider session for debugging UI/runtime divergence.
6. Prints the launched process id, the built app path, and the log file path.

## Inspection

After launch, inspect the real client with Computer Use against bundle id `com.mcpviews.app`. Capture screenshots after meaningful UI interactions, then compare the visible state with terminal logs and runtime state when behavior looks wrong.

If macOS shows the previous-crash reopen dialog, choose `Don't Reopen` for a clean debug window unless the test specifically needs window restoration.

Use the debug proxy only as a support tool when the native WebView and backend disagree or the accessibility bridge cannot reach a control. It should confirm or unblock a diagnosis; screenshots from the real app remain the source of truth for visual quality.

## Validation Checklist

- `lsof -nP -iTCP:1420 -sTCP:LISTEN` is empty.
- `lsof -nP -iTCP:4200 -sTCP:LISTEN` shows the newly launched `mcpviews` process.
- The app path is `target/aarch64-apple-darwin/release/bundle/macos/MCPViews.app`.
- The bundle timestamp reflects the fresh local build.
- Screenshots are captured from the native app, not the browser harness.

## Browser Harness Role

The browser harness is still useful for fast deterministic regression checks after a native-client issue is understood. It is not proof for native WebView timing, secure storage, window lifecycle, real MCP relay transport, or the full desktop app/client integration.
