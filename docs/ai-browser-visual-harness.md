# AI Browser Visual Harness

Use the Codex browser harness only as a fast deterministic regression aid after a native-client issue is understood. For primary MCPViews AI chat debugging, use the native build workflow in [Native Build UI Debug Loop](./native-build-ui-debug-loop.md) so the real Tauri app is built from the current dirty working tree and inspected with Computer Use.

## URL

```text
http://localhost:1420/?mcpviews_harness=ai&scenario=review-churn
```

`npm run debug:ai-browser-harness` prints the same URL.

Add `latency=realistic` when you need the browser harness to feel closer to the desktop app's real review delay:

```text
http://localhost:1420/?mcpviews_harness=ai&scenario=review-churn&latency=realistic
```

Latency profiles:

- `fast`: compressed debug loop; review appears in about two seconds.
- `realistic`: review appears after roughly a minute with intermittent runtime progress.
- `stall`: intentionally quiet before review to test “is it frozen?” recovery UX.
- `jitter`: randomized timings for race-condition and ordering checks.

## What It Covers

- Normal MCPViews shell, AI navigator, thread renderer, reducer, composer, and CSS.
- Deterministic hosted AI provider data for `Provider Contract Thread`.
- Submit, running, delegated subagent projection, review preparation, waiting-on-review, background churn, review submission, and completion states.
- Fast, realistic, stalled, and jittered latency profiles.
- Screenshot polling from the Codex in-app browser.

## What It Does Not Cover

- Native Tauri WebView timing.
- Real desktop MCP relay transport.
- Actual model, MCP tool, backend persistence, and review payload generation latency.
- Secure storage, native window lifecycle, and OS permission flows.

Use the native build workflow for those checks. The browser harness is intentionally narrower and should not be treated as proof that the real desktop client behaves correctly.

## Visual Debug Workflow

1. Use the native build workflow first when the issue may involve the real client.
2. Start the dev app with `npm run dev` only for fast browser-harness regression checks.
3. Open the harness URL in the Codex in-app browser.
4. Capture an initial screenshot of the mounted `Provider Contract Thread`.
5. Submit a prompt through the real composer.
6. Poll screenshots as the harness advances through `sending`, `delegating`, `preparing-review`, `waiting-on-review`, and `review-churn-*`.
7. Verify the review card remains stable while background refreshes happen.
8. For review decisions, prefer the same two-step interaction a human performs in the browser: click a decision control, capture a screenshot or `snapshot()` poll to confirm the staged state is stable, then click `Submit Decisions`.
9. Submit the review and continue polling through `assistant-answering` and `complete`.
10. Check `window.__MCPVIEWS_AI_BROWSER_HARNESS__.snapshot()` when DOM state needs to be compared to the screenshot.

## Regression Coverage

- `tests/structured-data-renderer.test.js` covers staged review clicks with a poll between the decision click and submit click.
- `tests/tribex-ai-thread.test.js` covers backend status polls while waiting on review, including no remounts of the review card or editor.
