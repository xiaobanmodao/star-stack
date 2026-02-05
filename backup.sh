#!/bin/bash

# StarStack 数据库备份脚本
# 建议在宝塔面板设置定时任务，每天凌晨 2:00 执行

set -e

# 配置
BACKUP_DIR="/www/backup/starstack"
DB_PATH="/www/wwwroot/star-stack/server/data/starstack.db"
KEEP_DAYS=7  # 保留最近 7 天的备份

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "=========================================="
echo "StarStack 数据库备份"
echo "=========================================="

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 检查数据库文件
if [ ! -f "$DB_PATH" ]; then
    echo -e "${RED}错误: 数据库文件不存在${NC}"
    echo "路径: $DB_PATH"
    exit 1
fi

# 生成备份文件名
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/starstack_${TIMESTAMP}.db"

# 执行备份
echo "正在备份数据库..."
cp "$DB_PATH" "$BACKUP_FILE"

# 压缩备份
echo "正在压缩备份文件..."
gzip "$BACKUP_FILE"
BACKUP_FILE="${BACKUP_FILE}.gz"

# 检查备份结果
if [ -f "$BACKUP_FILE" ]; then
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
find "$BACKUP_DIR" -name "starstack_*.db.gz" -mtime +$KEEP_DAYS -delete
REMAINING=$(ls -1 "$BACKUP_DIR" | wc -l)
echo -e "${GREEN}✓ 保留最近 $KEEP_DAYS 天的备份 (共 $REMAINING 个文件)${NC}"

# 列出所有备份
echo ""
echo "现有备份文件:"
ls -lh "$BACKUP_DIR"

echo ""
echo "=========================================="
echo "备份完成"
echo "=========================================="
