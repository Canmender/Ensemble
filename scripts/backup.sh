#!/bin/bash
# 每天凌晨 3 点备份 SQLite（crontab: 0 3 * * * /opt/ensemble/scripts/backup.sh）
DB_PATH="/data/ensemble-data/ensemble.db"
BACKUP_DIR="/data/backups"
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
sqlite3 $DB_PATH ".backup '$BACKUP_DIR/ensemble_$TIMESTAMP.db'"
# 保留最近 7 天
find $BACKUP_DIR -name "*.db" -mtime +7 -delete
