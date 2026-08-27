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
  mentions TEXT,
  deleted  INTEGER NOT NULL DEFAULT 0,
  ts       TEXT NOT NULL,
  seq      INTEGER
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
  muted           INTEGER NOT NULL DEFAULT 0,
  pinned          INTEGER NOT NULL DEFAULT 0,
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

-- 文件上传记录（MD5 去重 + 文件元数据）
CREATE TABLE IF NOT EXISTS upload_files (
  id         TEXT PRIMARY KEY,
  md5        TEXT NOT NULL,
  url        TEXT NOT NULL,
  name       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  mime       TEXT NOT NULL,
  type       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upload_md5 ON upload_files(md5);

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
CREATE INDEX IF NOT EXISTS idx_conv_user_updated ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_run_agent ON jobs(run_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_run_events_run_job ON run_events(run_id, job_id);

-- E2EE 密钥目录（服务器只见公钥；协议见 desktop/docs/E2E-PROTOCOL.md）
CREATE TABLE IF NOT EXISTS e2e_identities (
  user_id       TEXT PRIMARY KEY,
  identity_key  TEXT NOT NULL,
  spk_id        INTEGER NOT NULL,
  spk_public    TEXT NOT NULL,
  spk_signature TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS e2e_one_time_prekeys (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  prekey_id  INTEGER NOT NULL,
  public_key TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_e2e_opks_user ON e2e_one_time_prekeys(user_id);

-- 用户插件体系（R4）：per-user 插件 KV 存储（三元键隔离）+ 启用清单
CREATE TABLE IF NOT EXISTS plugin_kv (
  user_id    TEXT NOT NULL,
  plugin_id  TEXT NOT NULL,
  key        TEXT NOT NULL,
  value_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, plugin_id, key)
);

CREATE TABLE IF NOT EXISTS user_plugins (
  user_id   TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  config_json TEXT,
  enabled   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, plugin_id)
);

-- 群成员角色（P1 群组管理）：群主/管理员/普通成员 + 状态（正常/退出/被踢）
CREATE TABLE IF NOT EXISTS group_members (
  group_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role        INTEGER NOT NULL DEFAULT 3,  -- 1=群主 2=管理员 3=成员
  status      INTEGER NOT NULL DEFAULT 1,  -- 1=正常 2=退出 3=被踢
  joined_at   TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

-- 设备配对（L2）：我的手机 ↔ 我的桌面 显式设备对；互联信令按 pairId 放行
CREATE TABLE IF NOT EXISTS device_pairs (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  desktop_device_id TEXT NOT NULL,
  mobile_device_id TEXT NOT NULL,
  paired_at        INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_pairs_unique ON device_pairs(user_id, desktop_device_id, mobile_device_id);

-- 配对码（一次性；5 分钟过期，消费即删）
CREATE TABLE IF NOT EXISTS pair_codes (
  code        TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  desktop_device_id TEXT NOT NULL,
  public_key_fingerprint TEXT,
  expires_at  INTEGER NOT NULL
);

-- 互联事件本地日志（L1）：断线补拉的回放源（手机 sync.request sinceTs → delta 回放）
CREATE TABLE IF NOT EXISTS device_link_events (
  msg_id      TEXT PRIMARY KEY,
  pair_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  payload_json TEXT,
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dle_pair_ts ON device_link_events(pair_id, ts);

-- 消息表情回应（P2 平台能力）：每人每条消息每种 emoji 最多一个
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_reaction_msg ON message_reactions(message_id);

-- 消息全文搜索（P2-子任务3）：FTS5 虚拟表 + 触发器同步
CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts USING fts5(
  id UNINDEXED,
  run_id UNINDEXED,
  content,
  content=chat_messages,
  content_rowid=rowid
);
CREATE TRIGGER IF NOT EXISTS chat_messages_ai AFTER INSERT ON chat_messages BEGIN
  INSERT INTO chat_messages_fts(rowid, id, run_id, content)
  VALUES (new.rowid, new.id, new.run_id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS chat_messages_ad AFTER DELETE ON chat_messages BEGIN
  INSERT INTO chat_messages_fts(chat_messages_fts, rowid, id, run_id, content)
  VALUES ('delete', old.rowid, old.id, old.run_id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS chat_messages_au AFTER UPDATE ON chat_messages BEGIN
  INSERT INTO chat_messages_fts(chat_messages_fts, rowid, id, run_id, content)
  VALUES ('delete', old.rowid, old.id, old.run_id, old.content);
  INSERT INTO chat_messages_fts(rowid, id, run_id, content)
  VALUES (new.rowid, new.id, new.run_id, new.content);
END;
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
        mentions TEXT,
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
  // chat_messages.mentions（@用户提及）
  const cmMentions = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>;
  if (!cmMentions.some((c) => c.name === "mentions")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN mentions TEXT");
  }
  // conversations.muted / pinned（静音 / 置顶）
  const convCols2 = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
  if (!convCols2.some((c) => c.name === "muted")) {
    db.exec("ALTER TABLE conversations ADD COLUMN muted INTEGER NOT NULL DEFAULT 0");
  }
  if (!convCols2.some((c) => c.name === "pinned")) {
    db.exec("ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  }
  // users.avatar_url（用户头像）
  const userCols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === "avatar_url")) {
    db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT");
  }
  // conversations.announcement / group_muted（群公告 / 群禁言）
  const convCols3 = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
  if (!convCols3.some((c) => c.name === "announcement")) {
    db.exec("ALTER TABLE conversations ADD COLUMN announcement TEXT");
  }
  if (!convCols3.some((c) => c.name === "group_muted")) {
    db.exec("ALTER TABLE conversations ADD COLUMN group_muted INTEGER NOT NULL DEFAULT 0");
  }
  if (!convCols3.some((c) => c.name === "group_owner")) {
    db.exec("ALTER TABLE conversations ADD COLUMN group_owner TEXT");
  }
  if (!convCols3.some((c) => c.name === "group_admins")) {
    db.exec("ALTER TABLE conversations ADD COLUMN group_admins TEXT");
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
  // chat_messages.seq（会话内单调序号：可靠排序 / 断线补拉游标）。
  // 旧库补列；存量行按 (ts, rowid) 回填——时间戳同毫秒不稳定，rowid 作次级键保证确定性。
  // 注意：seq 索引必须在补列之后创建（INIT_SQL 阶段旧库尚无该列）。
  const cmSeqCols = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>;
  if (!cmSeqCols.some((c) => c.name === "seq")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN seq INTEGER");
  }
  const nullSeq = db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE seq IS NULL").get() as { n: number };
  if (nullSeq.n > 0) {
    db.exec(`UPDATE chat_messages SET seq = (
      SELECT COUNT(*) FROM chat_messages c2
      WHERE c2.run_id = chat_messages.run_id
        AND (c2.ts < chat_messages.ts OR (c2.ts = chat_messages.ts AND c2.rowid <= chat_messages.rowid))
    )`);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_chat_run_seq ON chat_messages(run_id, seq)");

  // status 枚举（v0.8.33）：替代 deleted 布尔值，支持正常/已撤回/已编辑三种状态
  const cmStatusCol = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>;
  if (!cmStatusCol.some((c) => c.name === "status")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN status INTEGER NOT NULL DEFAULT 1");
    db.exec("UPDATE chat_messages SET status = 2 WHERE deleted = 1");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_chat_run_status ON chat_messages(run_id, status)");

  // conversations 表扩展（P1 群组管理）：join_type + version + notice
  const convP1Cols = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
  if (!convP1Cols.some((c) => c.name === "join_type")) {
    db.exec("ALTER TABLE conversations ADD COLUMN join_type INTEGER NOT NULL DEFAULT 0");
  }
  if (!convP1Cols.some((c) => c.name === "version")) {
    db.exec("ALTER TABLE conversations ADD COLUMN version INTEGER NOT NULL DEFAULT 0");
  }
  if (!convCols.some((c) => c.name === "notice")) {
    db.exec("ALTER TABLE conversations ADD COLUMN notice TEXT");
    db.exec("ALTER TABLE conversations ADD COLUMN notice_updated_at TEXT");
  }

  // O1 组织权限：departments + organization 表 + users 补列 + conversations 关联
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS organization (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      settings_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const userO1Cols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userO1Cols.some((c) => c.name === "dept_ids")) {
    db.exec("ALTER TABLE users ADD COLUMN dept_ids TEXT");
  }
  if (!userCols.some((c) => c.name === "title")) {
    db.exec("ALTER TABLE users ADD COLUMN title TEXT");
  }
  if (!userO1Cols.some((c) => c.name === "status")) {
    db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!convCols.some((c) => c.name === "dept_id")) {
    db.exec("ALTER TABLE conversations ADD COLUMN dept_id TEXT");
  }
  if (!convCols.some((c) => c.name === "visibility")) {
    db.exec("ALTER TABLE conversations ADD COLUMN visibility TEXT NOT NULL DEFAULT 'members'");
  }
}
