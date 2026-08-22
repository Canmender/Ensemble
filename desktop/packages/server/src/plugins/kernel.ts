/**
 * 轻量插件内核 —— 借鉴 cordis（@cordisjs/core）四大核心思想，按合鸣需求裁剪：
 *
 * 1. 服务容器 + key 发现：插件通过服务名互相发现，不 import 具体实现（可替换）
 * 2. inject 声明依赖：依赖就绪才启动；必需服务被移除时插件自动卸载
 * 3. effect 可逆副作用：注册的 disposer 逆序清理——失败回滚、卸载干净（热重载基础）
 * 4. waterfall 管线：环绕中间件语义（next() 委托下游 / 不调用即短路）
 *
 * 与 cordis 的差异（有意简化）：
 * - 无 Proxy 魔法：服务用显式 get<T>(name) 访问（fail-closed 保留：未注册即抛错）
 * - 无 fiber/epoch：生命周期事件 = start/dispose，重载 = dispose 后重启（工具/MCP 场景足够）
 * - 无 isolate 多租户：当前单进程单租户，需要时再加作用域层
 */

/** 插件上下文：传给每个插件的 install 函数 */
export interface PluginContext {
  /** 读取已就绪的服务。未注册 → 抛错（fail-closed，cordis 同款语义） */
  get<T>(name: string): T;
  /** 尝试读取，未注册返回 undefined */
  tryGet<T>(name: string): T | undefined;
  /**
   * 提供服务实现：登记进容器（key 发现），卸载时随本插件自动移除。
   * 同名覆盖 = 服务替换（可替换性是容器存在的意义）。
   */
  provide<T>(name: string, value: T): void;
  /**
   * 注册可逆副作用：install 期间立即执行 execute，若返回函数则作为 disposer；
   * 插件卸载时逆序调用。支持同步 disposer 或 Promise<disposer>。
   */
  effect(execute: () => unknown, label?: string): void;
  /** 类型化事件管线：waterfall 环绕中间件分发 */
  on(event: string, listener: WaterfallListener, opts?: { prepend?: boolean }): void;
}

export type WaterfallListener = (payload: unknown, next: (result?: unknown) => unknown) => unknown;

/** 插件定义形态 */
export interface EnsemblePlugin {
  name: string;
  /** 必需依赖：全部就绪才 install；任一被移除则自动卸载（重装时重新 install） */
  inject?: string[];
  /** 可选依赖：就绪即可用（tryGet），缺失不阻塞启动 */
  softInject?: string[];
  /** 安装体：注册服务/effect/监听器。抛错 = 该插件安装失败且副作用全回滚 */
  install(ctx: PluginContext): void | Promise<void>;
}

interface PluginState {
  plugin: EnsemblePlugin;
  /** 已登记的 disposers（逆序清理） */
  disposers: Array<() => void | Promise<void>>;
  /** 本插件 provide 出的服务名 → 实例 */
  provided: Map<string, unknown>;
  listeners: Array<{ event: string; fn: WaterfallListener }>;
  status: "inactive" | "active" | "failed";
  error?: unknown;
}

interface ServiceEntry {
  value: unknown;
  owner: string;
}

export class PluginHost {
  private states = new Map<string, PluginState>();
  private services = new Map<string, ServiceEntry>();
  private listeners: Array<{ event: string; fn: WaterfallListener }> = [];
  /** 安装中标志：install 期间依赖图尚未闭合，get 对软依赖放宽 */
  private installing = false;

  /** 当前已激活插件名 */
  list(): string[] {
    return [...this.states.values()].filter((s) => s.status === "active").map((s) => s.plugin.name);
  }

  statusOf(name: string): { status: string; error?: string } {
    const s = this.states.get(name);
    if (!s) return { status: "unknown" };
    return { status: s.status, error: s.error ? String(s.error) : undefined };
  }

  getServiceNames(): string[] {
    return [...this.services.keys()];
  }

