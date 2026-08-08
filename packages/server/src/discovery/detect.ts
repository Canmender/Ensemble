import { homedir } from "node:os";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import type { DetectedAgent, DetectedSkill } from "./types";

interface HarnessDef {
  type: string;
  name: string;
  cmd: string;
  headless: string;
  promptMode: "arg" | "stdin";
  configDir?: string;
  /** hermes 特有：记忆库文件名 */
  memoryDb?: string;
}

/** 常用 agent harness 注册表（自动识别） */
const HARNESSES: HarnessDef[] = [
  { type: "claude", name: "Claude Code", cmd: "claude", headless: "claude -p", promptMode: "arg", configDir: ".claude" },
  { type: "codex", name: "Codex CLI", cmd: "codex", headless: "codex exec", promptMode: "arg", configDir: ".codex" },
  { type: "opencode", name: "OpenCode", cmd: "opencode", headless: "opencode run", promptMode: "arg", configDir: ".opencode" },
  { type: "aider", name: "Aider", cmd: "aider", headless: "aider --message", promptMode: "arg", configDir: ".aider" },
  { type: "goose", name: "Goose", cmd: "goose", headless: "goose run", promptMode: "arg", configDir: ".goose" },
  { type: "hermes", name: "Hermes Agent", cmd: "hermes", headless: "hermes -z", promptMode: "arg", configDir: ".hermes", memoryDb: "memory_store.db" },
  { type: "qwen", name: "Qwen Code", cmd: "qwen", headless: "qwen -p", promptMode: "arg", configDir: ".qwen" },
  { type: "gemini", name: "Gemini CLI", cmd: "gemini", headless: "gemini -p", promptMode: "arg", configDir: ".gemini" },
  { type: "antigravity", name: "Antigravity", cmd: "antigravity", headless: "antigravity -p", promptMode: "arg", configDir: ".antigravity" },
];

function commandExists(cmd: string): boolean {
  try {
    execSync(process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`, {
      timeout: 2000,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function getVersion(cmd: string): string | undefined {
  try {
    const out = execSync(`${cmd} --version`, { encoding: "utf8", timeout: 2000 });
    return out.trim().split("\n")[0].slice(0, 80);
  } catch {
    return undefined;
  }
}

function readSkillDirs(dir: string): DetectedSkill[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => existsSync(join(dir, n, "SKILL.md")))
    .map((n) => ({ name: n, sourcePath: join(dir, n, "SKILL.md") }));
}

function countFacts(dbPath: string): number {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const r = db.prepare("SELECT COUNT(*) AS c FROM facts").get() as { c: number };
    return Number(r?.c ?? 0);
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}

function detectHarness(def: HarnessDef): DetectedAgent | null {
  if (!commandExists(def.cmd)) return null;
  const home = join(homedir(), def.configDir ?? "");
  const configPath = existsSync(home) ? home : undefined;
  let memoryDbPath: string | undefined;
  if (def.memoryDb && configPath) {
    const db = join(configPath, def.memoryDb);
    if (existsSync(db)) memoryDbPath = db;
  }
  return {
    type: def.type,
    name: def.name,
    cmd: def.cmd,
    headless: def.headless,
    promptMode: def.promptMode,
    version: getVersion(`${def.cmd} --version`),
    configPath,
    memoryDbPath,
    skills: configPath ? readSkillDirs(join(configPath, "skills")) : [],
    memoryCount: memoryDbPath ? countFacts(memoryDbPath) : 0,
  };
}

// 缓存检测结果（30s TTL）：避免每次请求都同步执行命令阻塞事件循环
let detectCache: { agents: DetectedAgent[]; at: number } | null = null;
const CACHE_TTL = 30_000;

/** 检测本地已安装的 agent harness（带缓存；force=true 强制刷新） */
export function detectAgents(force = false): DetectedAgent[] {
  if (!force && detectCache && Date.now() - detectCache.at < CACHE_TTL) {
    return detectCache.agents;
  }
  const out: DetectedAgent[] = [];
  for (const def of HARNESSES) {
    const a = detectHarness(def);
    if (a) out.push(a);
  }
  detectCache = { agents: out, at: Date.now() };
  return out;
}

/** 读取 hermes 记忆库中的事实条目（按时间倒序） */
export function readHermesFacts(dbPath: string, limit = 200): Array<{ content: string; category?: string; createdAt?: string }> {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare("SELECT content, category, created_at FROM facts ORDER BY created_at DESC LIMIT ?")
      .all(limit) as any[];
    return rows.map((r) => ({ content: r.content, category: r.category, createdAt: r.created_at }));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}
