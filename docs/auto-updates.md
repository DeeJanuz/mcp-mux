# Auto Updates

MCPViews checks GitHub releases on startup and every four hours while the desktop app is running. The in-app banner only considers releases that meet all of these criteria:

- The GitHub release is not a draft.
- The GitHub release is not marked as a GitHub pre-release.
- The tag is a newer SemVer release candidate, such as `v0.2.5-rc.12`.
- The release includes a `latest.json` asset for the Tauri updater.

The `Install and re-launch` action uses Tauri's signed updater flow. Release builds must embed the updater public key:

```bash
export MCPVIEWS_UPDATER_PUBLIC_KEY="contents of the Tauri updater public key"
export TAURI_SIGNING_PRIVATE_KEY="path to or contents of the private signing key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="optional password"
npm run build
```

The private signing key must never be committed. Store it in the release runner's secret store. The public key is safe to embed in the app and is picked up by `src-tauri/build.rs`.

`src-tauri/tauri.conf.json` has `bundle.createUpdaterArtifacts` enabled. Each RC release should upload the app installers plus the generated updater artifacts and `latest.json` to the matching GitHub release. The release workflow publishes RCs as normal GitHub releases, not GitHub pre-releases, so the update checker can distinguish supported release candidates from other pre-release channels. The changelog button opens that release page.

## Local Banner Testing

In debug builds, set `MCPVIEWS_DEV_UPDATE=1` to force a mock RC update without calling GitHub:

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
