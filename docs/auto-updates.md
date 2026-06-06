# Auto Updates

MCPViews checks GitHub releases on startup and every four hours while the desktop app is running. Update checks start independently from renderer/session startup so a renderer load failure does not block app-update detection. The in-app banner only considers releases that meet all of these criteria:

- The GitHub release is not a draft.
- The GitHub release is not marked as a GitHub pre-release.
- The tag is a newer SemVer version, such as `v0.2.5`.
- The release includes a `latest.json` asset for the Tauri updater.

The banner has three user-visible states:

- **Installable**: `Install and re-launch` uses Tauri's signed updater flow.
- **Manual required**: `Download update` opens the platform installer from the same GitHub release. This appears for older builds that can detect an update but were built without the updater public key.
- **Check failed**: `Try again` re-runs the GitHub release check. Dismissed failure banners are throttled locally so transient offline or rate-limit errors do not reappear on every startup.

The `Install and re-launch` action requires release builds to embed the updater public key:

```bash
export MCPVIEWS_UPDATER_PUBLIC_KEY="contents of the Tauri updater .pub file"
export TAURI_SIGNING_PRIVATE_KEY="path to or contents of the private signing key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="optional password"
npm run build
```

The private signing key must never be committed. Store it in the release runner's secret store as `TAURI_SIGNING_PRIVATE_KEY`; the optional password belongs in `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The public key is safe to embed in the app and is picked up by `src-tauri/build.rs` from `MCPVIEWS_UPDATER_PUBLIC_KEY`, which the GitHub release workflow reads from an environment variable or secret and injects into `tauri.conf.json` before building updater artifacts. Use the encoded Tauri `.pub` file contents, not only the inner `RW` key line. The runtime install path also accepts the decoded two-line public key text and encodes it before verifying update signatures.

`src-tauri/tauri.conf.json` has `bundle.createUpdaterArtifacts` enabled. Each release should upload the app installers plus the generated updater artifacts and `latest.json` to the matching GitHub release. The release workflow publishes update-eligible builds as normal GitHub releases, not GitHub pre-releases, so the update checker can ignore unsupported pre-release channels. The changelog button opens that release page.

The release workflow must fail if a packaged app still contains the `development-placeholder` updater key or if the validated `MCPVIEWS_UPDATER_PUBLIC_KEY` value is not embedded in the production binary. If an already-installed app was built with the placeholder key, it may require one manual installer download before future signed in-app updates work.

## Local Banner Testing

In debug builds, set `MCPVIEWS_DEV_UPDATE=1` to force a mock update without calling GitHub:

```bash
MCPVIEWS_DEV_UPDATE=1 npm run dev
```

Optionally set `MCPVIEWS_DEV_UPDATE_VERSION=0.2.5-rc.99` to control the displayed version. The mock update uses a private `mcpviews-dev://mock/latest.json` URL that is only accepted while the debug-only flag is enabled. Clicking `Install and re-launch` in this mode simulates a successful install and does not relaunch or modify the installed app.

For a repeatable desktop UI test, use the dedicated launcher. It builds and runs a debug app bundle with the mock update flag, uses an alternate local HTTP port, and gives the app a separate bundle identifier so it can run beside an installed MCPViews copy:

```bash
npm run dev:update-test
```

If another MCPViews copy already owns port 4200, run the debug app on a temporary HTTP port:

```bash
MCPVIEWS_DEV_UPDATE=1 MCPVIEWS_DEV_HTTP_PORT=44200 npm run dev
```
