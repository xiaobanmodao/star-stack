#!/bin/bash
# StarStack OJ 评测沙箱
# 使用 Linux 内核特性隔离用户代码执行
# 用法: sandbox.sh <work_dir> <time_limit_sec> <memory_limit_kb> <cmd> [args...]

set -euo pipefail

if ! command -v unshare >/dev/null 2>&1; then
  echo 'sandbox unavailable: unshare is required' >&2
  exit 125
fi
if ! command -v timeout >/dev/null 2>&1; then
  echo 'sandbox unavailable: timeout is required' >&2
  exit 125
fi

WORK_DIR="$1"
TIME_LIMIT="$2"
MEM_LIMIT_KB="$3"
shift 3

# 第四个参数是由 Node 生成的一次性计时标记，后面才是真正要执行的命令。
# 兼容没有传入标记的旧调用方式。
TIMING_MARKER=""
if [[ "${1:-}" == __STARSTACK_CPU_*__ ]]; then
  TIMING_MARKER="$1"
  shift
fi

# 资源限制 (ulimit)
# 虚拟内存限制
ulimit -v "$MEM_LIMIT_KB" 2>/dev/null || true
# CPU 时间上限（秒），与 timeout 的墙钟限制同时生效，防止异常进程长期占用 CPU。
ulimit -t "$TIME_LIMIT" 2>/dev/null || true
# 最大文件大小 50MB
ulimit -f 51200 2>/dev/null || true
# 最大进程数
ulimit -u 32 2>/dev/null || true
# 禁止 core dump
ulimit -c 0 2>/dev/null || true
# 最大打开文件数
ulimit -n 64 2>/dev/null || true

# 使用 unshare 隔离网络、挂载和进程命名空间。
# 沙箱能力不足时直接失败，不能回退到无隔离执行。
if [[ -n "$TIMING_MARKER" && -x /usr/bin/time ]]; then
  exec unshare --net --mount --pid --fork --mount-proc --kill-child -- \
    timeout --signal=KILL "${TIME_LIMIT}s" \
    /usr/bin/time -f "${TIMING_MARKER} %U %S" \
    "$@"
fi
exec unshare --net --mount --pid --fork --mount-proc --kill-child -- \
  timeout --signal=KILL "${TIME_LIMIT}s" \
  "$@"
