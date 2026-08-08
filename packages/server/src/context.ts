import type { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
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
  reloadAgents: () => void;
  reloadProviders: () => void;
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
  const registry = new AdapterRegistry({
    providerRegistry,
    toolRegistry,
    appSettings: () => config.getSettings(),
    askConfirm: deps.askConfirm,
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
    reloadAgents,
    reloadProviders,
  };
}
