# Native AI Thread Test Workflow

Use this workflow when the user asks to repeat the MCPViews native AI thread test process.

Use [AI Chat UX Pattern](./ai-chat-ux-pattern.md) as the behavior contract for timeline order, latest-action placement, and scroll anchoring during AI thread validation.

## First Step

Ask the user what the focus of the test should be before rebuilding or launching anything. Keep the question short, then wait for the answer.

## Procedure

After the user gives the focus:

1. Preserve the dirty working tree exactly as-is. Do not stash, reset, checkout, clean, or normalize local changes.
2. Run any focused automated checks that directly cover the requested area.
3. Run `npm run debug:native-build` from `/Users/daenonjanis/projects/mcpviews`.
4. Confirm `1420` is not serving Vite and `4200` is owned by the freshly launched `mcpviews` process.
5. Confirm the launched app path is `target/aarch64-apple-darwin/release/bundle/macos/MCPViews.app/Contents/MacOS/mcpviews` and the app bundle timestamp reflects the fresh build.
6. Use Computer Use against bundle id `com.mcpviews.app` to inspect and drive the actual macOS client.
7. Capture screenshots after each meaningful interaction, especially after scrolls, review decisions, resume flows, and completed runs.
8. Compare visible UI state against logs and runtime state whenever behavior diverges.
9. Record what passed, what looked janky, and what still needs a fix.

## Browser Harness Role

Use the browser harness only after the native-client issue is understood, and only to pin deterministic regressions. The native app remains the proof path for Tauri WebView behavior, app lifecycle, real MCP relay transport, secure storage, screenshots, and interaction quality.