  /** 注册并安装一个插件。返回是否成功（失败原因见 statusOf） */
  async register(plugin: EnsemblePlugin): Promise<boolean> {
    // 幂等：同名重复注册先卸旧的（配置变更重载场景）
    if (this.states.has(plugin.name)) await this.unregister(plugin.name);

    const state: PluginState = {
      plugin,
      disposers: [],
      provided: new Map(),
      listeners: [],
      status: "inactive",
    };
    this.states.set(plugin.name, state);

    // 依赖校验：必需服务必须已在容器（本内核不做等待唤醒——装配是显式异步流程，
    // 由调用方控制注册顺序；cordis 的 epoch 等待对显式装配是过度设计）
    const missing = (plugin.inject ?? []).filter((d) => !this.services.has(d));
    if (missing.length > 0) {
      state.error = `缺少依赖服务: ${missing.join(", ")}`;
      return false;
    }

    const pctx: PluginContext = {
      get: <T>(name: string) => this.getService<T>(name),
      tryGet: <T>(name: string) => (this.services.has(name) ? (this.services.get(name)!.value as T) : undefined),
      provide: <T>(name: string, value: T) => {
        // 覆盖旧提供者的登记（服务替换）：原提供者不再持有该服务
        const prev = this.services.get(name);
        if (prev && prev.owner !== plugin.name) {
          this.states.get(prev.owner)?.provided.delete(name);
        }
        this.services.set(name, { value, owner: plugin.name });
        state.provided.set(name, value);
      },
      effect: (execute, label) => {
        // 立即执行，disposer 登记（逆序清理由 unregister 保证）
        const record = (d: unknown) => {
          if (typeof d === "function") state.disposers.push(d as () => void | Promise<void>);
        };
        try {
          const r = execute();
          if (r && typeof (r as Promise<unknown>).then === "function") {
            void (r as Promise<unknown>).then(record).catch((e) => {
              state.error = `effect(${label ?? "anonymous"}) 失败: ${String(e)}`;
            });
          } else {
            record(r);
          }
        } catch (e) {
          throw new Error(`effect(${label ?? "anonymous"}) 执行失败: ${String(e)}`);
        }
      },
      on: (event, listener, opts) => {
        const entry = { event, fn: listener };
        if (opts?.prepend) this.listeners.unshift(entry);
        else this.listeners.push(entry);
        state.listeners.push(entry);
      },
    };

    this.installing = true;
    try {
      await plugin.install(pctx);
      state.status = "active";
      return true;
    } catch (e) {
      // 失败回滚（cordis 测试钉死的契约）：逆序执行已登记的 disposer + 撤走半成品服务
      await rollback(state);
      for (const [svc] of state.provided) this.services.delete(svc);
      state.status = "failed";
      state.error = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      this.installing = false;
    }
  }

  /** 卸载插件：逆序清理副作用 + 移除其提供的服务，并级联卸载依赖它的插件 */
  async unregister(name: string): Promise<void> {
    const state = this.states.get(name);
    if (!state) return;

    // 先级联卸载注入了本插件所提供服务的插件（依赖方先走）
    const provided = [...state.provided.keys()];
    for (const [otherName, other] of this.states) {
      if (otherName === name || other.status !== "active") continue;
      const deps = other.plugin.inject ?? [];
      if (deps.some((d) => provided.includes(d))) {
        await this.unregister(otherName);
      }
    }

    for (const [svc] of state.provided) this.services.delete(svc);
    for (const l of state.listeners) {
      const i = this.listeners.indexOf(l);
      if (i >= 0) this.listeners.splice(i, 1);
    }
    for (const d of [...state.disposers].reverse()) {
      try {
        await d();
      } catch (e) {
        console.warn(`[plugins] ${name} disposer failed: ${String(e)}`);
      }
    }
    state.disposers = [];
    state.provided.clear();
    state.listeners = [];
    state.status = "inactive";
    this.states.delete(name);
  }

  /** waterfall 分发：环绕中间件。监听器调 next() 委托下游，不调用即短路。 */
  waterfall<TIn, TOut>(event: string, payload: TIn, fallback: () => TOut): TOut {
    const chain = this.listeners.filter((l) => l.event === event);
    const dispatch = (i: number): unknown =>
      i >= chain.length
        ? fallback()
        : chain[i].fn(payload, (result?: unknown) =>
            result !== undefined ? result : dispatch(i + 1),
          );
    return dispatch(0) as TOut;
  }

  private getService<T>(name: string): T {
    const entry = this.services.get(name);
    if (!entry) throw new Error(`服务未注册: ${name}（fail-closed：插件须声明 inject 或使用 tryGet）`);
    return entry.value as T;
  }
}

async function rollback(state: PluginState): Promise<void> {
  for (const d of [...state.disposers].reverse()) {
    try {
      await d();
    } catch {
      /* 回滚阶段的清理失败不再抛出 */
    }
  }
  state.disposers = [];
}
