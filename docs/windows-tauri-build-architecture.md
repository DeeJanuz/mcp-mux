# Windows/Tauri Cross-Platform Build Architecture

This document is the required starting point for MCPViews work that touches
Windows, macOS, Tauri windows or webviews, installers, updaters, native panels,
browser/auth launch, release packaging, or Windows validation. MCPViews should
deliver the same user experience on macOS and Windows, but the implementation
is allowed to diverge behind explicit platform boundaries when the OS runtime,
webview engine, installer, or Tauri capability model requires it.

Do not treat a successful macOS build, browser harness run, or mocked Tauri
frontend test as proof that Windows works. Windows readiness requires Windows
runtime evidence.

## Shared UX Contract

The user-facing contract is shared across macOS and Windows. A platform-specific
implementation can differ only if it preserves this contract.

- The Apps menu opens from the same control, appears in the same visual location
  relative to the toolbar, lists the same app groups and renderers, closes
  predictably on selection or escape, and never hides or corrupts mounted app
  panels.
- Plugin Manager uses the same labels, beta/public update language, install
  states, auth affordances, error messages, and reset/update behavior.
- Renderer launch uses the same renderer names, labels, event payloads, session
  metadata, selected tab behavior, and visible title text.
- Embedded external app panels use the same session chrome, bounds contract,
  loading state, focus behavior, close behavior, and return-to-MCPViews behavior.
- Auth and browser flows open the same user-visible URLs, preserve query
  parameters, complete token storage the same way, and produce the same recovery
  messaging when the external browser or callback fails.
- Updater and installer UX uses the same release labels, stable DecidR aliases,
  install/relaunch language, and manual fallback behavior.
- Window lifecycle behavior is shared: launch, hide-to-tray, restore, focus,
  close, reopen, update banner, plugin reload, and crash recovery should feel
  identical even when the OS implementation differs.
- Visual parity is required for first-viewport layout, menus, popups, mounted
  web panels, scroll behavior, focus outlines, disabled states, modal overlays,
  and update/auth surfaces.

## Platform Adapter Boundaries

Platform differences should be isolated behind named adapters. Avoid scattering
one-off `cfg(target_os)` branches through unrelated UI or workflow code.

- Shared JavaScript and renderer code owns intent, state, labels, renderer names,
  event names, user-visible strings, session metadata, command payload shapes,
  and visual contract tests.
- Rust/Tauri platform code owns OS-specific window creation, child webview
  composition, custom protocol URL form, Tauri capabilities, native bounds,
  focus/lifecycle behavior, browser launching, installer configuration, updater
  artifact selection, and WebView2 assumptions.
- Shared release workflow code owns version resolution, asset naming, stable
  DecidR aliases, updater metadata, and common artifact checks.
- Platform workflow steps own OS-specific build flags, signing/notarization,
  Windows version coercion, WebView2 installer mode, and runtime smoke evidence.

Use adapter names that describe the behavior boundary:

- `apps_popup`: Apps menu popup/dropdown implementation, including capabilities,
  focus, close-on-blur, event routing, and fallback behavior.
- `native_panel`: mounted plugin/app panels, including child webview composition,
  bounds, visibility, stacking, DPI scaling, and focus.
- `external_web_panel`: browser-like embedded tabs, return URL sentinels, panel
  close requests, and trusted native fetch fallbacks.
- `auth_browser`: external browser launch, URL escaping, callback handling, token
  storage, and retry/recovery messaging.
- `installer_update`: Windows/macOS installer formats, updater artifacts, stable
  aliases, signatures, release metadata, and manual fallback downloads.
- `custom_protocols`: plugin renderer URL construction, CSP, cache busting, and
  protocol handler assumptions.

If an implementation must differ by platform, keep the shared call site stable
and route to a named adapter. The caller should ask for "open apps popup" or
"mount native panel", not care whether the implementation uses a child webview,
a separate native window, DOM fallback, WebView2-specific protocol URL, or
macOS WebKit behavior.

## Known OS Differences

These differences require intentional design. Do not paper over them with a
small patch unless the decision is recorded.

- macOS uses WebKit through WKWebView; Windows uses Microsoft Edge WebView2.
  Rendering, focus, compositor stacking, popup windows, input routing, and
  child webview behavior can differ even when the HTML/CSS/JS is identical.
- Tauri custom protocol URLs differ by platform. MCPViews already accounts for
  plugin renderer URLs that look like `plugin://localhost/...` on macOS and
  `https://plugin.localhost/...` on Windows. CSP, fetch, cache busting, and
  renderer scanning must continue to support both URL forms.
- Tauri capabilities are per window/webview. Any new window label, such as
  `apps-popup`, must be included in an appropriate capability before its webview
  can invoke Tauri commands. A webview or window with no matching capability has
  no IPC access.
- Child webview and native panel behavior differs across OSs. Stacking order,
  offscreen hiding, `always_on_top`, parent/child window attachment, focus loss,
  resize timing, bounds updates, and close-on-blur must be validated on Windows.
