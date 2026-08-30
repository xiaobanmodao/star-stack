#!/bin/bash

set -euo pipefail

if [[ "${STARSTACK_JUDGE_SANDBOX_CONFIRM:-}" != "VERIFY_ONLY" || "$(id -u)" != "0" ]]; then
  echo 'refusing: set STARSTACK_JUDGE_SANDBOX_CONFIRM=VERIFY_ONLY and run as root' >&2
  exit 2
fi

PROJECT_ROOT=/opt/star-stack
UNIT_FILE=/etc/systemd/system/starstack-api.service
TEST_USER=starstack
PROBE="$PROJECT_ROOT/scripts/judge/systemd-sandbox-service-probe.sh"
SANDBOX="$PROJECT_ROOT/server/sandbox.sh"

if [[ ! -d "$PROJECT_ROOT" || -L "$PROJECT_ROOT" || "$(realpath -e "$PROJECT_ROOT")" != "$PROJECT_ROOT" ]]; then
  echo "preflight error: project root is missing, symbolic or non-canonical: $PROJECT_ROOT" >&2
  exit 2
fi
for path in "$UNIT_FILE" "$PROBE" "$SANDBOX"; do
  if [[ ! -f "$path" || -L "$path" || "$(realpath -e "$path")" != "$path" ]]; then
    echo "preflight error: missing or symbolic path: $path" >&2
    exit 2
  fi
done
if [[ ! -x "$PROBE" || ! -x "$SANDBOX" ]]; then
  echo 'preflight error: judge sandbox probes must be executable' >&2
  exit 2
fi
if ! getent passwd "$TEST_USER" >/dev/null; then
  echo 'preflight error: starstack service account is missing' >&2
  exit 2
fi
if [[ "$(cat /proc/sys/kernel/dmesg_restrict)" != "1" ]]; then
  echo 'preflight error: kernel.dmesg_restrict must equal 1' >&2
  exit 2
fi

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
  if [[ "$(grep -c "^${name}=" "$UNIT_FILE")" != "1" ]]; then
    echo "preflight error: installed unit must contain exactly one ${name}=" >&2
    exit 2
  fi
  sed -n "s/^${name}=//p" "$UNIT_FILE"
}

declare -A EXPECTED=(
  [User]=starstack
  [Group]=starstack
  [WorkingDirectory]=/opt/star-stack
  [NoNewPrivileges]=true
  [PrivateDevices]=true
  [PrivateTmp]=true
  [ProtectHome]=true
  [ProtectSystem]=full
  [ReadOnlyPaths]=/opt/star-stack
  [ReadWritePaths]=/opt/star-stack/server/data
  [ProtectKernelTunables]=false
  [ProtectKernelModules]=false
  [ProtectKernelLogs]=false
  [ProtectControlGroups]=true
  [RestrictRealtime]=true
  [RestrictSUIDSGID]=true
  [LockPersonality]=true
  [CapabilityBoundingSet]=''
  [AmbientCapabilities]=''
  [UMask]=0077
  [MemoryMax]=768M
  [TasksMax]=256
)
for name in "${!EXPECTED[@]}"; do
  if [[ "$(property_value "$name")" != "${EXPECTED[$name]}" ]]; then
    echo "preflight error: ${name}= does not match the audited judge unit" >&2
    exit 2
  fi
done

systemd-analyze verify "$UNIT_FILE"

args=(
  systemd-run --quiet --wait --collect --pipe
  "--unit=starstack-judge-sandbox-preflight-$$"
  "--property=Type=exec"
  "--property=User=$TEST_USER"
  "--property=Group=$TEST_USER"
  "--property=WorkingDirectory=$PROJECT_ROOT"
  "--property=TimeoutStartSec=20s"
)
for name in "${PROPERTY_NAMES[@]}"; do
  args+=("--property=${name}=$(property_value "$name")")
done

"${args[@]}" /bin/bash "$PROBE" "$SANDBOX"
echo 'StarStack installed systemd judge sandbox preflight passed'
