#!/bin/bash
# 审计日志保留期清理（设计见 docs/AUDIT-DESIGN.md §6）
# crontab: 30 4 * * * /opt/ensemble/scripts/audit-cleanup.sh
#
# 两条硬要求（来自本轮教训，缺一不可）：
#  1. 默认只 dry-run：打印将要删除的记录数与时间范围，人工确认后再加 --execute。
#     审计数据虽可再生，但误删会让人对「可审计」这件事失去信任。
#  2. 必须带存在性校验：backup.sh 曾因路径错误备份了一个不存在的库却静默成功
#     （fix 7b9994f）。本脚本找不到 audit_log 表时直接报错退出。
set -euo pipefail

DB_PATH="${DB_PATH:-/data/ensemble.db}"
KEEP_DAYS="${KEEP_DAYS:-90}"
DRY_RUN=1
[ "${1:-}" = "--execute" ] && DRY_RUN=0

if [ ! -f "$DB_PATH" ]; then
  echo "✗ 数据库不存在: $DB_PATH" >&2
  echo "  检查 DB_PATH 与 docker-compose 的卷挂载是否一致" >&2
  exit 1
fi

# 校验 audit_log 表存在——一个空 SQLite 库也有 12KB，不能用文件大小判断
HAS_TABLE=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='audit_log';" 2>&1)
if [ "$HAS_TABLE" != "1" ]; then
  echo "✗ 库中没有 audit_log 表（数据库可能是空的或路径指错）: $DB_PATH" >&2
  exit 1
fi

CUTOFF=$(date -u -d "-${KEEP_DAYS} days" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -v-${KEEP_DAYS}d +%Y-%m-%dT%H:%M:%S)
COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM audit_log WHERE ts < '$CUTOFF';")
OLDEST=$(sqlite3 "$DB_PATH" "SELECT COALESCE(MIN(ts),'—') FROM audit_log WHERE ts < '$CUTOFF';")
NEWEST=$(sqlite3 "$DB_PATH" "SELECT COALESCE(MAX(ts),'—') FROM audit_log WHERE ts < '$CUTOFF';")

echo "数据库:   $DB_PATH"
echo "保留期:   $KEEP_DAYS 天"
echo "截止时间: $CUTOFF"
echo "待删除:   $COUNT 条（时间范围 $OLDEST ~ $NEWEST）"

if [ "$COUNT" -eq 0 ]; then
  echo "✓ 无需清理"
  exit 0
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo ""
  echo "以上为 dry-run，未做任何删除。"
  echo "确认无误后执行：DB_PATH=$DB_PATH KEEP_DAYS=$KEEP_DAYS $0 --execute"
  exit 0
fi

sqlite3 "$DB_PATH" "DELETE FROM audit_log WHERE ts < '$CUTOFF';"
echo "✓ 已删除 $COUNT 条"
