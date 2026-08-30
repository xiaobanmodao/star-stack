#!/bin/bash

set -euo pipefail

SANDBOX_PATH="${1:-}"
if [[ "$(id -u)" == "0" ]]; then
  echo 'contract error: sandbox probe must run as a dedicated non-root user' >&2
  exit 2
fi
if [[ ! -x "$SANDBOX_PATH" ]]; then
  echo 'contract error: sandbox script is not executable' >&2
  exit 2
fi

WORK_DIR="$(mktemp -d /tmp/starstack-systemd-sandbox-work.XXXXXX)"
cleanup() {
  rm -r -- "$WORK_DIR" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

/bin/bash "$SANDBOX_PATH" "$WORK_DIR" 100 65536 - /bin/true
