import type { DatabaseSync } from "node:sqlite";
import { resolve, join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { ServerEnv } from "./config/env";
import { ConfigManager } from "./appContext";
import { Store } from "./orchestration/store";
import { UserStore } from "./db/users";
import { detectAgents } from "./discovery/detect";
import { syncAgent } from "./discovery/sync";
import { AdapterRegistry } from "./adapters/registry";
import { OrchestrationEngine } from "./orchestration/engine";
import { WsHub } from "./api/ws/hub";
import type { RunEvent } from "./api/ws/protocol";
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
import { embedTexts, type EmbedFn, type EmbeddingOptions } from "./tools/embedding";
import type { ProviderRuntimeConfig } from "./llm/types";

/**
 * 解析 RAG 向量检索的嵌入函数：
 * - embeddingUrl/model 优先用 settings.rag 的配置
 * - 缺省时复用默认 provider（defaultProviderId 优先，否则第一个启用的 OpenAI 兼容 provider）的
 *   baseUrl / apiKey / 默认模型
 * - 无法解析出 baseUrl+model 时返回 undefined（向量检索退化为仅 BM25）
 */
export function resolveEmbedFn(config: ConfigManager, providerRegistry: ProviderRegistry): EmbedFn | undefined {
  const rag = config.getSettings().rag;
  if (!rag?.enabled) return undefined;

  let providerCfg: ProviderRuntimeConfig | undefined;
  const defaultId = config.getSettings().defaultProviderId;
  if (defaultId) providerCfg = providerRegistry.getRuntimeConfig(defaultId);
  if (!providerCfg) {
    for (const id of providerRegistry.list()) {
      const cfg = providerRegistry.getRuntimeConfig(id);
      if (cfg && (cfg.type === "openai" || cfg.type === "custom")) {
        providerCfg = cfg;
        break;
      }
    }
  }

  const baseUrl = rag.embeddingUrl ?? providerCfg?.baseUrl;
  const model = rag.embeddingModel ?? providerCfg?.defaultModel;
  if (!baseUrl || !model) return undefined;

  const opts: EmbeddingOptions = {
    baseUrl,
    model,
    apiKey: providerCfg?.apiKey,
    extraHeaders: providerCfg?.extraHeaders,
  };
  return (texts: string[]) => embedTexts(opts, texts);
}

/** 应用服务容器：把所有模块组装起来，供 API 层使用 */
export interface AppContext {
  env: ServerEnv;
  db: DatabaseSync;
  /** 聊天附件（图片/文件）存储目录 */
  uploadsDir: string;
  /** 移动端应用包托管目录（APK + version.json） */
  apkDir: string;
  config: ConfigManager;
  store: Store;
  userStore: UserStore;
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
  const userStore = new UserStore(db);
  const hub = new WsHub();
  // headless/Docker 部署：用固定 API key 覆盖随机 session token（HTTP + WS 统一凭证）
  if (env.apiKey) hub.overrideToken(env.apiKey);
  // 设置 store 引用（用于离线推送）
  hub.store = store;
  // 设备多端在线：WS 上线注册设备表，下线/上线广播给同用户其他设备
  hub.onDeviceStatus = (userId, device, online) => {
    if (online) {
      store.upsertDevice({ id: device.id, userId, name: device.name, type: device.type });
      // 去重：清理同类型同名称的离线旧设备（重装后设备 ID 变化产生的"我的手机"残留）
      if (device.type === "mobile") {
        store.cleanupDuplicateDevices(userId, device.id, device.name, device.type, hub.getOnlineDeviceIds(userId));
      }
    }
    const event: RunEvent = { type: "device.status", deviceId: device.id, name: device.name, kind: device.type, online };
    hub.broadcastToUser(userId, event);
  };
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

  registerBuiltinTools(toolRegistry, () => config.getSettings(), memoryPoolManager, resolveEmbedFn(config, providerRegistry));

  const dataDir = dirname(env.dbPath);
  // 聊天附件存储目录（图片/文件上传）
  const uploadsDir = join(dataDir, "uploads");
  mkdirSync(uploadsDir, { recursive: true });
  // 移动端应用包托管目录（app-version 接口 + APK 文件）
  const apkDir = join(dataDir, "apk");
  mkdirSync(apkDir, { recursive: true });
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

  // 启动时自动接入本机已安装的 agent harness（opencode / claude / hermes 等，默认启用）
  if (env.autoSyncLocal) {
    void (async () => {
      try {
        const detected = detectAgents();
        for (const agent of detected) {
          await syncAgent(agent, { skillStore, memoryProvider, configManager: config });
        }
        if (detected.length) reloadAgents();
      } catch (err) {
        logger.warn(`auto-sync local agents failed: ${String(err)}`);
      }
    })();
  }

  return {
    env,
    db,
    uploadsDir,
    apkDir,
    config,
    store,
    userStore,
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
