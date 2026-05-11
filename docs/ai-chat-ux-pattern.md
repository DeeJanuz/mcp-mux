# AI Chat UX Pattern

Status: design contract for the hosted AI thread surface, review renderers, and any future chat-like renderer in MCPViews.

## Purpose

The AI chat is a chronological work surface. It should feel like a single thread that the user can read from top to bottom, with the newest required action always discoverable near the bottom of the conversation. Scroll behavior, review placement, and action controls should be owned by one shared pattern instead of by one-off renderer decisions.

This document is the product and engineering baseline for future AI chat UX work. When implementation details conflict with this pattern, update the pattern deliberately or change the implementation to match it.

## Fundamental Philosophies

1. The thread is a timeline, not a dashboard. Events should appear in the order the user and agent experienced them.
2. The newest required action belongs at the bottom. A user should not have to hunt near the top of the chat for the thing blocking progress.
3. Action controls need one home. Primary decisions such as submit, continue, approve, reject, retry, or check status should appear in a consistent bottom action area.
4. User scroll intent wins. If the user scrolls up to read history, background updates must not yank the viewport away.
5. Scroll has one owner. A chat surface should have exactly one vertical scroller responsible for anchoring, jump affordances, and activity heartbeats.
6. Reviews are content plus decision state. Embedded review renderers may own local row, cell, or suggestion decisions, but the chat shell owns primary placement for final submit and resume actions.
7. Streaming updates should be anchored, not destructive. Live token updates should preserve the current viewport and avoid remounting stable review or editor DOM.
8. Automation should be visible and intentional. Programmatic scrolls should happen only because the user is already following the bottom, just sent a message, opened a thread, submitted an action, or clicked an explicit jump control.
9. Special cases must plug into the contract. A new renderer can add richer content, but it should not create a separate scroll or action model inside the chat.
10. Native interaction quality is the acceptance test. Browser harness checks are useful regressions, but native Tauri/WebView behavior is the proof path for scroll and review UX.

## User-Facing Nomenclature

Use language that matches how a person experiences the chat. Do not expose `session` as the primary label for AI work in the thread UI; it describes runtime, review, companion, or transport infrastructure, not the user's mental model.

- **Thread**: the full conversation.
- **Request**: one user prompt or intentional follow-up. This is the top-level timeline unit and should be labeled `Request N` when a numbered label is needed.
- **Activity**: work the AI performs inside a request, including tool calls, delegated work, file edits, test runs, and generated artifacts.
- **Decision** or **Action required**: a user checkpoint inside the request, such as a review, approval, auth step, or continue control.
- **Queued follow-up**: a user message submitted while the active request is still running.
- **Result**: the assistant's answer or completion output for a request.

Reserve **session** for internal or developer-facing contexts where it is literally correct: MCP review sessions, runtime sessions, companion sessions, auth sessions, and transport sessions. In the AI chat surface, prefer request/activity/decision language so one prompt with multiple pauses or delegated turns still feels like one coherent piece of work.

## Canonical Layout

The chat surface has four conceptual regions:

1. Timeline: the single vertical scroll container for messages, tool events, review cards, queued context, and completion events.
2. Latest action dock: a stable bottom area directly above the composer that summarizes and controls the newest pending user action.
3. Composer: the user's message entry point, fixed at the bottom of the thread layout.
4. Secondary artifact area: side panels or drawers for large artifacts. These should not steal the primary review or resume controls from the thread.

The timeline and action dock are part of the same conversational model. The dock may mirror the latest pending action for convenience, but the corresponding action event still exists inline in the timeline at the point it occurred.

## Timeline Ordering

Render events linearly from oldest to newest. Do not hoist blockers, reviews, or approval cards above newer context.

Expected event order examples:

- User prompt
- Assistant progress or streamed answer
- Tool call activity
- Delegated work activity
- Review prepared
- Action required
- Queued follow-up context
- User decision submitted
- Assistant resume progress
- Final answer or completion event

