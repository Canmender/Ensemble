import {
  mkdirSync, appendFileSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, statSync, unlinkSync,
} from "node:fs";
import { join } from "node:path";
import type { MemoryDailyEntry, MemorySnapshot } from "./types";
import { logger } from "../util/logger";

interface Meta {
  lastFlushAt?: string;
  lastConsolidateAt?: string;
  flushCount?: number;
  consolidateCount?: number;
  /** 记忆 LLM 调用累计 token（成本遥测） */
  memUsageTokens?: number;
}

/**
 * 两级记忆存储：<root>/<agentId>/daily/YYYY-MM-DD.md（Tier1）+ MEMORY.md（Tier2）+ meta.json。
 * agentId 受 ^[a-z0-9-]+$ 约束，天然防路径穿越。
 */
export class MemoryStore {
  constructor(private root: string) {}

  private agentDir(agentId: string): string {
    return join(this.root, agentId);
  }

  ensureAgent(agentId: string): string {
    const dir = this.agentDir(agentId);
    mkdirSync(join(dir, "daily"), { recursive: true });
    return dir;
  }

  appendDaily(agentId: string, date: string, block: string): void {
    this.ensureAgent(agentId);
    const file = join(this.agentDir(agentId), "daily", `${date}.md`);
    appendFileSync(file, block, "utf8");
  }

  readDaily(agentId: string, date: string): string | undefined {
    try {
      return readFileSync(join(this.agentDir(agentId), "daily", `${date}.md`), "utf8");
    } catch (err) {
      logger.warn(`memory readDaily failed for ${agentId}/${date}: ${String(err)}`);
      return undefined;
    }
  }

  listDaily(agentId: string): MemoryDailyEntry[] {
    const dir = join(this.agentDir(agentId), "daily");
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => {
          const st = statSync(join(dir, f));
          const content = readFileSync(join(dir, f), "utf8");
          return {
            date: f.replace(".md", ""),
            sizeBytes: st.size,
            lineCount: content.split("\n").length,
            updatedAt: st.mtime.toISOString(),
          };
        })
        .sort((a, b) => b.date.localeCompare(a.date));
    } catch (err) {
      logger.warn(`memory listDaily failed for ${agentId}: ${String(err)}`);
      return [];
    }
  }

  readMemoryFile(agentId: string): { content: string; updatedAt: string } | undefined {
    const file = join(this.agentDir(agentId), "MEMORY.md");
    try {
      return { content: readFileSync(file, "utf8"), updatedAt: statSync(file).mtime.toISOString() };
    } catch (err) {
      logger.warn(`memory readMemoryFile failed for ${agentId}: ${String(err)}`);
      return undefined;
    }
  }

  writeMemoryFile(agentId: string, content: string): void {
    this.ensureAgent(agentId);
    writeFileSync(join(this.agentDir(agentId), "MEMORY.md"), content, "utf8");
  }

  readMeta(agentId: string): Meta {
    try {
      return JSON.parse(readFileSync(join(this.agentDir(agentId), "meta.json"), "utf8"));
    } catch (err) {
      logger.warn(`memory readMeta failed for ${agentId}: ${String(err)}`);
      return {};
    }
  }

  writeMeta(agentId: string, patch: Partial<Meta>): void {
    const meta = { ...this.readMeta(agentId), ...patch };
    writeFileSync(join(this.ensureAgent(agentId), "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  }

  snapshot(agentId: string): MemorySnapshot {
    const memoryFile = this.readMemoryFile(agentId);
    const meta = this.readMeta(agentId);
    return {
      agentId,
      memoryFile: memoryFile ? { ...memoryFile, sizeBytes: memoryFile.content.length } : undefined,
      dailyLogs: this.listDaily(agentId),
      stats: {
        lastFlushAt: meta.lastFlushAt,
        lastConsolidateAt: meta.lastConsolidateAt,
        flushCount: meta.flushCount ?? 0,
        consolidateCount: meta.consolidateCount ?? 0,
        memUsageTokens: meta.memUsageTokens ?? 0,
      },
    };
  }

  clear(agentId: string): void {
    const dir = this.agentDir(agentId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  /** 轮转：清理 keepDays 之前的 daily 日志，返回删除数 */
  rotate(agentId: string, keepDays = 90): number {
    const dir = join(this.agentDir(agentId), "daily");
    let removed = 0;
    const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString().slice(0, 10);
    try {
      for (const f of readdirSync(dir)) {
        const date = f.replace(/\.md$/, "");
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < cutoff) {
          unlinkSync(join(dir, f));
          removed++;
        }
      }
    } catch (err) {
      logger.warn(`memory rotate failed for ${agentId}: ${String(err)}`);
    }
    return removed;
  }

  /** 累计记忆 LLM 调用 token */
  addUsage(agentId: string, tokens: number): void {
    if (!tokens) return;
    const meta = this.readMeta(agentId);
    this.writeMeta(agentId, { memUsageTokens: (meta.memUsageTokens ?? 0) + tokens });
  }
}
