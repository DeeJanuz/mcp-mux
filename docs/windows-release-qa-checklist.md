# MCPViews Windows Release QA Checklist

Use this checklist after the VMware Fusion smoke passes and before treating the
Windows CI release lane as ready.

## VMware Smoke Evidence

- Artifact name:
- MCPViews version:
- Release flavor:
- Installer type:
- Guest architecture and runtime mode:
- VM path:
  `/Users/daenonjanis/Virtual Machines.localized/Windows 11 64-bit Arm.vmwarevm/Windows 11 64-bit Arm.vmx`
- Screenshots captured:
  - Launch-ready main window
  - Apps popup/dropdown
  - Renderer launch with expected title
  - Native app panel when touched
  - External web panel when touched
  - Auth/browser URL launch when touched
  - Updater/manual fallback when touched
- Logs captured:
- Known skipped checks:

## Local VMware Fusion Setup

Known local VM:

```text
/Users/daenonjanis/Virtual Machines.localized/Windows 11 64-bit Arm.vmwarevm/Windows 11 64-bit Arm.vmx
```

Baseline state:

- VMware Tools installed successfully.
- Baseline snapshot exists: `mcpviews-clean`.
- The VM is partially encrypted, so `vmrun` commands need the encrypted VM
  password via `-vp`.

Use the local helper:

```bash
scripts/vmware-fusion-windows-smoke.sh status
scripts/vmware-fusion-windows-smoke.sh snapshots
scripts/vmware-fusion-windows-smoke.sh revert
scripts/vmware-fusion-windows-smoke.sh run-guest 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -NoProfile -Command 'exit 0'
scripts/vmware-fusion-windows-smoke.sh copy-to-guest ./MCPViews_setup.exe 'C:\Users\Public\Downloads\MCPViews_setup.exe'
scripts/vmware-fusion-windows-smoke.sh file-exists 'C:\Users\Public\Downloads\MCPViews_setup.exe'
```

The helper reads the encrypted VM password from `MCPVIEWS_VM_PASSWORD` first, or
from a Keychain generic password item with service
`mcpviews-vmware-vm-password`. It also auto-loads `.env` from this repo or the
parent Tribe-X workspace and supports these aliases:

- `vmware_encryption_passcode` for the encrypted VM password.
- `vmware_user` for the Windows guest username.
- `vmware_password` for the Windows guest password.
- `vmware_windows_pin` for interactive Windows sign-in when needed.

Create the Keychain item manually if needed:

```bash
read -r -s VMWARE_VM_PASSWORD
security add-generic-password -a "$USER" -s "mcpviews-vmware-vm-password" -w "$VMWARE_VM_PASSWORD"
unset VMWARE_VM_PASSWORD
```

Guest automation also needs `MCPVIEWS_VM_USER` and `MCPVIEWS_VM_PASS` in the
local shell or private secret manager. Do not store guest credentials in this
repo.

Use `run-guest` for non-interactive automation. Use `run-guest-interactive`
only when the configured Windows user matches the account currently logged into
the guest desktop; VMware Tools rejects interactive launches for a different
active desktop user.

## Human QA Gate

Release readiness is blocked until a human tester records one of these outcomes:

- Pass: all checks below pass on Windows.
- Blocked: blocking issues are filed and linked.
- Re-smoked: blocking issues are fixed and the VMware smoke plus relevant human
  QA checks pass again.

Human tester:
Date:
Outcome:
Blocking issue links:

## Interactive Windows QA Checks

- Install or run the exact artifact from the VMware smoke.
- Confirm the app launches to the main MCPViews shell without blank WebView,
  crash, or broken first viewport layout.
- Open Apps and confirm grouping, labels, empty/error state, and close-on-escape.
- Select an available renderer and confirm the tab title, visible renderer
  output, and session metadata behavior match macOS.
- Exercise native/external app panel focus, resize, hide/show, and close behavior
  for any touched panel surface.
- Exercise auth/browser launch for any touched auth flow and confirm the URL is
  complete, including query parameters.
- Exercise update banner, install/relaunch, or manual fallback behavior for any
  touched updater surface.
- Reopen the app after close/hide and confirm window lifecycle behavior is
  stable.

## CI Release Gate

After human QA passes or blocking issues are resolved, the Windows release lane
must still pass the `windows-latest` WebDriver smoke against the real Tauri app.
Upload and retain screenshots, `tauri-driver` logs, WebDriver logs, and artifact
metadata with the release run.
