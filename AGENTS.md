# AGENTS.md

This project inherits the global Codex rules from `/Users/daenonjanis/AGENTS.md` and `/Users/daenonjanis/projects/AGENTS.md`.

## Windows/Tauri Cross-Platform Architecture

Before changing Windows or macOS Tauri behavior, release packaging, installers, updaters, native windows, WebViews, custom protocols, capabilities, popups, native panels, external web panels, auth/browser launch, or the release workflow, read `docs/windows-tauri-build-architecture.md`.

MCPViews must preserve one shared user experience across macOS and Windows while allowing platform-specific implementation behind named adapters. Do not add scattered one-off platform branches without recording the shared UX contract, the macOS implementation, the Windows implementation, and Windows runtime verification evidence. Mac-only validation, browser harness checks, and mocked Tauri tests are not proof that Windows is ready.

## Native Build AI Visual Debug Workflow

When debugging or validating the MCPViews AI chat surface, prefer a local native build from the current dirty working tree. The dirty branch is the source of truth because it contains the code actively under development. Do not stash, reset, checkout, clean, or otherwise normalize the tree before building unless the user explicitly asks for that.

Before launching the native build, stop any Vite dev server listening on `1420` and any existing `mcpviews` process listening on `4200`. Build with `npm run build`, then launch the fresh local app at `target/aarch64-apple-darwin/release/bundle/macos/MCPViews.app/Contents/MacOS/mcpviews` so terminal logs are available. The helper command `npm run debug:native-build` performs this stop-build-launch sequence and writes the app log path to stdout.

Use Computer Use against bundle id `com.mcpviews.app` to inspect the real macOS client, capture screenshots, click through the actual WebView, and adjust interactions based on visible state. If macOS shows the previous-crash reopen dialog, choose `Don't Reopen` for a clean debug window unless the user asks to recover old windows.

The native debug helper enables `MCPVIEWS_ENABLE_LOCAL_AI_DEBUG=1` for the launched app. This exposes the local-only `POST /api/debug/first-party-ai` proxy through the running app's own first-party AI session so agents can compare backend state with visible WebView state when the UI or accessibility bridge becomes stale. Use this proxy as a diagnostic and recovery aid, not as a replacement for Computer Use screenshots.

The browser harness remains useful only as a fast deterministic regression aid after a native-client issue is understood. It does not prove native Tauri WebView timing, secure storage, window lifecycle, real MCP relay transport, or the real app/client integration.

## Repeatable Native AI Thread Test Workflow

When the user asks to repeat the MCPViews native AI thread test workflow, first ask what the focus of this test pass should be. After the user answers, follow `docs/native-ai-thread-test-workflow.md`: preserve the dirty tree, rebuild and launch the local native app, inspect the real macOS client with Computer Use, capture screenshots after meaningful interactions, compare visible state with logs/runtime state, and only use the browser harness afterward for pinned regressions.
