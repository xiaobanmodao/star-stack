#!/bin/bash

# StarStack 数据库备份脚本
# 支持环境变量覆盖默认路径，也支持自动安装 crontab 定时任务。
#
# 用法：
#   ./backup.sh                          # 执行一次备份
#   ./backup.sh --install-cron           # 安装每天凌晨 2:00 的 crontab 任务
#   ./backup.sh --help                   # 显示帮助
#
# 可用环境变量：
#   BACKUP_DIR      备份目录（默认 /www/backup/starstack）
#   DB_PATH         数据库路径（默认 server/data/starstack.sqlite）
#   KEEP_DAYS       保留最近 N 天（默认 7）
#   CRON_SCHEDULE   cron 表达式（默认 0 2 * * *）
#   LOG_FILE        定时任务日志文件（默认 server/backup.log）

set -e
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
SCRIPT_PATH="$PROJECT_ROOT/backup.sh"

BACKUP_DIR="${BACKUP_DIR:-/www/backup/starstack}"
DB_PATH="${DB_PATH:-$PROJECT_ROOT/server/data/starstack.sqlite}"
KEEP_DAYS="${KEEP_DAYS:-7}"
CRON_SCHEDULE="${CRON_SCHEDULE:-0 2 * * *}"
LOG_FILE="${LOG_FILE:-$PROJECT_ROOT/server/backup.log}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [[ ! "$KEEP_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  echo -e "${RED}错误: KEEP_DAYS 必须是正整数${NC}"
  exit 1
fi

show_help() {
  echo "StarStack 数据库备份脚本"
  echo ""
  echo "用法:"
  echo "  ./backup.sh                          # 执行一次备份"
  echo "  ./backup.sh --install-cron           # 安装 crontab 定时任务"
  echo "  ./backup.sh --help                   # 显示帮助"
  echo ""
  echo "环境变量:"
  echo "  BACKUP_DIR      备份目录（默认 /www/backup/starstack）"
  echo "  DB_PATH         数据库路径（默认 $PROJECT_ROOT/server/data/starstack.sqlite）"
  echo "  KEEP_DAYS       保留最近 N 天（默认 7）"
  echo "  CRON_SCHEDULE   cron 表达式（默认 0 2 * * *）"
  echo "  LOG_FILE        定时任务日志文件（默认 $PROJECT_ROOT/server/backup.log）"
}

install_cron() {
  if ! command -v crontab > /dev/null 2>&1; then
    echo -e "${RED}错误: 未找到 crontab 命令${NC}"
    exit 1
  fi

  local cron_line="$CRON_SCHEDULE cd $PROJECT_ROOT && $SCRIPT_PATH >> $LOG_FILE 2>&1"
  echo "安装定时备份任务:"
  echo "  $cron_line"

  # 先移除旧的 StarStack 备份任务，避免重复
  if crontab -l 2>/dev/null | grep -F "$SCRIPT_PATH" > /dev/null 2>&1; then
    echo "检测到旧任务，先移除..."
    crontab -l 2>/dev/null | grep -v -F "$SCRIPT_PATH" | crontab -
  fi

  (crontab -l 2>/dev/null; echo "$cron_line") | crontab -
  echo -e "${GREEN}✓ 定时备份任务已安装${NC}"
  echo "当前 crontab:"
  crontab -l 2>/dev/null | grep -F "$SCRIPT_PATH" || true
}

if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  show_help
  exit 0
fi

if [ "$1" = "--install-cron" ]; then
  install_cron
  exit 0
fi

echo "=========================================="
echo "StarStack 数据库备份"
echo "=========================================="

# 创建备份目录
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# 检查数据库文件
if [ ! -f "$DB_PATH" ]; then
    echo -e "${RED}错误: 数据库文件不存在${NC}"
    echo "路径: $DB_PATH"
    exit 1
fi

# 生成备份文件名
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/starstack_${TIMESTAMP}.db"

# 执行备份（WAL 模式下用 sqlite3 .backup 保证一致性，同时备份 -wal/-shm 尾日志）
echo "正在备份数据库..."
if command -v sqlite3 > /dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
else
  cp "$DB_PATH" "$BACKUP_FILE"
  # 复制 WAL 尾日志（若存在）
  [ -f "$DB_PATH-wal" ] && cp "$DB_PATH-wal" "${BACKUP_FILE}-wal"
  [ -f "$DB_PATH-shm" ] && cp "$DB_PATH-shm" "${BACKUP_FILE}-shm"
fi

# 压缩备份
echo "正在压缩备份文件..."
gzip "$BACKUP_FILE"
BACKUP_FILE="${BACKUP_FILE}.gz"

# 检查备份结果
if [ -f "$BACKUP_FILE" ]; then
    chmod 600 "$BACKUP_FILE"
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✓ 备份成功${NC}"
    echo "备份文件: $BACKUP_FILE"
    echo "文件大小: $BACKUP_SIZE"
else
    echo -e "${RED}✗ 备份失败${NC}"
    exit 1
fi

# 清理旧备份
echo "清理旧备份文件..."
find "$BACKUP_DIR" -name "starstack_*.db.gz" -mtime "+$KEEP_DAYS" -delete
REMAINING=$(ls -1 "$BACKUP_DIR" 2>/dev/null | wc -l)
echo -e "${GREEN}✓ 保留最近 $KEEP_DAYS 天的备份 (共 $REMAINING 个文件)${NC}"

# 列出所有备份
echo ""
echo "现有备份文件:"
ls -lh "$BACKUP_DIR"

echo ""
echo "=========================================="
echo "备份完成"
echo "=========================================="
