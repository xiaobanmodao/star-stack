#!/bin/bash
# StarStack OJ 评测沙箱
# 使用 Linux 用户、挂载和 PID namespace，并在最小 chroot 中执行用户代码。
# 用法: sandbox.sh <work_dir> <time_limit_ms> <memory_limit_kb> <timing_marker> <cmd> [args...]

set -euo pipefail

if ! command -v unshare >/dev/null 2>&1; then
  echo 'sandbox unavailable: unshare is required' >&2
  exit 125
fi
if ! command -v timeout >/dev/null 2>&1; then
  echo 'sandbox unavailable: timeout is required' >&2
  exit 125
fi
if ! command -v mount >/dev/null 2>&1; then
  echo 'sandbox unavailable: mount is required' >&2
  exit 125
fi
if ! command -v chroot >/dev/null 2>&1; then
  echo 'sandbox unavailable: chroot is required' >&2
  exit 125
fi
if [[ "$(id -u)" == "0" ]]; then
  echo 'sandbox unavailable: judge must run as a dedicated non-root user' >&2
  exit 125
fi

WORK_DIR="$1"
TIME_LIMIT_MS="$2"
MEM_LIMIT_KB="$3"
shift 3

# 第四个参数是由 Node 生成的一次性计时标记，后面才是真正要执行的命令。
# 兼容没有传入标记的旧调用方式。
TIMING_MARKER=""
if [[ "${1:-}" == "-" || "${1:-}" == __STARSTACK_CPU_*__ ]]; then
  TIMING_MARKER="${1#-}"
  shift
fi

# 资源限制 (ulimit)
# ulimit 的 CPU 时间只能按整秒设置，墙钟时间仍由 timeout 按毫秒精确限制。
TIME_LIMIT_SEC=$(( (TIME_LIMIT_MS + 999) / 1000 ))
# GNU timeout 接受十进制秒，但不接受毫秒后缀；保留三位小数以精确表达 100～3000ms。
TIME_LIMIT_SECONDS="$((TIME_LIMIT_MS / 1000)).$(printf '%03d' $((TIME_LIMIT_MS % 1000)))"
# 虚拟内存限制
ulimit -v "$MEM_LIMIT_KB" 2>/dev/null || true
# CPU 时间上限（秒），与 timeout 的墙钟限制同时生效，防止异常进程长期占用 CPU。
ulimit -t "$TIME_LIMIT_SEC" 2>/dev/null || true
# 最大文件大小 50MB
ulimit -f 51200 2>/dev/null || true
# 禁止 core dump
ulimit -c 0 2>/dev/null || true
# 最大打开文件数
ulimit -n 64 2>/dev/null || true

# 在新的用户 namespace 中把当前非 root 用户映射为 namespace 内 root。
# 这只授予 namespace 内的挂载权限，不会授予宿主机 root 权限。
# 沙箱能力不足时直接失败，不能回退到无隔离执行。
exec unshare --user --map-root-user --net --mount --pid --fork --mount-proc --kill-child -- \
  /bin/bash -s -- "$WORK_DIR" "$TIME_LIMIT_SECONDS" "$TIMING_MARKER" "$@" <<'SANDBOX_NAMESPACE_SCRIPT'
set -euo pipefail

# namespace 建立后再限制用户代码的进程数，避免 PM2/Node 的宿主线程让 unshare fork 失败。
ulimit -u 32 2>/dev/null || true

WORK_DIR="$1"
TIME_LIMIT_SECONDS="$2"
TIMING_MARKER="$3"
shift 3

if [[ ! -d "$WORK_DIR" ]]; then
  echo 'sandbox unavailable: work directory does not exist' >&2
  exit 125
fi

ROOT_DIR="$(mktemp -d /tmp/starstack-sandbox.XXXXXX)"
cleanup() {
  umount -R "$ROOT_DIR" 2>/dev/null || true
  rm -rf "$ROOT_DIR" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

mount --make-rprivate /
mount -t tmpfs -o size=64m,mode=755 tmpfs "$ROOT_DIR"

# 编译器、解释器和动态链接器只以只读方式暴露；不暴露 /home、/root、/opt、/var 等目录。
for system_dir in usr bin sbin lib lib64 etc; do
  if [[ -e "/$system_dir" ]]; then
    mkdir -p "$ROOT_DIR/$system_dir"
    mount --rbind "/$system_dir" "$ROOT_DIR/$system_dir"
    mount --make-rslave "$ROOT_DIR/$system_dir"
    mount -o remount,bind,ro "$ROOT_DIR/$system_dir" 2>/dev/null || true
  fi
done

mkdir -p "$ROOT_DIR/work" "$ROOT_DIR/tmp" "$ROOT_DIR/proc" "$ROOT_DIR/dev"
mount --bind "$WORK_DIR" "$ROOT_DIR/work"
mount -t tmpfs -o size=128m,mode=1777 tmpfs "$ROOT_DIR/tmp"
mount -t proc proc "$ROOT_DIR/proc"

# 仅提供程序常用的四个设备，避免直接暴露宿主机设备树。
for device in null zero random urandom; do
  touch "$ROOT_DIR/dev/$device"
  mount --bind "/dev/$device" "$ROOT_DIR/dev/$device"
done

export HOME=/tmp
export TMPDIR=/tmp
export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin

# 将 Node 传入的工作目录绝对路径映射为 chroot 内的 /work 路径。
COMMAND=("$@")
for index in "${!COMMAND[@]}"; do
  if [[ "${COMMAND[$index]}" == "$WORK_DIR" || "${COMMAND[$index]}" == "$WORK_DIR/"* ]]; then
    COMMAND[$index]="/work${COMMAND[$index]:${#WORK_DIR}}"
  fi
done

if [[ -n "$TIMING_MARKER" && -x /usr/bin/time ]]; then
  exec chroot "$ROOT_DIR" /bin/bash -c \
    'cd /work && exec /usr/bin/timeout --signal=KILL "$1" /usr/bin/time -f "$2 %U %S" "${@:3}"' \
    starstack "$TIME_LIMIT_SECONDS" "$TIMING_MARKER" "${COMMAND[@]}"
fi
exec chroot "$ROOT_DIR" /bin/bash -c \
  'cd /work && exec /usr/bin/timeout --signal=KILL "$1" "${@:2}"' \
  starstack "$TIME_LIMIT_SECONDS" "${COMMAND[@]}"
SANDBOX_NAMESPACE_SCRIPT