- DPI and coordinate systems can diverge. Bounds adapters must explicitly handle
  scale factor, logical vs physical coordinates, monitor offsets, and tiny or
  hidden bounds.
- External browser launch must be platform-specific. Windows URLs must avoid
  shell parsing failures for characters such as `&`, `%`, quotes, and spaces.
- Windows installer and updater artifacts differ from macOS artifacts. Windows
  uses MSI/NSIS assets and signatures, while macOS uses app bundles, DMGs, and
  updater archives. Version coercion for Windows installer compatibility must be
  explicit and tested.
- WebView2 is a runtime dependency. Windows 11 normally includes the Evergreen
  runtime, but installer policy must still document whether MCPViews uses the
  default bootstrapper, minimum WebView2 version, fixed runtime, or skip mode.
- Windows 11 ARM in VMware Fusion is valuable for interactive proof. When a
  change is sensitive to x64-only behavior, add targeted x64 validation or make
  a specific platform decision before claiming coverage.

## Platform Divergence Record

Every intentional macOS/Windows divergence needs a short record in the PR,
commit notes, or the relevant architecture/design doc. Use this template.

```md
### Platform Decision: <surface or adapter>

- Identical UX required:
- Why shared implementation is unsafe or insufficient:
- macOS implementation:
- Windows implementation:
- Shared tests:
- macOS verification evidence:
- Windows verification evidence:
- Follow-up risk:
```

Do not merge a divergence that only says "Windows needed a patch." Name the
runtime behavior, the shared UX contract, and the Windows evidence.

### Platform Decision: Apps Popup Lifecycle

- Identical UX required: the Apps control opens the shared menu model from the
  same toolbar affordance, keeps labels/grouping/selection identical, closes
  predictably, and must not block minimize, tray quit, or interaction with other
  Windows apps.
- Why shared implementation is unsafe or insufficient: the native always-on-top
  `apps-popup` WebView window can survive after the main Windows window is
  minimized, leaving a blank orphaned surface that traps interaction and
  prevents reliable tray quit.
- macOS implementation: use the in-window DOM Apps dropdown for the main toolbar
  launcher. Embedded Ludflow app tabs must use the authenticated DOM iframe
  embed path instead of a child native WebView, because child WebViews sit above
  parent DOM and cannot be z-indexed under the launcher without hiding the app.
  Plugin Manager `AUTH OK` only proves MCP/plugin auth; Ludflow iframe tabs also
  require the Ludflow app's Better Auth web-session handoff to complete.
- Windows implementation: the `apps_popup` adapter declines native popup
  creation and the shared frontend opens the DOM Apps dropdown instead.
- Shared tests: Apps menu rendering/model tests plus routing tests that assert
  the main-window dropdown opens without native popup IPC and does not mutate
  native app panel bounds while opening.
- macOS verification evidence: local Rust/frontend tests are required; macOS
  runtime smoke remains a separate release evidence item.
- Windows verification evidence: this decision is based on VMware Fusion
  Windows evidence of the orphaned blank popup after minimize, followed by a
  later VMware and human Windows QA pass confirming the release candidate no
  longer blocks interaction.
- Follow-up risk: reintroduce a native Windows popup only after WebView2 focus,
  parent/minimize, close-on-blur, and tray-quit behavior pass VMware and human
  Windows QA evidence. WebDriver automation is a backlogged discovery item, not
  a current hard gate.

### Platform Decision: Embedded Native App Panels

- Identical UX required: opening Ludflow or another embedded app from the Apps
  menu creates a normal MCPViews tab, keeps tab switching/closing available,
  allows the Apps launcher to reopen, and does not leave blank or orphaned
  WebView surfaces over the shell.
- Why shared implementation is unsafe or insufficient: Windows WebView2 child
  panels can render blank and continue hit-testing above MCPViews shell UI,
  blocking the DOM Apps dropdown even when the main tab bar remains partially
  usable.
- macOS implementation: expose `mountNativeAppView`,
  `updateNativeAppViewBounds`, and `closeNativeAppView` so plugin renderers can
  mount native child WebViews inside viewport-owned tabs when that surface is
  appropriate. Ludflow app renderers intentionally avoid this bridge in normal
  tab views and use their authenticated DOM iframe handoff instead, preserving
  launcher stacking without exposing Better Auth tokens to plugin JavaScript.
- Windows implementation: do not expose the child native panel bridge to
  renderer code. Ludflow uses the same authenticated DOM iframe handoff as
  macOS, so Windows does not need child native panels for the launcher-safe
  embedded app path.
- Shared tests: session routing tests assert native panel support remains
  available on the default/macOS-like runtime and is not exposed for a Windows
  runtime user agent.
- macOS verification evidence: local frontend tests are required; macOS runtime
  smoke remains a separate release evidence item.
- Windows verification evidence: prior VMware Fusion Windows evidence showed
  child WebView panels could render blank and block the Apps launcher while only
  tab switching/closing still worked. That keeps Windows native panels disabled
  for Ludflow until a native-panel-capable adapter passes VM-first validation.
