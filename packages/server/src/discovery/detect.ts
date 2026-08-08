import { homedir } from "node:os";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import type { DetectedAgent, DetectedSkill } from "./types";

function readSkillDirs(dir: string): DetectedSkill[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => existsSync(join(dir, n, "SKILL.md")))
    .map((n) => ({ name: n, sourcePath: join(dir, n, "SKILL.md") }));
}

function countHermesFacts(dbPath: string): number {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const r = db.prepare("SELECT COUNT(*) AS c FROM facts").get() as { c: number };
    db.close();
    return Number(r?.c ?? 0);
  } catch {
    return 0;
  }
}

function getVersion(cmd: string): string | undefined {
  try {
    const out = execSync(cmd, { encoding: "utf8", timeout: 5000 });
    return out.trim().split("\n")[0].slice(0, 80);
  } catch {
    return undefined;
  }
}

function detectClaude(): DetectedAgent | null {
  const home = join(homedir(), ".claude");
  if (!existsSync(home)) return null;
  const configPath = join(home, "settings.json");
  return {
    type: "claude",
    name: "Claude Code",
    version: getVersion("claude --version"),
    configPath: existsSync(configPath) ? configPath : undefined,
    skills: readSkillDirs(join(home, "skills")),
    memoryCount: 0,
  };
}

function detectHermes(): DetectedAgent | null {
  const home = join(homedir(), ".hermes");
  if (!existsSync(home)) return null;
  const dbPath = join(home, "memory_store.db");
  return {
    type: "hermes",
    name: "Hermes Agent",
    version: getVersion("hermes --version"),
    memoryDbPath: existsSync(dbPath) ? dbPath : undefined,
    skills: readSkillDirs(join(home, "skills")),
    memoryCount: existsSync(dbPath) ? countHermesFacts(dbPath) : 0,
  };
}

/** 检测本地已安装的 agent */
export function detectAgents(): DetectedAgent[] {
  const out: DetectedAgent[] = [];
  const c = detectClaude();
  if (c) out.push(c);
  const h = detectHermes();
  if (h) out.push(h);
  return out;
}

/** 读取 hermes 记忆库中的事实条目（按时间倒序） */
export function readHermesFacts(dbPath: string, limit = 200): Array<{ content: string; category?: string; createdAt?: string }> {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare("SELECT content, category, created_at FROM facts ORDER BY created_at DESC LIMIT ?")
      .all(limit) as any[];
    db.close();
    return rows.map((r) => ({ content: r.content, category: r.category, createdAt: r.created_at }));
  } catch {
    return [];
  }
}
