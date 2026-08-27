#!/bin/bash
# 每天凌晨 3 点备份 SQLite（crontab: 0 3 * * * /opt/ensemble/scripts/backup.sh）
BACKUP_DIR="/data/backups"
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
# 容器内无 sqlite3 CLI，用 Node fs.cpSync（先 WAL checkpoint 保证一致性）
docker exec ensemble-server node -e "
  const fs = require('fs');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/data/ensemble.db', { open: true, readOnly: true });
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  fs.copyFileSync('/data/ensemble.db', '$BACKUP_DIR/ensemble_$TIMESTAMP.db');
  if (fs.existsSync('/data/ensemble.db-wal')) fs.copyFileSync('/data/ensemble.db-wal', '$BACKUP_DIR/ensemble_$TIMESTAMP.db-wal');
  if (fs.existsSync('/data/ensemble.db-shm')) fs.copyFileSync('/data/ensemble.db-shm', '$BACKUP_DIR/ensemble_$TIMESTAMP.db-shm');
"
# 保留最近 7 天
find $BACKUP_DIR -name "*.db" -mtime +7 -delete