- Follow-up risk: re-enable Windows child panels only after WebView2 child
  WebView loading, stacking, hit-testing, focus, and bounds updates pass VMware
  and human Windows QA evidence. WebDriver automation is a backlogged discovery
  item, not a current hard gate.

## VM-First Windows Validation

The first Windows proof loop is the local VMware Fusion VM. Use it before any
deep Windows refactor is called ready.

Known local VM:

```text
/Users/daenonjanis/Virtual Machines.localized/Windows 11 64-bit Arm.vmwarevm/Windows 11 64-bit Arm.vmx
```

Fusion automation entrypoint:

```text
/Applications/VMware Fusion.app/Contents/Library/vmrun
```

Minimum VM validation evidence:

- Start or resume the VM and confirm VMware Tools state when guest automation is
  needed.
- Install or run the exact Windows artifact under test. Prefer the artifact from
  GitHub Actions or the published release over a locally copied partial build.
- Capture the MCPViews version, artifact name, installer type, and whether the
  VM is exercising ARM-native behavior or x64 emulation.
- Launch MCPViews and capture a screenshot of the main window after it is ready.
- Open the Apps control and capture the popup/dropdown populated with expected
  app groups and renderer entries.
- Select a renderer and verify that the session opens with the expected title,
  session metadata, and visible renderer output.
- Exercise at least one mounted native/external app panel path if the change
  touches panels, popups, window focus, bounds, or embedded app surfaces.
- Exercise plugin auth/browser launch if the change touches auth URLs, callback
  handling, token storage, or external browser behavior.
- Exercise updater/install UI if the change touches release metadata, latest
  aliases, updater signatures, install/relaunch, or manual fallback.
- Save screenshots and notes with the commit, PR, release checklist, or DecidR
  validation record.

Do not store guest usernames, passwords, or VM encryption passwords in this repo.
If `vmrun` guest automation is added later, credentials must come from local
environment variables or a private secret manager.

## Human QA Gate

After the VMware Fusion smoke passes, stop and hand the artifact plus evidence
to a human tester for an interactive Windows QA pass. CI release readiness is
blocked until the tester signs off or every blocking issue is filed, fixed, and
re-smoked.

Human QA handoff package:

- Exact artifact name, version, release flavor, installer type, and architecture
  notes from the VMware smoke.
- Screenshots for launch, Apps popup/dropdown, renderer launch, native/external
  panels, auth/browser launch, and updater/manual fallback when touched.
- App logs, VM notes, and any known limitations or skipped checks.
- A checklist that asks the tester to repeat the smoke interactively, exercise
  focus/resize/close behavior, confirm user-visible labels and errors, and
  explicitly mark pass/fail with blocking issues.

Do not replace this QA pass with macOS validation, mocked Tauri tests, or the
browser harness. macOS validation remains a separate regression check; Windows
readiness needs Windows runtime evidence.

## Backlogged CI WebDriver Discovery

Windows WebDriver automation with `tauri-driver` and Edge Driver is a
backlogged discovery item, not a mandatory release gate. Revisit it when the
team needs more Windows automation than VMware plus human QA can provide, or
when x64-specific behavior needs repeatable CI coverage.

Discovery should answer:

- What paid CI/runtime cost does WebDriver add per release?
- Which bugs would it catch that VMware plus human QA would likely miss?
- Can it run only on demand or nightly instead of every release build?
- Which smoke paths are stable enough to avoid false release blockers?
- What artifacts would it upload, and who would review them?

If adopted later, the automation should build or install the same MCPViews
artifact shape that release users receive, launch the real Tauri app with
`tauri-driver`, and retain screenshots, app logs, WebDriver logs, and artifact
metadata. Until then, the existing browser harness and mocked frontend tests
remain useful for fast regressions, but they do not prove Windows Tauri/WebView2
behavior.

## Architecture Findings For The Next Refactor

These are not fixed by this document; they are inputs to the next implementation
phase.

- The current release pipeline builds Windows artifacts and runs frontend/Rust
  tests, but it does not launch the Windows app or prove the user-visible
  Windows UI path.
- The recent Apps popup patch introduced a new Tauri window label,
  `apps-popup`, whose script invokes Tauri IPC. Confirm the final refactor gives
  that window an explicit capability or routes the popup through an adapter that
  does not require IPC from an unlisted window.
- Current panel/popup behavior should be reworked behind `apps_popup` and
  `native_panel` adapters so the UX contract is shared while macOS and Windows
  can use different composition mechanics.
- Windows release evidence should be separated from macOS updater evidence in
  release and governance notes. A tag, published release, or macOS smoke test is
  not Windows UX proof.

## References

- Tauri Tests: https://v2.tauri.app/develop/tests/
- Tauri WebDriver CI: https://v2.tauri.app/develop/tests/webdriver/ci/
- Tauri Capabilities: https://v2.tauri.app/reference/acl/capability/
- Tauri Windows Installer: https://v2.tauri.app/distribute/windows-installer/
- Microsoft WebView2 distribution: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- Tauri Updater: https://v2.tauri.app/plugin/updater/
