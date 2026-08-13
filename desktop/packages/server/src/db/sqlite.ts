import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** 初始 schema（内联以便 esbuild bundle 桌面版） */
const INIT_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  org_id        TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  device_info  TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  config_json TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  mode       TEXT NOT NULL,
  input_json TEXT NOT NULL,
  user_id    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  mode         TEXT NOT NULL,
  status       TEXT NOT NULL,
  task_title   TEXT,
  user_id      TEXT NOT NULL DEFAULT '',
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  final_result TEXT,
  error        TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(id),
  seq           INTEGER NOT NULL,
  agent_id      TEXT NOT NULL,
  agent_name    TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  status        TEXT NOT NULL,
  user_id       TEXT NOT NULL DEFAULT '',
  result        TEXT,
  usage_json    TEXT,
  session_id    TEXT,
  parent_job_id TEXT,
  started_at    TEXT,
  ended_at      TEXT,
  error         TEXT
);

CREATE TABLE IF NOT EXISTS run_events (
  run_id     TEXT NOT NULL REFERENCES runs(id),
  seq        INTEGER NOT NULL,
  job_id     TEXT,
  user_id    TEXT NOT NULL DEFAULT '',
  event_json TEXT NOT NULL,
  ts         TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id       TEXT PRIMARY KEY,
  run_id   TEXT NOT NULL,
  job_id   TEXT,
  agent_id TEXT NOT NULL,
  role     TEXT NOT NULL,
  user_id  TEXT NOT NULL DEFAULT '',
  content  TEXT NOT NULL,
  attachment TEXT,
  reply_to TEXT,
  deleted  INTEGER NOT NULL DEFAULT 0,
  ts       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL DEFAULT '',
  type            TEXT NOT NULL DEFAULT 'group',
  title           TEXT,
  participant_ids TEXT NOT NULL,
  run_id          TEXT NOT NULL,
  last_message    TEXT,
  last_message_ts TEXT,
  unread          INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- 用户-用户会话的 per-user 未读（多用户 IM：每个参与者各自计数）
CREATE TABLE IF NOT EXISTS conversation_reads (
  conv_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  unread  INTEGER NOT NULL DEFAULT 0,
  read_ts TEXT,
  PRIMARY KEY (conv_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_reads_user ON conversation_reads(user_id);

-- 用户设备（多端在线状态：手机端 / 电脑端等）
CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  type         TEXT NOT NULL DEFAULT 'mobile',
  last_seen_at TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

CREATE TABLE IF NOT EXISTS workflows (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  def_json   TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
CREATE INDEX IF NOT EXISTS idx_jobs_run ON jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id);
CREATE INDEX IF NOT EXISTS idx_chat_run ON chat_messages(run_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_run_agent ON jobs(run_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_run_events_run_job ON run_events(run_id, job_id);
`;

export function openDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(INIT_SQL);
  migrateUserColumns(db);
  return db;
}

/** 旧库迁移：CREATE TABLE IF NOT EXISTS 不添加列，业务表缺失 user_id 时补齐 */
function migrateUserColumns(db: DatabaseSync): void {
  const tables = ["tasks", "runs", "jobs", "run_events", "chat_messages"];
  // conversations.archived（P3 归档）
  const convCols = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
  if (!convCols.some((c) => c.name === "archived")) {
    db.exec("ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
  }
  // chat_messages 移除 run_id 外键（用户-用户会话消息 run_id 无对应 run，需重建表）
  // 兼容旧库：账号系统之前的 chat_messages 没有 user_id 列，重建时用 '' 兜底
  const cmFk = db.prepare("PRAGMA foreign_key_list(chat_messages)").all() as Array<{ table: string; from: string }>;
  if (cmFk.some((f) => f.table === "runs" && f.from === "run_id")) {
    const oldCmCols = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>;
    const hasUserId = oldCmCols.some((c) => c.name === "user_id");
    const hasAttachment = oldCmCols.some((c) => c.name === "attachment");
    const hasReplyTo = oldCmCols.some((c) => c.name === "reply_to");
    const hasDeleted = oldCmCols.some((c) => c.name === "deleted");
    const userSelect = hasUserId ? "user_id, " : "'' AS user_id, ";
    const attSelect = hasAttachment ? "attachment, " : "NULL AS attachment, ";
    const replySelect = hasReplyTo ? "reply_to, " : "NULL AS reply_to, ";
    const delSelect = hasDeleted ? "deleted, " : "0 AS deleted, ";
    db.exec(`BEGIN;
      ALTER TABLE chat_messages RENAME TO chat_messages_old;
      CREATE TABLE chat_messages (
        id       TEXT PRIMARY KEY,
        run_id   TEXT NOT NULL,
        job_id   TEXT,
        agent_id TEXT NOT NULL,
        role     TEXT NOT NULL,
        user_id  TEXT NOT NULL DEFAULT '',
        content  TEXT NOT NULL,
        attachment TEXT,
        reply_to TEXT,
        deleted  INTEGER NOT NULL DEFAULT 0,
        ts       TEXT NOT NULL
      );
      INSERT INTO chat_messages (id, run_id, job_id, agent_id, role, user_id, content, attachment, reply_to, deleted, ts)
        SELECT id, run_id, job_id, agent_id, role, ${userSelect} ${attSelect} ${replySelect} ${delSelect} content, ts FROM chat_messages_old;
      DROP TABLE chat_messages_old;
      COMMIT;`);
  }
  // chat_messages.attachment（P0-4 图片/文件；重建库已有该列则跳过）
  const cmAtt = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>;
  if (!cmAtt.some((c) => c.name === "attachment")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN attachment TEXT");
  }
  // chat_messages.deleted（P1 消息撤回）
  const cmDel = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>;
  if (!cmDel.some((c) => c.name === "deleted")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0");
  }
  // chat_messages.reply_to（P1 引用回复）
  const cmReply = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>;
  if (!cmReply.some((c) => c.name === "reply_to")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN reply_to TEXT");
  }
  for (const table of tables) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "user_id")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`);
    }
  }
  // conversation_reads.read_ts（P1 已读回执：记录用户最后一次已读时间）
  const crCols = db.prepare("PRAGMA table_info(conversation_reads)").all() as Array<{ name: string }>;
  if (!crCols.some((c) => c.name === "read_ts")) {
    db.exec("ALTER TABLE conversation_reads ADD COLUMN read_ts TEXT");
  }
}
