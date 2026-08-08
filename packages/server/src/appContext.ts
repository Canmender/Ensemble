import { mkdirSync, writeFileSync, unlinkSync, existsSync, readdirSync, readFileSync } from "node:fs";
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
} from "@multiagent/shared";
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
 * 启动时加载校验，CRUD 操作写回文件。
 */
export class ConfigManager {
  agents: AgentConfig[] = [];
  workflows: WorkflowDef[] = [];
  errors: string[] = [];

  constructor(private env: ServerEnv) {
    this.reload();
  }

  reload(): void {
    const loaded = loadConfig(this.env.configDir);
    this.agents = loaded.agents;
    this.workflows = loaded.workflows;
    this.errors = loaded.errors;
  }

  // ---------- Agents ----------
  listAgents(): AgentConfig[] {
    return this.agents;
  }

  getAgent(id: string): AgentConfig | undefined {
    return this.agents.find((a) => a.id === id);
  }

  createAgent(input: AgentConfigInput): AgentConfig {
    const parsed = agentConfigSchema.parse({
      ...input,
      capabilities: input.capabilities ?? deriveCapabilities(input.tools ?? []),
      createdAt: input.createdAt ?? now(),
      updatedAt: now(),
    }) as unknown as AgentConfig;
    if (this.getAgent(parsed.id)) throw new Error(`agent already exists: ${parsed.id}`);
    this.saveAgentFile(parsed);
    this.reload();
    return parsed;
  }

  updateAgent(id: string, patch: Partial<AgentConfigInput>): AgentConfig {
    const existing = this.getAgent(id);
    if (!existing) throw new Error(`agent not found: ${id}`);
    const merged: AgentConfig = {
      ...existing,
      ...patch,
      id: existing.id,
      kind: "builtin",
      capabilities: patch.capabilities ?? existing.capabilities,
      updatedAt: now(),
    };
    const parsed = agentConfigSchema.parse(merged) as unknown as AgentConfig;
    this.saveAgentFile(parsed);
    this.reload();
    return parsed;
  }

  deleteAgent(id: string): void {
    const existing = this.getAgent(id);
    if (!existing) return;
    const file = resolve(this.env.configDir, "agents", `${id}.yaml`);
    if (existsSync(file)) unlinkSync(file);
    this.reload();
  }

  private saveAgentFile(cfg: AgentConfig): void {
    const dir = resolve(this.env.configDir, "agents");
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `${cfg.id}.yaml`);
    writeFileSync(file, yaml.dump(cfg, { noRefs: true }), "utf8");
    logger.info(`agent saved: ${file}`);
  }

  // ---------- Workflows ----------
  listWorkflows(): WorkflowDef[] {
    return this.workflows;
  }

  getWorkflow(id: string): WorkflowDef | undefined {
    return this.workflows.find((w) => w.id === id);
  }

  saveWorkflow(input: WorkflowDef): WorkflowDef {
    const def = workflowDefSchema.parse(input);
    const dir = resolve(this.env.configDir, "workflows");
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `${def.id}.json`);
    writeFileSync(file, JSON.stringify(def, null, 2), "utf8");
    this.reload();
    return def;
  }

  deleteWorkflow(id: string): void {
    const file = resolve(this.env.configDir, "workflows", `${id}.json`);
    if (existsSync(file)) unlinkSync(file);
    this.reload();
  }

  // ---------- Providers ----------
  providers: ProviderConfig[] = [];

  private loadProviders(): ProviderConfig[] {
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
    this.providers = this.loadProviders();
    return this.providers.map((p) => ({ ...p, apiKey: undefined, apiKeySet: !!p.apiKeySet }));
  }

  getProvider(id: string): ProviderConfig | undefined {
    return this.listProviders().find((p) => p.id === id);
  }

  createProvider(input: ProviderConfigInput): ProviderConfig {
    // apiKey 永不入配置（存 KeyStore），仅记录 apiKeySet 标记
    const { apiKey, ...rest } = input;
    const parsed = providerConfigSchema.parse({
      ...rest,
      apiKeySet: !!apiKey,
      createdAt: input.createdAt ?? now(),
      updatedAt: now(),
    }) as unknown as ProviderConfig;
    const dir = resolve(this.env.configDir, "providers");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, `${parsed.id}.json`),
      JSON.stringify(parsed, null, 2),
      "utf8",
    );
    return { ...parsed, apiKey: undefined };
  }

  updateProvider(id: string, patch: Partial<ProviderConfigInput>): ProviderConfig {
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
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${id}.json`), JSON.stringify(merged, null, 2), "utf8");
    return { ...merged, apiKey: undefined };
  }

  deleteProvider(id: string): void {
    const file = resolve(this.env.configDir, "providers", `${id}.json`);
    if (existsSync(file)) unlinkSync(file);
  }

  // ---------- Settings ----------
  private settingsCache?: AppSettings;

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

  saveSettings(patch: Partial<AppSettings>): AppSettings {
    const merged = {
      ...this.getSettings(),
      ...patch,
    };
    const parsed = appSettingsSchema.parse(merged) as unknown as AppSettings;
    const file = resolve(this.env.configDir, "settings.json");
    mkdirSync(this.env.configDir, { recursive: true });
    writeFileSync(file, JSON.stringify(parsed, null, 2), "utf8");
    this.settingsCache = parsed;
    return parsed;
  }
}
