#!/bin/bash

set -euo pipefail

if [[ "${STARSTACK_SYSTEMD_CONTRACT:-}" != "ephemeral-github-runner" \
  || "${GITHUB_ACTIONS:-}" != "true" \
  || "$(id -u)" != "0" ]]; then
  echo 'refusing: this destructive-isolated contract only runs as root on an explicit GitHub Actions VM' >&2
  exit 2
fi
if [[ ! -d /run/systemd/system ]] || ! command -v systemd-run >/dev/null 2>&1; then
  echo 'contract error: systemd-run is unavailable on this runner' >&2
  exit 2
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_FILE="$PROJECT_ROOT/infra/identity/systemd/starstack-api.service"
TEST_USER="starstack-sandbox-contract"
FIXTURE_ROOT="$(mktemp -d /opt/starstack-sandbox-contract.XXXXXX)"
CREATED_USER=0
ORIGINAL_USERNS_CLONE=''
ORIGINAL_APPARMOR_USERNS=''

cleanup() {
  if [[ -f "$FIXTURE_ROOT/.starstack-systemd-contract" ]]; then
    rm -r -- "$FIXTURE_ROOT" 2>/dev/null || true
  fi
  if [[ "$CREATED_USER" == "1" ]]; then
    userdel "$TEST_USER" >/dev/null 2>&1 || true
  fi
  if [[ -n "$ORIGINAL_APPARMOR_USERNS" ]]; then
    sysctl -q -w "kernel.apparmor_restrict_unprivileged_userns=$ORIGINAL_APPARMOR_USERNS" >/dev/null 2>&1 || true
  fi
  if [[ -n "$ORIGINAL_USERNS_CLONE" ]]; then
    sysctl -q -w "kernel.unprivileged_userns_clone=$ORIGINAL_USERNS_CLONE" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT HUP INT TERM
touch "$FIXTURE_ROOT/.starstack-systemd-contract"
chmod 0755 "$FIXTURE_ROOT"

# Ubuntu GitHub runners may globally disable unprivileged user namespaces with
# AppArmor even though the production host baseline explicitly supports them.
# Normalize only this disposable VM, before creating any test process, and
# restore both sysctls in the trap. No user-supplied code runs in this job.
if [[ -f /proc/sys/kernel/unprivileged_userns_clone ]]; then
  ORIGINAL_USERNS_CLONE="$(cat /proc/sys/kernel/unprivileged_userns_clone)"
  sysctl -q -w kernel.unprivileged_userns_clone=1
fi
if [[ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]]; then
  ORIGINAL_APPARMOR_USERNS="$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)"
  sysctl -q -w kernel.apparmor_restrict_unprivileged_userns=0
fi

if getent passwd "$TEST_USER" >/dev/null; then
  echo 'contract error: reserved fixture user already exists' >&2
  exit 2
fi
useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$TEST_USER"
CREATED_USER=1

install -d -m 0755 "$FIXTURE_ROOT/server" "$FIXTURE_ROOT/server/data" "$FIXTURE_ROOT/scripts/judge"
install -m 0755 "$PROJECT_ROOT/server/sandbox.sh" "$FIXTURE_ROOT/server/sandbox.sh"
install -m 0755 \
  "$PROJECT_ROOT/scripts/judge/systemd-sandbox-service-probe.sh" \
  "$FIXTURE_ROOT/scripts/judge/systemd-sandbox-service-probe.sh"
chown "$TEST_USER:$TEST_USER" "$FIXTURE_ROOT/server/data"

PROBE=(
  /bin/bash
  "$FIXTURE_ROOT/scripts/judge/systemd-sandbox-service-probe.sh"
  "$FIXTURE_ROOT/server/sandbox.sh"
)

echo '[systemd-sandbox] ordinary dedicated-user baseline'
runuser -u "$TEST_USER" -- "${PROBE[@]}"

PROPERTY_NAMES=(
  NoNewPrivileges
  PrivateDevices
  PrivateTmp
  ProtectHome
  ProtectSystem
  ReadOnlyPaths
  ReadWritePaths
  ProtectKernelTunables
  ProtectKernelModules
  ProtectKernelLogs
  ProtectControlGroups
  SystemCallFilter
  RestrictRealtime
  RestrictSUIDSGID
  LockPersonality
  CapabilityBoundingSet
  AmbientCapabilities
  UMask
  MemoryMax
  TasksMax
)

property_value() {
  local name="$1"
  local value
  if ! grep -q "^${name}=" "$UNIT_FILE"; then
    echo "contract error: missing ${name}= in production unit" >&2
    exit 2
  fi
  value="$(sed -n "s/^${name}=//p" "$UNIT_FILE")"
  value="${value//\/opt\/star-stack/$FIXTURE_ROOT}"
  printf '%s' "$value"
}

run_transient() {
  local label="$1"
  local omitted="${2:-}"
  local unit_name="starstack-sandbox-${label//[^a-zA-Z0-9-]/-}-${RANDOM}-${RANDOM}"
  local args=(
    systemd-run --quiet --wait --collect --pipe
    "--unit=$unit_name"
    "--property=Type=exec"
    "--property=User=$TEST_USER"
    "--property=Group=$TEST_USER"
    "--property=WorkingDirectory=$FIXTURE_ROOT"
    "--property=TimeoutStartSec=20s"
  )
  local name
  for name in "${PROPERTY_NAMES[@]}"; do
    if [[ "$name" != "$omitted" ]]; then
      args+=("--property=${name}=$(property_value "$name")")
    fi
  done
  "${args[@]}" "${PROBE[@]}"
}

echo '[systemd-sandbox] complete production hardening contract'
if run_transient full; then
  echo '[systemd-sandbox] complete contract passed'
  exit 0
fi

echo '[systemd-sandbox] full contract failed; testing one-property omissions' >&2
passing_omissions=()
diagnostic_output="$(mktemp /tmp/starstack-systemd-contract-output.XXXXXX)"
for name in "${PROPERTY_NAMES[@]}"; do
  if run_transient "without-$name" "$name" >"$diagnostic_output" 2>&1; then
    passing_omissions+=("$name")
    echo "[systemd-sandbox] candidate conflict: $name" >&2
  fi
done
rm -f -- "$diagnostic_output"

if [[ "${#passing_omissions[@]}" == "0" ]]; then
  echo '[systemd-sandbox] no single-property omission restored the sandbox' >&2
else
  echo "[systemd-sandbox] passing omissions: ${passing_omissions[*]}" >&2
fi
exit 1
