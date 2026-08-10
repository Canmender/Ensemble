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
import { MemoryPoolManager } from "./memory/pool";
import { Mem0Backend } from "./memory/mem0";
import { SqliteMemoryBackend } from "./memory/sql";
import type { MemoryBackend } from "./memory/backend";
import { McpConfigStore } from "./tools/mcp/config";
import { McpManager } from "./tools/mcp/manager";
import { OffloadStore } from "./context/offload";
import { SkillStore, BUILTIN_SKILLS } from "./skills";
import { makeMemoryTools } from "./tools/memory";
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
  memoryPoolManager: MemoryPoolManager;
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

  // 初始化双记忆池管理器
  const memoryPoolManager = new MemoryPoolManager(db, {
    explicitMaxEntries: 1000,
    implicitMaxEntries: 100,
    implicitTtlMs: 24 * 60 * 60 * 1000, // 24h
    injectMaxChars: 4000,
    importanceThreshold: 0.5,
  });

  registerBuiltinTools(toolRegistry, () => config.getSettings(), memoryPoolManager);

  const dataDir = dirname(env.dbPath);
  // 外部记忆后端：默认本地 SQL（SQLite + FTS5，免服务）；配置 Mem0 时切换到 Mem0
  const mem0Cfg = config.getSettings().mem0;
  const externalBackend: MemoryBackend | undefined =
    mem0Cfg?.enabled && mem0Cfg?.endpoint
      ? new Mem0Backend(mem0Cfg)
      : new SqliteMemoryBackend(db);
  const memoryProvider = new MemoryProviderImpl(
    join(dataDir, "memories"),
    (id) => config.getAgent(id),
    providerRegistry,
    externalBackend,
  );

  // 显式记忆工具（agent 自主 memory_write/read/list）
  for (const t of makeMemoryTools(() => externalBackend)) toolRegistry.register(t);

  const mcpConfig = new McpConfigStore(join(env.configDir, "mcp.json"));
  const mcpManager = new McpManager(mcpConfig, toolRegistry);
  void mcpManager.reload();

  // 每日维护：记忆 consolidate/轮转 + offload 清理 + 隐式记忆池过期清理
  // offload 目录：与 executor 保持一致（工作区内 .ensemble-offload）
  const offloadDir = config.getSettings().workspaceRoot;
  const workspaceOffload = offloadDir ? new OffloadStore(join(offloadDir, ".ensemble-offload")) : undefined;
  const dataOffload = new OffloadStore(join(dataDir, "offload", "agents"));
  const maintenanceTimer = setInterval(async () => {
    try {
      const wsRoot = config.getSettings().workspaceRoot;
      for (const a of config.listAgents()) {
        if (a.memory?.enabled) {
          // consolidate 按配置间隔判断（与 flushNow 内逻辑一致）
          const minInterval = a.memory.consolidateMinIntervalMs ?? 12 * 3600_000;
          const snap = await memoryProvider.snapshot(a.id);
          if (
            !snap.stats.lastConsolidateAt ||
            Date.now() - new Date(snap.stats.lastConsolidateAt).getTime() >= minInterval
          ) {
            void memoryProvider.consolidate(a.id).catch((err) =>
              logger.warn(`memory consolidate failed for ${a.id}: ${String(err)}`),
            );
          }
          memoryProvider.rotate(a.id, 90);
        }
        // 清理两个可能的 offload 目录
        dataOffload.cleanup(a.id, 7 * 86_400_000);
        if (wsRoot) {
          const wsOffload = new OffloadStore(join(wsRoot, ".ensemble-offload"));
          wsOffload.cleanup(a.id, 7 * 86_400_000);
        }
      }

      // 清理过期的隐式记忆池
      const cleaned = memoryPoolManager.cleanupExpired();
      if (cleaned > 0) {
        logger.info(`memory pool: cleaned ${cleaned} expired implicit memories`);
      }
    } catch (err) {
      logger.error(`maintenance timer error: ${String(err)}`);
    }
  }, 24 * 3600_000);
  maintenanceTimer.unref?.();

  // Skill 池（逐个补写内置 skill：已存在的跳过，新增的会补上）
  const skillRoot = join(dataDir, "skills");
  const skillStore = new SkillStore(skillRoot);
  for (const s of BUILTIN_SKILLS) {
    if (!skillStore.get(s.name)) {
      try {
        skillStore.save(s);
      } catch (err) {
        logger.warn(`bootstrap skill ${s.name} failed: ${String(err)}`);
      }
    }
  }

  // WS-based HITL 确认：通过 hub 向前端发送确认请求，等待用户响应
  const wsAskConfirm = async (tool: string, args: unknown, runId?: string): Promise<boolean> => {
    if (!runId) return false; // 无 runId（headless/CLI）→ 拒绝
    return hub.requestConfirm(runId, tool, args);
  };

  const registry = new AdapterRegistry({
    providerRegistry,
    toolRegistry,
    appSettings: () => config.getSettings(),
    askConfirm: wsAskConfirm,
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
    memoryPoolManager,
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
