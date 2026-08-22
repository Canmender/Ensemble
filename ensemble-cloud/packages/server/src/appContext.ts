import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  agentConfigSchema,
  workflowDefSchema,
  providerConfigSchema,
  appSettingsSchema,
  type AgentConfig,
  type AgentConfigInput,
  type AgentCapabilities,
  type WorkflowDef,
  type ProviderConfig,
  type ProviderConfigInput,
  type AppSettings,
} from "@ensemble/shared";
import { loadConfig } from "./config/loadConfig";
import type { ServerEnv } from "./config/env";
import { logger } from "./util/logger";

const now = () => new Date().toISOString();

/** 按工具集推导 capabilities */
export function deriveCapabilities(tools: string[]): AgentCapabilities {
  return {
    sessionResume: true,
    partialStreaming: true,
    toolUseEvents: tools.length > 0,
    concurrent: true,
    cwdConfigurable: true,
  };
}

/**
 * 配置管理：config/agents/*.yaml 与 config/workflows/*.json 为 source of truth。
 *
 * 设计：
 * - 读操作走内存缓存（agents / workflows / providers / settings），同步返回，不阻塞事件循环
 * - 写操作（CRUD / saveSettings）异步化：fs/promises 写入 + 互斥队列串行化，避免并发写盘冲突
 * - 写完成后刷新对应缓存
 */
export class ConfigManager {
  agents: AgentConfig[] = [];
  workflows: WorkflowDef[] = [];
  errors: string[] = [];
  private providersCache: ProviderConfig[] = [];
  private settingsCache?: AppSettings;

