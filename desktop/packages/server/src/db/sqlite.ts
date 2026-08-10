import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** 初始 schema（内联以便 esbuild bundle 桌面版） */
const INIT_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

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
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  mode         TEXT NOT NULL,
  status       TEXT NOT NULL,
  task_title   TEXT,
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
  event_json TEXT NOT NULL,
  ts         TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id       TEXT PRIMARY KEY,
  run_id   TEXT NOT NULL REFERENCES runs(id),
  job_id   TEXT,
  agent_id TEXT NOT NULL,
  role     TEXT NOT NULL,
  content  TEXT NOT NULL,
  ts       TEXT NOT NULL
);

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
CREATE INDEX IF NOT EXISTS idx_jobs_run_agent ON jobs(run_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_run_events_run_job ON run_events(run_id, job_id);
`;

export function openDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(INIT_SQL);
  return db;
}
