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
- Windows 11 ARM in VMware Fusion is valuable for interactive proof, but it is
  not the same as release-grade x64 proof. x64 Windows behavior still needs a
  real x64 environment or GitHub `windows-latest` WebDriver validation.

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

## Later CI WebDriver Gate

After the VM-first loop is stable, add Windows WebDriver to the release pipeline.
This should become the hard gate before Windows assets are blessed.

Required shape:

- Run on GitHub `windows-latest` so the test executes in a real Windows x64
  runtime.
- Install the Windows WebDriver dependency such as Edge WebDriver, following
  Tauri's WebDriver CI guidance.
- Build or install the same MCPViews artifact shape that release users receive.
- Launch the real Tauri app with `tauri-driver`; do not substitute the Vite
  browser harness for native WebView2 behavior.
- Run smoke/parity tests for launch, Apps popup/dropdown, renderer selection,
  plugin manager, mounted external panel, updater banner/manual fallback, and
  auth/browser URL launch where feasible.
- Upload screenshots, app logs, WebDriver logs, and artifact metadata.
- Fail the Windows release lane when the runtime smoke path fails. macOS success
  alone must not publish or bless Windows artifacts.

The existing browser harness and mocked frontend tests remain useful for fast
regressions, but they do not prove Windows Tauri/WebView2 behavior.

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
