#!/usr/bin/env node
/**
 * 一次性脚本：把指定用户名设为 owner
 * 用法：docker exec ensemble-server node scripts/set-owner.mjs <username>
 * 生产环境首次部署 O1 后执行
 */
import { openDb } from "./packages/server/dist/db/sqlite.js";
import { join } from "node:path";

const username = process.argv[2];
if (!username) {
  console.error("用法: node scripts/set-owner.mjs <username>");
  process.exit(1);
}

const dbPath = join(process.env.DATA_DIR || "/app/data", "ensemble.db");
const db = openDb(dbPath);

// 查用户
const user = db.prepare("SELECT id, role FROM users WHERE username = ?").get(username);
if (!user) {
  console.error(`用户不存在: ${username}`);
  process.exit(1);
}
console.log(`当前角色: ${user.role}`);

// 设为 owner
db.prepare("UPDATE users SET role = 'owner' WHERE id = ?").run(user.id);
console.log(`已将 ${username} 设为 owner`);

// 验证
const verify = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(user.id);
console.log(`验证: ${verify.username} → ${verify.role}`);
db.close();