If multiple actions are pending, the newest pending action is represented in the dock. Older pending actions remain inline and can be reached by navigation from the dock, but they should not force the entire thread to jump to the top.

## Action Placement

Primary action controls belong in the latest action dock:

- Submit decisions
- Continue or resume
- Approve all / reject all when they apply to the current review package
- Retry or check status
- Open external auth or permission flows

Inline controls are still appropriate when the decision is local to a visible item:

- Row or cell accept/reject controls
- Inline suggestion accept/reject controls
- Per-item comments or edits
- Table filtering, sorting, and expansion controls

When a renderer is embedded in the AI thread, it should expose decision state to the shell instead of creating its own vertical sticky submit bar. A renderer may keep a standalone submit bar when used outside the chat surface.

## Scroll State Machine

Use explicit scroll state instead of inferring everything from raw `scrollTop`.

- `pinned_to_latest`: default after opening a thread, sending a prompt, submitting an action, or clicking jump to latest. Streaming content and appended events keep the bottom anchored.
- `reading_history`: entered when the user scrolls above the near-bottom threshold or uses wheel, touch, trackpad, or keyboard navigation to inspect older content. Background updates preserve the viewport.
- `action_waiting`: a pending user action exists. If the user is pinned, reveal the latest action at the bottom. If the user is reading history, show the dock and jump affordance without moving the viewport.
- `programmatic_reveal`: temporary state after an explicit jump to latest or jump to action. After the scroll completes, settle into `pinned_to_latest` if the viewport is near the bottom, otherwise `reading_history`.

Programmatic scrolling is allowed only for:

- Initial open of a thread.
- Local send when the user was already at the latest point.
- Streaming or appended content while `pinned_to_latest`.
- Explicit jump to latest or jump to action.
- Resume progress immediately after the user submits an action.

Programmatic scrolling is not allowed for:

- A new blocker arriving while the user is reading history.
- Background hydration, polling, or status refresh.
- Renderer remounts.
- Streaming token updates after the user has broken the bottom pin.

## Renderer Contract

The chat shell owns:

- The single vertical scroller.
- The latest action dock.
- Primary submit, resume, retry, and status placement.
- Jump to latest and jump to action affordances.
- Heartbeat/activity tracking tied to the actual timeline scroller.

Embedded renderers own:

- Rendering their domain content.
- Local decision state for rows, cells, suggestions, or sections.
- Exposing decision summaries and submit payloads through stable APIs.
- Horizontal overflow where needed for dense tables.

Embedded renderers should avoid:

- Nested vertical scroll regions inside the thread.
- Sticky top submit bars inside the chat.
- Programmatic scrolling of the outer chat.
- Full DOM remounts that reset selection, editor focus, staged decisions, or scroll anchors.

## Implementation Slices

1. Establish a shared chat scroll controller with explicit `pinned_to_latest`, `reading_history`, `action_waiting`, and `programmatic_reveal` states.
2. Render blockers and review-required events as chronological timeline events instead of top-hoisted sections.
3. Add a single latest action dock above the composer and route primary review/resume controls through it.
4. Normalize structured-data and rich-content review integrations so chat uses shell-owned primary controls while standalone reviews can keep their own submit bars.
5. Retire or map legacy bottom-blocker, jump-latest, and top-sticky review patterns to the canonical layout.
6. Add browser harness and native workflow checks for pinned streaming, reading-history preservation, action arrival, jump controls, staged review stability, and heartbeat reset.

## Acceptance Tests

- While pinned to latest, streaming content follows the bottom smoothly.
- While reading older content, streaming and polling preserve the user's viewport.
- A new review or blocker appears as the latest timeline event and is represented in the bottom action dock.
- A new action does not move the viewport when the user is reading history.
- Jump to latest and jump to action are explicit and predictable.
- Submit, continue, retry, and status controls appear in the same bottom action area across review types.
- Staged review decisions survive polling, streaming, and renderer refreshes.
- Timeline scroll resets the review heartbeat and does not depend on a parent scroll event that may not fire.
- Native testing confirms the behavior in the real Tauri WebView, not only in the browser harness.
