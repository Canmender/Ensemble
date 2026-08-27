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
import { sendExpoPushBatch } from "./push/push";
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
import { PluginHost } from "./plugins/kernel";
import { ragPlugin } from "./plugins/tools";
import { maintenancePlugin } from "./plugins/services";
import { EventBus } from "./plugins/events";
import { PerUserPluginManager } from "./plugins/per-user";
import { PluginUserKv } from "./plugins/user-kv";
import { DeviceLinkLog } from "./plugins/device-link-log";
import type { StorageAdapter } from "./storage";
import { LocalStorageAdapter } from "./storage";
import { dailyReminderPlugin } from "./plugins/builtin/daily-reminder";
import { pollPlugin } from "./plugins/builtin/poll";
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
  /** 插件宿主（cordis 思想）：RAG 等可重装工具插件挂载于此 */
  pluginHost: PluginHost;
  /** 路由注册表（createApp 装配时填充；插件经此挂子路由） */
  routerRegistry?: import("./plugins/routers").RouterRegistry;
  /** per-user 插件管理器（R4 用户主权模型） */
  userPlugins: PerUserPluginManager;
  /** 互联事件本地日志（L1：设备配对信令的断线补拉回放源） */
  deviceLinkLog: import("./plugins/device-link-log").DeviceLinkLog;
  /** 文件存储适配器（本地/S3/OSS 统一抽象；零外部依赖） */
  storage: import("./storage").StorageAdapter;
  reloadAgents: () => void;
  reloadProviders: () => void;
  dispose: () => Promise<void>;
}

export interface CreateContextDeps {
  /** 密钥存储（桌面版传 Electron safeStorage 实现；缺省明文文件） */
  keyStore?: KeyStore;
}

