#!/bin/bash
# 每天凌晨 3 点备份 SQLite（crontab: 0 3 * * * /opt/ensemble/scripts/backup.sh）
set -euo pipefail

# 必须与 docker-compose.yml 的 DB_PATH 一致：卷 ensemble-data 挂在 /data 下，
# 容器内不存在 /data/ensemble-data/ 这个层级，写成那样会备份一个不存在的库
# （静默生成空库或报错），导致「备份一直在跑」这个前提不可信。
DB_PATH="${DB_PATH:-/data/ensemble.db}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"

# 备份前校验源库存在且含核心表——备份失效是静默的，不校验就等于没有备份。
if [ ! -f "$DB_PATH" ]; then
  echo "✗ 源数据库不存在: $DB_PATH" >&2
  echo "  检查 docker-compose 的 DB_PATH 与卷挂载是否一致" >&2
  exit 1
fi
# 用「是否含核心表」而非文件大小判断有效性：一个空 SQLite 库也有 12KB，
# 按字节数判断会把空库误当有效备份。
TABLES=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('chat_messages','runs','users');" 2>&1)
if [ "$TABLES" -lt 3 ]; then
  echo "✗ 源库缺少核心表（chat_messages/runs/users，当前只有 $TABLES 个）: $DB_PATH" >&2
  echo "  疑似空库或路径指向了错误的库，拒绝备份以免覆盖可用备份" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DEST="$BACKUP_DIR/ensemble_$TIMESTAMP.db"

sqlite3 "$DB_PATH" ".backup '$DEST'"

# 校验产物：含核心表且完整性检查通过。
DEST_TABLES=$(sqlite3 "$DEST" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('chat_messages','runs','users');" 2>&1)
if [ "$DEST_TABLES" -lt 3 ]; then
  echo "✗ 备份产物缺少核心表（只有 $DEST_TABLES 个）: $DEST" >&2
  rm -f "$DEST"
  exit 1
fi
INTEGRITY=$(sqlite3 "$DEST" "PRAGMA integrity_check;" 2>&1)
if [ "$INTEGRITY" != "ok" ]; then
  echo "✗ 备份产物完整性检查未通过: $INTEGRITY" >&2
  rm -f "$DEST"
  exit 1
fi

echo "✓ 备份完成: $DEST（$(wc -c < "$DEST") 字节，核心表齐全，完整性 ok）"

# 保留最近 7 天
find "$BACKUP_DIR" -name "*.db" -mtime +7 -delete