  /** 写操作互斥队列：保证同一时刻只有一个写盘在进行 */
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private env: ServerEnv) {
    this.reload();
    this.providersCache = this.loadProvidersSync();
  }

  /** 串行化写操作（前一个完成后才执行下一个） */
  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(fn, fn);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 从磁盘重载 agents/workflows 到缓存（构造与写操作后调用） */
  reload(): void {
    const loaded = loadConfig(this.env.configDir);
    this.agents = loaded.agents;
    this.workflows = loaded.workflows;
    this.errors = loaded.errors;
  }

  private refreshProviders(): void {
    this.providersCache = this.loadProvidersSync();
  }

  // ---------- Agents ----------
  listAgents(): AgentConfig[] {
    return this.agents;
  }

  getAgent(id: string): AgentConfig | undefined {
    return this.agents.find((a) => a.id === id);
  }

  async createAgent(input: AgentConfigInput): Promise<AgentConfig> {
    const parsed = agentConfigSchema.parse({
      ...input,
      capabilities: input.capabilities ?? deriveCapabilities(input.tools ?? []),
      createdAt: input.createdAt ?? now(),
      updatedAt: now(),
    }) as unknown as AgentConfig;
    return this.withWriteLock(async () => {
      // 锁内二次存在性检查，避免并发相同 id 双写
      if (this.getAgent(parsed.id)) throw new Error(`agent already exists: ${parsed.id}`);
      await this.saveAgentFile(parsed);
      this.reload();
      return parsed;
    });
  }

  async updateAgent(id: string, patch: Partial<AgentConfigInput>): Promise<AgentConfig> {
    return this.withWriteLock(async () => {
      const existing = this.getAgent(id);
      if (!existing) throw new Error(`agent not found: ${id}`);
      const merged: AgentConfig = {
        ...existing,
        ...patch,
        id: existing.id,
        kind: patch.kind ?? existing.kind,
        capabilities: patch.capabilities ?? existing.capabilities,
        updatedAt: now(),
      };
      const parsed = agentConfigSchema.parse(merged) as unknown as AgentConfig;
      await this.saveAgentFile(parsed);
      this.reload();
      return parsed;
    });
  }

  async deleteAgent(id: string): Promise<void> {
    const existing = this.getAgent(id);
    if (!existing) return;
    await this.withWriteLock(async () => {
      const file = resolve(this.env.configDir, "agents", `${id}.yaml`);
      await unlink(file).catch(() => {
        /* 文件已不存在 */
      });
      this.reload();
    });
  }

  private async saveAgentFile(cfg: AgentConfig): Promise<void> {
    const dir = resolve(this.env.configDir, "agents");
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, `${cfg.id}.yaml`);
    await writeFile(file, yaml.dump(cfg, { noRefs: true }), "utf8");
    logger.info(`agent saved: ${file}`);
  }

  // ---------- Workflows ----------
  listWorkflows(): WorkflowDef[] {
    return this.workflows;
  }

  getWorkflow(id: string): WorkflowDef | undefined {
    return this.workflows.find((w) => w.id === id);
  }

  async saveWorkflow(input: WorkflowDef): Promise<WorkflowDef> {
    const def = workflowDefSchema.parse(input);
    return this.withWriteLock(async () => {
      const dir = resolve(this.env.configDir, "workflows");
      await mkdir(dir, { recursive: true });
      await writeFile(resolve(dir, `${def.id}.json`), JSON.stringify(def, null, 2), "utf8");
      this.reload();
      return def;
    });
  }

  async deleteWorkflow(id: string): Promise<void> {
    const existing = this.getWorkflow(id);
    if (!existing) return;
    await this.withWriteLock(async () => {
      const file = resolve(this.env.configDir, "workflows", `${id}.json`);
      await unlink(file).catch(() => {
        /* 文件已不存在 */
      });
      this.reload();
    });
  }

  // ---------- Providers ----------
  /** 同步读 providers 目录（仅构造与写后刷新调用，低频） */
  private loadProvidersSync(): ProviderConfig[] {
    const dir = resolve(this.env.configDir, "providers");
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    return files
      .map((f) => {
        try {
          return JSON.parse(readFileSync(resolve(dir, f), "utf8")) as ProviderConfig;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as ProviderConfig[];
  }

  listProviders(): ProviderConfig[] {
    return this.providersCache.map((p) => ({ ...p, apiKey: undefined, apiKeySet: !!p.apiKeySet }));
  }

  getProvider(id: string): ProviderConfig | undefined {
    return this.listProviders().find((p) => p.id === id);
  }

  async createProvider(input: ProviderConfigInput): Promise<ProviderConfig> {
    // apiKey 永不入配置（存 KeyStore），仅记录 apiKeySet 标记
    const { apiKey, ...rest } = input;
    const parsed = providerConfigSchema.parse({
      ...rest,
      apiKeySet: !!apiKey,
      createdAt: input.createdAt ?? now(),
      updatedAt: now(),
    }) as unknown as ProviderConfig;
    return this.withWriteLock(async () => {
      const dir = resolve(this.env.configDir, "providers");
      await mkdir(dir, { recursive: true });
      await writeFile(
        resolve(dir, `${parsed.id}.json`),
        JSON.stringify(parsed, null, 2),
        "utf8",
      );
      this.refreshProviders();
      return { ...parsed, apiKey: undefined };
    });
  }

  async updateProvider(id: string, patch: Partial<ProviderConfigInput>): Promise<ProviderConfig> {
    return this.withWriteLock(async () => {
      const existing = this.getProvider(id);
      if (!existing) throw new Error(`provider not found: ${id}`);
      const { apiKey, ...rest } = patch;
      const merged = providerConfigSchema.parse({
        ...existing,
        ...rest,
        id: existing.id,
        type: existing.type,
        apiKeySet: apiKey ? true : existing.apiKeySet,
        updatedAt: now(),
      }) as unknown as ProviderConfig;
      const dir = resolve(this.env.configDir, "providers");
      await mkdir(dir, { recursive: true });
      await writeFile(resolve(dir, `${id}.json`), JSON.stringify(merged, null, 2), "utf8");
      this.refreshProviders();
      return { ...merged, apiKey: undefined };
    });
  }

  async deleteProvider(id: string): Promise<void> {
    await this.withWriteLock(async () => {
      const file = resolve(this.env.configDir, "providers", `${id}.json`);
      await unlink(file).catch(() => {
        /* 文件已不存在 */
      });
      this.refreshProviders();
    });
  }

  // ---------- Settings ----------
  getSettings(): AppSettings {
    if (this.settingsCache) return this.settingsCache;
    const file = resolve(this.env.configDir, "settings.json");
    let raw: AppSettings;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      raw = {
        workspaceRoot: "",
        codeExecutionConfirm: "ask",
      } as AppSettings;
    }
    const parsed = appSettingsSchema.parse(raw) as unknown as AppSettings;
    this.settingsCache = parsed;
    return parsed;
  }

  async saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.withWriteLock(async () => {
      // 锁内读-改-写，避免并发更新丢失
      const merged = {
        ...this.getSettings(),
        ...patch,
      };
      const parsed = appSettingsSchema.parse(merged) as unknown as AppSettings;
      const file = resolve(this.env.configDir, "settings.json");
      await mkdir(this.env.configDir, { recursive: true });
      await writeFile(file, JSON.stringify(parsed, null, 2), "utf8");
      this.settingsCache = parsed;
      return parsed;
    });
  }
}