/** 向离线用户设备发送推送通知（chat-broadcaster 调用；尽力而为，失败静默） */
async function pushOfflineUsers(
  store: Store,
  hub: WsHub,
  runId: string,
  content: string,
  agentId: string,
): Promise<void> {
  try {
    const conv = store.getConversationByRunId(runId);
    if (!conv || conv.muted) return;
    const participants = conv.participantIds;
    if (!participants.length) return;
    const title = conv.title || "新消息";
    const body = content.length > 100 ? content.slice(0, 100) + "..." : content;
    for (const uid of participants) {
      // 跳过发送者自身（不给自己推）
      if (uid === agentId) continue;
      // 在线用户不推送（WS 实时送达）
      const onlineDevices = hub.getOnlineDeviceIds(uid);
      if (onlineDevices.size > 0) continue;
      const tokens = store.getPushTokens(uid);
      if (tokens.length > 0) {
        await sendExpoPushBatch(tokens, { title, body, data: { convId: conv.id, type: "chat" }, priority: "high" });
      }
    }
  } catch (err) {
    logger.warn(`push notification error: ${String(err)}`);
  }
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
  hub.getSettings = () => config.getSettings();

  // 事件总线（R3）：hub/engine 解耦的枢纽——engine emit chat/message，hub 挂观察者广播
  const pluginHost = new PluginHost();
  const events = new EventBus(pluginHost);
  // EventBus 进服务容器：用户插件经 ctx.get("events") 发消息（吃自己种的菜）
  pluginHost.register({
    name: "event-bus-provider",
    inject: [],
    install: (ctx) => ctx.provide("events", events),
  }).catch(() => {});
  // 设备多端在线：WS 上线 → emit device/status（观察者写设备表 + 定向广播）
  hub.onDeviceStatus = (userId, device, online) => {
    events.emit("device/status", { userId, device, online });
  };
  pluginHost.register({
    name: "device-status-recorder",
    install: (ctx) => {
      ctx.on("device/status", (payload) => {
        const d = payload as { userId: string; device: { id: string; name: string; type: string }; online: boolean };
        if (d.online) {
          store.upsertDevice({ id: d.device.id, userId: d.userId, name: d.device.name, type: d.device.type });
          // 去重：清理同类型同名称的离线旧设备（重装后设备 ID 变化产生的"我的手机"残留）
          if (d.device.type === "mobile") {
            store.cleanupDuplicateDevices(d.userId, d.device.id, d.device.name, d.device.type, hub.getOnlineDeviceIds(d.userId));
          }
        }
        const event: RunEvent = { type: "device.status", deviceId: d.device.id, name: d.device.name, kind: d.device.type, online: d.online };
        hub.broadcastToUser(d.userId, event);
      });
    },
  }).catch(() => {});
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
  // RAG 工具走插件形态（配置变更可 unregister+register 干净重装）；
  // 后续第三方工具包/存储后端并列注册均挂载于 pluginHost。
  void pluginHost.register(
    ragPlugin({
      registry: toolRegistry,
      getSettings: () => config.getSettings(),
      embedFn: resolveEmbedFn(config, providerRegistry),
    }),
  );

  const dataDir = dirname(env.dbPath);
  // 聊天附件存储目录（图片/文件上传）
  const uploadsDir = join(dataDir, "uploads");
  mkdirSync(uploadsDir, { recursive: true });
  // 文件存储适配器（零外部依赖，本地落盘；未来扩展 S3/OSS 只需新建适配器）
  const storage = new LocalStorageAdapter(uploadsDir);
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

  // 每日维护体：记忆 consolidate/轮转 + offload 清理 + 隐式记忆池过期清理。
  // 定时器经 maintenancePlugin effect 化（dispose 由插件内核接管，不再手动 clearInterval）。
  const offloadDir = config.getSettings().workspaceRoot;
  const dataOffload = new OffloadStore(join(dataDir, "offload", "agents"));
  const runMaintenance = async (): Promise<void> => {
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
  };
  void pluginHost.register(maintenancePlugin({
    runMaintenance,
    intervalMs: (config.getSettings().im?.maintenanceIntervalH ?? 24) * 3600_000,
  }));

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

  // HITL 确认（R3 事件化）：走 tool/confirm 异步短路瀑布——插件可先于 UI 决策
  // （自动审批策略等）；无监听器短路时 fallback 到 WS 弹窗等待用户（超时拒绝）。
  const wsAskConfirm = async (tool: string, args: unknown, runId?: string): Promise<boolean> => {
    if (!runId) return false; // 无 runId（headless/CLI）→ 拒绝
    return events.requestToolConfirm({ runId, tool, args }, () => hub.requestConfirm(runId, tool, args));
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
  // engine emit chat/message 经事件总线；hub 挂观察者广播（见下方 chat-broadcaster 插件）
  const engine = new OrchestrationEngine(store, registry, hub, (id) => config.getWorkflow(id), events);

  void pluginHost.register({
    name: "chat-broadcaster",
    install: (ctx) => {
      ctx.on("chat/message", (payload) => {
        const m = payload as { runId: string; id: string; seq: number; jobId?: string; agentId: string; content: string; attachment?: unknown; userId?: string };
        hub.broadcast(m.runId, 0, {
          type: "chat.message",
          jobId: m.jobId ?? "",
          agentId: m.agentId,
          content: m.content,
          attachment: m.attachment as never,
          id: m.id,
          seq: m.seq,
        });
        // 推送通知：离线用户设备（尽力而为，失败不影响消息投递）
        pushOfflineUsers(store, hub, m.runId, m.content, m.agentId);
      });
    },
  }).catch(() => {});

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

  const ctxObj = {
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
    pluginHost,
    reloadAgents,
    reloadProviders,
    dispose: async () => {
      // 插件（RAG 工具/维护定时器）经内核逆序清理；其余服务按依赖序手动收尾
      await pluginHost.unregister("rag-tools");
      await pluginHost.unregister("maintenance-timer");
      registry.disposeAll();
      memoryProvider.dispose();
      await mcpManager.dispose();
      hub.close();
    },
  };
  // per-user 插件管理器（R4）：候选集注册 + 已启用实例恢复
  const userPlugins = new PerUserPluginManager(pluginHost, db, (userId, pluginId) => new PluginUserKv(db, userId, pluginId));
  userPlugins.registerCandidate(dailyReminderPlugin);
  userPlugins.registerCandidate(pollPlugin);
  void userPlugins.restoreAll();
  ctxObj.pluginHost = pluginHost;
  // 互联事件日志（L1）：设备配对信令断线补拉的回放源
  const deviceLinkLog = new DeviceLinkLog(db);
  return Object.assign(ctxObj, { userPlugins, deviceLinkLog, storage });
}
