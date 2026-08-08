import type { AgentConfig } from "@multiagent/shared";
import type { AgentAdapter } from "./types";
import { BuiltinAgentExecutor, type BuiltinAdapterDeps } from "./builtin/executor";

export interface AdapterRegistryDeps {
  providerRegistry: BuiltinAdapterDeps["providerRegistry"];
  toolRegistry: BuiltinAdapterDeps["toolRegistry"];
  appSettings: BuiltinAdapterDeps["appSettings"];
  askConfirm?: BuiltinAdapterDeps["askConfirm"];
}

/** 按 kind 创建适配器实例。未来新增 agent 类型在此扩展。 */
export function createAdapter(cfg: AgentConfig, deps: AdapterRegistryDeps): AgentAdapter {
  switch (cfg.kind) {
    case "builtin":
      return new BuiltinAgentExecutor(cfg, {
        providerRegistry: deps.providerRegistry,
        toolRegistry: deps.toolRegistry,
        appSettings: deps.appSettings,
        askConfirm: deps.askConfirm,
      });
    default: {
      const _exhaustive: never = cfg.kind;
      throw new Error(`unknown agent kind: ${String(_exhaustive)}`);
    }
  }
}

/** agent id → 适配器实例（惰性创建，启用/禁用时重建） */
export class AdapterRegistry {
  private map = new Map<string, AgentAdapter>();

  constructor(private deps: AdapterRegistryDeps) {}

  get(agentId: string): AgentAdapter {
    const found = this.map.get(agentId);
    if (!found) throw new Error(`agent not registered: ${agentId}`);
    return found;
  }

  has(agentId: string): boolean {
    return this.map.has(agentId);
  }

  register(cfg: AgentConfig): void {
    const existing = this.map.get(cfg.id);
    if (existing) void existing.dispose();
    this.map.set(cfg.id, createAdapter(cfg, this.deps));
  }

  unregister(agentId: string): void {
    const existing = this.map.get(agentId);
    if (existing) void existing.dispose();
    this.map.delete(agentId);
  }

  reload(agents: AgentConfig[]): void {
    for (const id of [...this.map.keys()]) {
      if (!agents.some((a) => a.id === id)) this.unregister(id);
    }
    for (const cfg of agents) {
      if (cfg.enabled) this.register(cfg);
    }
  }

  list(): string[] {
    return [...this.map.keys()];
  }

  disposeAll(): void {
    for (const adapter of this.map.values()) void adapter.dispose();
    this.map.clear();
  }
}
