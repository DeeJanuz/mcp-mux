#!/usr/bin/env bash
set -euo pipefail

DEFAULT_VM_PATH="/Users/daenonjanis/Virtual Machines.localized/Windows 11 64-bit Arm.vmwarevm/Windows 11 64-bit Arm.vmx"
DEFAULT_VMRUN="/Applications/VMware Fusion.app/Contents/Library/vmrun"
DEFAULT_KEYCHAIN_SERVICE="mcpviews-vmware-vm-password"
DEFAULT_KEYCHAIN_ACCOUNT="${USER:-mcpviews}"
DEFAULT_SNAPSHOT="mcpviews-clean"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_ROOT="$(cd "$REPO_ROOT/.." && pwd)"

ENV_FILE="${MCPVIEWS_VM_ENV_FILE:-}"
if [[ -z "$ENV_FILE" && -f "$REPO_ROOT/.env" ]]; then
  ENV_FILE="$REPO_ROOT/.env"
elif [[ -z "$ENV_FILE" && -f "$WORKSPACE_ROOT/.env" ]]; then
  ENV_FILE="$WORKSPACE_ROOT/.env"
fi

if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${MCPVIEWS_VM_PASSWORD:-}" && -n "${vmware_encryption_passcode:-}" ]]; then
  MCPVIEWS_VM_PASSWORD="$vmware_encryption_passcode"
fi
if [[ -z "${MCPVIEWS_VM_USER:-}" && -n "${vmware_user:-}" ]]; then
  MCPVIEWS_VM_USER="$vmware_user"
fi
if [[ -z "${MCPVIEWS_VM_PASS:-}" && -n "${vmware_password:-}" ]]; then
  MCPVIEWS_VM_PASS="$vmware_password"
fi
if [[ -z "${MCPVIEWS_VM_PIN:-}" && -n "${vmware_windows_pin:-}" ]]; then
  MCPVIEWS_VM_PIN="$vmware_windows_pin"
fi

VM_PATH="${MCPVIEWS_VM_PATH:-$DEFAULT_VM_PATH}"
VMRUN="${MCPVIEWS_VMRUN:-$DEFAULT_VMRUN}"
KEYCHAIN_SERVICE="${MCPVIEWS_VM_KEYCHAIN_SERVICE:-$DEFAULT_KEYCHAIN_SERVICE}"
KEYCHAIN_ACCOUNT="${MCPVIEWS_VM_KEYCHAIN_ACCOUNT:-$DEFAULT_KEYCHAIN_ACCOUNT}"
SNAPSHOT_NAME="${MCPVIEWS_VM_SNAPSHOT:-$DEFAULT_SNAPSHOT}"

usage() {
  cat <<USAGE
Usage: $0 <command> [args]

Commands:
  status                 Show running VMs and VMware Tools state.
  start                  Start the configured VM in the Fusion GUI.
  snapshots              List snapshots.
  snapshot [name]        Take a snapshot, default: ${DEFAULT_SNAPSHOT}.
  revert [name]          Revert to a snapshot, default: ${DEFAULT_SNAPSHOT}.
  copy-to-guest SRC DST  Copy a file from host to Windows guest.
  copy-from-guest SRC DST
                         Copy a file from Windows guest to host.
  file-exists PATH       Check whether a file exists in the Windows guest.
  dir-exists PATH        Check whether a directory exists in the Windows guest.
  list-guest-dir PATH    List a directory in the Windows guest.
  run-guest PROGRAM [args...]
                         Run a non-interactive program inside the Windows guest.
  run-guest-interactive PROGRAM [args...]
                         Run a program attached to the active Windows desktop.
  run-script INTERPRETER SCRIPT
                         Run a non-interactive script inside the Windows guest.
  capture-screen DST     Capture the VM screen to a local PNG.
  evidence-dir           Create and print a timestamped local evidence folder.

Configuration:
  MCPVIEWS_VM_PATH                 VMX path.
  MCPVIEWS_VMRUN                   vmrun path.
  MCPVIEWS_VM_PASSWORD             Encrypted VM password, preferred for CI/local shells.
  MCPVIEWS_VM_KEYCHAIN_SERVICE     Keychain service, default: ${DEFAULT_KEYCHAIN_SERVICE}.
  MCPVIEWS_VM_KEYCHAIN_ACCOUNT     Keychain account, default: current macOS user.
  MCPVIEWS_VM_USER                 Windows guest username, required for guest commands.
  MCPVIEWS_VM_PASS                 Windows guest password, required for guest commands.
  MCPVIEWS_VM_ENV_FILE             Optional .env path; defaults to repo .env, then parent workspace .env.
  MCPVIEWS_VM_SNAPSHOT             Snapshot name, default: ${DEFAULT_SNAPSHOT}.

Parent workspace .env aliases are also supported:
  vmware_encryption_passcode -> MCPVIEWS_VM_PASSWORD
  vmware_user                -> MCPVIEWS_VM_USER
  vmware_password            -> MCPVIEWS_VM_PASS
  vmware_windows_pin         -> MCPVIEWS_VM_PIN

Create the default Keychain item manually without writing the password to shell history:
  read -r -s VMWARE_VM_PASSWORD
  security add-generic-password -a "\$USER" -s "${DEFAULT_KEYCHAIN_SERVICE}" -w "\$VMWARE_VM_PASSWORD"
  unset VMWARE_VM_PASSWORD

The script never prints passwords.
USAGE
}

