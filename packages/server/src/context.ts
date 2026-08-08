import type { DatabaseSync } from "node:sqlite";
import { resolve, join, dirname } from "node:path";
import type { ServerEnv } from "./config/env";
import { ConfigManager } from "./appContext";
import { Store } from "./orchestration/store";
import { AdapterRegistry } from "./adapters/registry";
import { OrchestrationEngine } from "./orchestration/engine";
import { WsHub } from "./api/ws/hub";
import { ProviderRegistry } from "./llm/registry";
import { FileKeyStore, type KeyStore } from "./keychain";
import { ToolRegistry } from "./tools/types";
import { registerBuiltinTools } from "./tools";
import { MemoryProviderImpl, type MemoryProvider } from "./memory/provider";
import { Mem0Backend } from "./memory/mem0";
import { McpConfigStore } from "./tools/mcp/config";
import { McpManager } from "./tools/mcp/manager";
import { OffloadStore } from "./context/offload";
import { SkillStore, BUILTIN_SKILLS } from "./skills";
import { logger } from "./util/logger";

/** 应用服务容器：把所有模块组装起来，供 API 层使用 */
export interface AppContext {
  env: ServerEnv;
  db: DatabaseSync;
  config: ConfigManager;
  store: Store;
  registry: AdapterRegistry;
  engine: OrchestrationEngine;
  hub: WsHub;
  keyStore: KeyStore;
  providerRegistry: ProviderRegistry;
  toolRegistry: ToolRegistry;
  memoryProvider: MemoryProvider;
  skillStore: SkillStore;
  mcpConfig: McpConfigStore;
  mcpManager: McpManager;
  reloadAgents: () => void;
  reloadProviders: () => void;
  dispose: () => Promise<void>;
}

export interface CreateContextDeps {
  /** 密钥存储（桌面版传 Electron safeStorage 实现；缺省明文文件） */
  keyStore?: KeyStore;
  /** 工具执行确认回调（桌面 IPC 弹窗；缺省自动允许） */
  askConfirm?: (tool: string, args: unknown) => Promise<boolean>;
}

export function createAppContext(
  env: ServerEnv,
  db: DatabaseSync,
  deps: CreateContextDeps = {},
): AppContext {
  const config = new ConfigManager(env);
  const store = new Store(db);
  const hub = new WsHub();
  const keyStore = deps.keyStore ?? new FileKeyStore(resolve(env.configDir, "secrets.json"));
  const providerRegistry = new ProviderRegistry(keyStore);
  const toolRegistry = new ToolRegistry();
  registerBuiltinTools(toolRegistry, () => config.getSettings());

  const dataDir = dirname(env.dbPath);
  const mem0Cfg = config.getSettings().mem0;
  const mem0Backend =
    mem0Cfg?.enabled && mem0Cfg?.endpoint ? new Mem0Backend(mem0Cfg) : undefined;
  const memoryProvider = new MemoryProviderImpl(
    join(dataDir, "memories"),
    (id) => config.getAgent(id),
    providerRegistry,
    mem0Backend,
  );

  const mcpConfig = new McpConfigStore(join(env.configDir, "mcp.json"));
  const mcpManager = new McpManager(mcpConfig, toolRegistry);
  void mcpManager.reload();

  // 每日维护：记忆 consolidate/轮转 + offload 清理
  const offloadStore = new OffloadStore(join(dataDir, "offload", "agents"));
  const maintenanceTimer = setInterval(async () => {
    for (const a of config.listAgents()) {
      if (a.memory?.enabled) {
        // consolidate 按配置间隔判断（与 flushNow 内逻辑一致）
        const minInterval = a.memory.consolidateMinIntervalMs ?? 12 * 3600_000;
        const snap = await memoryProvider.snapshot(a.id);
        if (
          !snap.stats.lastConsolidateAt ||
          Date.now() - new Date(snap.stats.lastConsolidateAt).getTime() >= minInterval
        ) {
          void memoryProvider.consolidate(a.id).catch(() => {});
        }
        memoryProvider.rotate(a.id, 90);
      }
      offloadStore.cleanup(a.id, 7 * 86_400_000);
    }
  }, 24 * 3600_000);
  maintenanceTimer.unref?.();

  // Skill 池（首次写入内置 skill）
  const skillRoot = join(dataDir, "skills");
  const skillStore = new SkillStore(skillRoot);
  if (skillStore.list().length === 0) {
    for (const s of BUILTIN_SKILLS) {
      try {
        skillStore.save(s);
      } catch (err) {
        logger.warn(`bootstrap skill ${s.name} failed: ${String(err)}`);
      }
    }
  }

  const registry = new AdapterRegistry({
    providerRegistry,
    toolRegistry,
    appSettings: () => config.getSettings(),
    askConfirm: deps.askConfirm,
    offloadBaseDir: join(dataDir, "offload"),
    memoryProvider,
    skillStore,
  });
  const engine = new OrchestrationEngine(store, registry, hub, (id) => config.getWorkflow(id));

  reloadAgents();
  reloadProviders();

  /** 把 config 中的 agents 同步到 registry 与 engine（新增/修改 agent 后调用） */
  function reloadAgents(): void {
    registry.reload(config.listAgents());
    engine.setAgents(config.listAgents());
  }

  /** 把 config 中的 providers 同步到 ProviderRegistry（新增/修改 provider 后调用） */
  function reloadProviders(): void {
    providerRegistry.reload(config.listProviders());
  }

  return {
    env,
    db,
    config,
    store,
    registry,
    engine,
    hub,
    keyStore,
    providerRegistry,
    toolRegistry,
    memoryProvider,
    skillStore,
    mcpConfig,
    mcpManager,
    reloadAgents,
    reloadProviders,
    dispose: async () => {
      clearInterval(maintenanceTimer);
      registry.disposeAll();
      memoryProvider.dispose();
      await mcpManager.dispose();
      hub.close();
    },
  };
}
