import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { McpServerConfig } from "./types";

const now = () => new Date().toISOString();

/** MCP server 配置存储：configDir/mcp.json */
export class McpConfigStore {
  constructor(private file: string) {}

  private load(): McpServerConfig[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private saveAll(list: McpServerConfig[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(list, null, 2), "utf8");
  }

  list(): McpServerConfig[] {
    return this.load();
  }

  get(id: string): McpServerConfig | undefined {
    return this.load().find((c) => c.id === id);
  }

  save(cfg: McpServerConfig): McpServerConfig {
    const list = this.load();
    const idx = list.findIndex((c) => c.id === cfg.id);
    const next = { ...cfg, updatedAt: now() };
    if (idx >= 0) list[idx] = next;
    else list.push({ ...next, createdAt: now() });
    this.saveAll(list);
    return next;
  }

  delete(id: string): void {
    const list = this.load().filter((c) => c.id !== id);
    this.saveAll(list);
  }
}
