#!/usr/bin/env node
/**
 * chat_messages.seq 历史数据回填（2026-10-04）
 *
 * 背景：sqlite.ts 用 `ALTER TABLE chat_messages ADD COLUMN seq INTEGER` 引入
 * seq 列，无 DEFAULT、无回填，故该列引入之前写入的历史消息 seq 均为 NULL。
 * 而 store.ts 的 listChatMessages 有四处 `ORDER BY seq, ts` 且无 COALESCE，
 * SQLite 中 NULL 在 ASC 排序时排最前 —— 于是历史消息被聚成一块排到前面，
 * 与新消息的交错关系丢失。
 *
 * 修复思路：把存量 NULL 填入**负数区**，按 run 分组、按 ts 升序依次赋
 * 0, -1, -2, …（最早的一条最负）。这样：
 *   - 存量历史之间：seq 越小时间越早 → ORDER BY seq 即 ts 升序
 *   - 存量历史 vs 新消息：存量全为负、新消息从 1 起 → 历史整体在前
 *   - 之后的新消息继续用 MAX(seq)+1，永远为正，不会与负数区冲突
 *
 * 为什么不用 ORDER BY COALESCE(seq, rowid)：已实测该写法会让历史（rowid 编号）
 * 与新消息（seq 编号）交错——两套编号空间都从 1 起，冲突后「看起来有序」，
 * 比原 bug 更难发现。
 *
 * 幂等：WHERE seq IS NULL，已回填的行不会被二次修改。
 * 只动 chat_messages 的 seq 列，不碰其他表与其他列。
 *
 * 用法：
 *   node scripts/backfill-chat-seq.mjs --db <路径>          # 演练/执行
 *   node scripts/backfill-chat-seq.mjs --db <路径> --dry-run  # 只统计不写入
 */

import { DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
const dbPath = argv[argv.indexOf("--db") + 1];
const dryRun = argv.includes("--dry-run");

if (!dbPath || dbPath.startsWith("--")) {
  console.error("用法: node scripts/backfill-chat-seq.mjs --db <路径> [--dry-run]");
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

const before = db.prepare(
  "SELECT COUNT(*) AS total, SUM(CASE WHEN seq IS NULL THEN 1 ELSE 0 END) AS nulls FROM chat_messages",
).get();

console.log(`数据库: ${dbPath}`);
console.log(`chat_messages 共 ${before.total} 行，其中 seq IS NULL 的 ${before.nulls} 行`);
if (before.nulls === 0) {
  console.log("无需回填（无 NULL 行）。可能已执行过——本脚本是幂等的。");
  process.exit(0);
}

// 受影响的 run
const runs = db
  .prepare(
    `SELECT run_id, COUNT(*) AS n, MIN(ts) AS first_ts, MAX(ts) AS last_ts
     FROM chat_messages WHERE seq IS NULL
     GROUP BY run_id ORDER BY run_id`,
  )
  .all();

// 区分两类受影响情况，影响面差别很大：
//   mixed = 该 run 既有 NULL 历史又有已带 seq 的新消息 → 顺序真的错乱
//   pure  = 该 run 全是 NULL（之后再无新消息）→ 现状显示正常，回填只是让 seq 完整
const mixedCount = db
  .prepare(
    `SELECT COUNT(*) AS c FROM (
       SELECT run_id FROM chat_messages GROUP BY run_id
       HAVING SUM(CASE WHEN seq IS NULL THEN 1 ELSE 0 END) > 0
          AND SUM(CASE WHEN seq IS NOT NULL THEN 1 ELSE 0 END) > 0)`,
  )
  .get().c;

console.log(`\n受影响 ${runs.length} 个 run（其中 ${mixedCount} 个混有新消息，顺序真的错乱）：`);
for (const r of runs) {
  console.log(`  ${r.run_id}  ${r.n} 条  ${r.first_ts} → ${r.last_ts}`);
}

// 逐 run 回填：按 ts 升序，seq 依次 0, -1, -2, …
const selectRows = db.prepare(
  "SELECT rowid, id FROM chat_messages WHERE run_id = ? AND seq IS NULL ORDER BY ts ASC, rowid ASC",
);
const update = db.prepare("UPDATE chat_messages SET seq = ? WHERE rowid = ?");

let touched = 0;
db.exec("BEGIN");
try {
  for (const r of runs) {
    const rows = selectRows.all(r.run_id);
    const n = rows.length;
    // 按 ts 升序遍历：最早的一条得最负（-(n-1)），最晚的一条得 0。
    // 这样 seq 升序下历史块内部即 ts 升序，且整块（负数）排在新消息（1 起）之前。
    rows.forEach((row, i) => {
      update.run(i - n, row.rowid);
      touched += 1;
    });
  }
  db.exec(dryRun ? "ROLLBACK" : "COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.error("回填失败，已回滚:", e.message);
  process.exit(1);
}

console.log(`\n${dryRun ? "[dry-run] 已回滚" : "已提交"}：处理 ${touched} 行`);

if (!dryRun) {
  const after = db.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN seq IS NULL THEN 1 ELSE 0 END) AS nulls FROM chat_messages",
  ).get();
  console.log(`回填后：共 ${after.total} 行，seq IS NULL 剩 ${after.nulls} 行`);
  const range = db
    .prepare("SELECT MIN(seq) AS min_seq, MAX(seq) AS max_seq FROM chat_messages")
    .get();
  console.log(`seq 范围：${range.min_seq} → ${range.max_seq}（负数区为历史，1 起为新消息）`);
}

db.close();