vm_password() {
  if [[ -n "${MCPVIEWS_VM_PASSWORD:-}" ]]; then
    printf '%s' "$MCPVIEWS_VM_PASSWORD"
    return
  fi
  security find-generic-password \
    -a "$KEYCHAIN_ACCOUNT" \
    -s "$KEYCHAIN_SERVICE" \
    -w 2>/dev/null
}

vmrun_base() {
  local password
  password="$(vm_password)" || {
    echo "Missing encrypted VM password." >&2
    echo "Set MCPVIEWS_VM_PASSWORD or add Keychain service '${KEYCHAIN_SERVICE}' for account '${KEYCHAIN_ACCOUNT}'." >&2
    exit 2
  }
  "$VMRUN" -T fusion -vp "$password" "$@"
}

vmrun_guest() {
  if [[ -z "${MCPVIEWS_VM_USER:-}" || -z "${MCPVIEWS_VM_PASS:-}" ]]; then
    echo "Guest command requires MCPVIEWS_VM_USER and MCPVIEWS_VM_PASS." >&2
    exit 2
  fi
  vmrun_base -gu "$MCPVIEWS_VM_USER" -gp "$MCPVIEWS_VM_PASS" "$@"
}

command="${1:-}"
shift || true

case "$command" in
  status)
    "$VMRUN" -T fusion list
    vmrun_base checkToolsState "$VM_PATH"
    ;;
  start)
    vmrun_base start "$VM_PATH" gui
    ;;
  snapshots)
    vmrun_base listSnapshots "$VM_PATH"
    ;;
  snapshot)
    vmrun_base snapshot "$VM_PATH" "${1:-$SNAPSHOT_NAME}"
    ;;
  revert)
    vmrun_base revertToSnapshot "$VM_PATH" "${1:-$SNAPSHOT_NAME}"
    ;;
  copy-to-guest)
    if [[ $# -ne 2 ]]; then
      usage >&2
      exit 2
    fi
    vmrun_guest copyFileFromHostToGuest "$VM_PATH" "$1" "$2"
    ;;
  copy-from-guest)
    if [[ $# -ne 2 ]]; then
      usage >&2
      exit 2
    fi
    vmrun_guest copyFileFromGuestToHost "$VM_PATH" "$1" "$2"
    ;;
  file-exists)
    if [[ $# -ne 1 ]]; then
      usage >&2
      exit 2
    fi
    vmrun_guest fileExistsInGuest "$VM_PATH" "$1"
    ;;
  dir-exists)
    if [[ $# -ne 1 ]]; then
      usage >&2
      exit 2
    fi
    vmrun_guest directoryExistsInGuest "$VM_PATH" "$1"
    ;;
  list-guest-dir)
    if [[ $# -ne 1 ]]; then
      usage >&2
      exit 2
    fi
    vmrun_guest listDirectoryInGuest "$VM_PATH" "$1"
    ;;
  run-guest)
    if [[ $# -lt 1 ]]; then
      usage >&2
      exit 2
    fi
    vmrun_guest runProgramInGuest "$VM_PATH" "$@"
    ;;
  run-guest-interactive)
    if [[ $# -lt 1 ]]; then
      usage >&2
      exit 2
    fi
    vmrun_guest runProgramInGuest "$VM_PATH" -activeWindow -interactive "$@"
    ;;
  run-script)
    if [[ $# -ne 2 ]]; then
      usage >&2
      exit 2
    fi
    vmrun_guest runScriptInGuest "$VM_PATH" "$1" "$2"
    ;;
  capture-screen)
    if [[ $# -ne 1 ]]; then
      usage >&2
      exit 2
    fi
    vmrun_base captureScreen "$VM_PATH" "$1"
    ;;
  evidence-dir)
    dir="docs/windows-smoke-evidence/$(date +%Y%m%dT%H%M%S)"
    mkdir -p "$dir"
    printf '%s\n' "$dir"
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "Unknown command: $command" >&2
    usage >&2
    exit 2
    ;;
esac
