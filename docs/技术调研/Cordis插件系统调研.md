# Cordis 插件系统调研笔记

> 调研日期：2026-08-22
> 主题分类：插件系统 / 依赖注入 / 事件驱动架构（关联主题：高性能、高并发、安全）
> 学习实例：DeepSeek Harness（以 vendor 方式引入 Cordis 的 AI Agent 框架）

## 一、Cordis 是什么

Cordis 是开源元框架，npm 包 `@cordisjs/core`，自称 "Meta-Framework for Modern JavaScript Applications"。它从 Koishi 聊天机器人生态中抽出，现由 cordiverse 组织维护（v3.x）。

- 上游仓库：<https://github.com/cordiverse/cordis>
- 学习实例文档：<https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer>
  （该域名 WebFetch 会被安全校验拦截，用 `curl` 直接抓取即可）

DeepSeek Harness 将其 vendor 引入后，几十个子系统（会话持久化、LLM 流式、工具执行、沙箱、审批等）全部构建其上，证明它可支撑大型应用。

## 二、五个核心概念

1. **插件是实现 Service 的对象**。可以是带可选 `inject` 和 `apply(ctx)` 字段的函数，也可以是 `Service` 子类（构造函数中 `super(ctx, name)` 即注册为 `ctx.<name>`），生命周期由 Cordis 挂载到当前上下文。
2. **上下文（Context）是服务的容器**。Context 是一个 Proxy：读取 `ctx.tools`、`ctx.llm` 等属性时走服务解析器按 key 查找实现。插件之间**通过 key 发现服务，而非 import 具体实现**，因此任何服务都可替换。
3. **依赖通过 `inject` 声明**。插件声明所需服务后，等全部就绪才启动；加载顺序由依赖图表达，不靠手动编排启动序列。必需服务变化时，插件会被卸载并重跑。
4. **类型化事件用于通信**。通过 TypeScript 声明合并注册事件名；每种事件固定一种分发模式，且只能用对应方法分发（模式是事件公开约定的一部分）。
5. **注册是可逆的副作用**。提示词片段、工具 schema、监听器、定时器等通过 `ctx.effect()` / `ctx.on()` 安装并自动登记 disposer；卸载时**逆序异步清理**，热重载（HMR）因此天然成立。

### 事件分发五模式

| 模式 | 是否 await | 分发顺序 | 返回值 |
|---|---|---|---|
| `emit` | 否 | 按注册顺序观察 | 否 |
| `waterfall` | 否 | 按注册顺序观察 | 是 |
| `parallel` | 是 | 所有监听器并行 | 否 |
| `serial` | 是 | 按注册顺序，直到有人 bail | 是（首个 bail 值） |

另有 `bail`：同步顺序调用，遇到首个非 null/false/undefined 返回值即短路。

**Waterfall 语义 = 环绕中间件**：监听器收到 `(...args, next)`，调用 `next()` 执行下游监听器（最终是内置行为），下游返回值可被当前层包装后继续向外返回；不调用 `next()` 直接返回即否决/短路。策略监听器拥有决策权时可短路，纯观察者必须委托。仅当必须在普通注册之前运行时才用 `prepend: true`。

## 三、关键 API 速查

### Context（Proxy 服务容器）

- `ctx.extend(meta?)` — 原型继承创建子上下文，meta 自有属性遮蔽继承属性，父上下文不被修改。
- `ctx.isolate(name, label?)` — 为服务 `name` 创建独立作用域的子上下文；相同 `label` 的多次 isolate 加入同一作用域。**多租户隔离的原语**。
- `ctx.intercept(name, config)` — 为该上下文之下启动的插件合并服务专属拦截配置（祖先条目在前）。
- `ctx.get(name, strict?)` / `ctx.set(name, value)` — 底层服务存取；`set` 仅提供该服务的 fiber 可调用。
- `ctx.provide(name, value)` — 注册归当前 fiber 所有的服务实现，返回 disposer。
- `ctx.accessor(name, {get, set})` / `ctx.mixin(name, keys)` — 计算属性与成员转发（如 `ctx.on` 转发到 `ctx.events.on`）。
- 内置服务：`ctx.events`、`ctx.logger`、`ctx.reflect`、`ctx.registry`、`ctx.fiber`、`ctx.root`。

### Registry（插件加载与依赖注入）

- `ctx.plugin(plugin, ...config)` — 加载插件（函数 / 类 / `{ apply }` 对象三种形态），配置经 standard-schema 校验，返回 Fiber（可 await）。
- `ctx.inject(deps, callback)` — `ctx.plugin({ inject, apply })` 简写；依赖变化时自动卸载重跑。
- 插件元数据：`name`、`Config`（schema 校验器）、`inject`（依赖）、`provide`（提供的服务名）、`intercept`（消费的拦截配置）。

### Fiber（插件运行时实例）

- 跟踪生命周期状态、校验后的配置、已登记的 effect 树（带 label 的 `EffectMeta` 诊断树）。
- `ctx.effect(execute, label?)` — execute 立即运行，产生的 disposer 逆序收集，在手动调用返回的 disposer 或 fiber 卸载时（先到者）执行；支持同步 / Promise /（异步）生成器三种形态。
- `fiber.update(config)` — 先跑 `internal/update` waterfall（钩子可否决或替换重启），再校验并重启插件 —— 配置热更新与 HMR 的机制基础。
- `fiber.restart()` / `fiber.await()` / `fiber.dispose()`；状态转换发出 `internal/status` 事件。
- `CordisError`（稳定机器可读错误码）与 `ValidationError`（standard-schema 校验失败）。

### internal/* 钩子事件

框架自身行为也有可观测/可拦截面：`internal/plugin`、`internal/status`、`internal/service`、`internal/update`、`internal/get`、`internal/set`、`internal/listener`、`internal/dispatch`（后三者为 waterfall）。另有 loader/*（配置树变更、部分卸载、patch-context）与 hmr/* 事件。

## 四、高性能 / 高并发视角

- 事件分发是进程内函数调用，零序列化开销；扇出用 `parallel`，管线用 `waterfall`，语义由声明固定。
- Context 惰性解析（Proxy 按需读取），服务未就绪时读取等待依赖唤醒，无轮询。
- Harness 实践范例：
  - **token 计量**：多消费方共享不可变、带修订版本的测量结果（无锁共享）。
  - **投影缓存冷读取阶梯**：列表读取走「缓存行 + 持久化尾部回放」，永远不加载完整日志 —— 对 IM 会话列表加载很有参考价值。
  - **并发安全**：fiber 用 `inertia` 合并进行中的加载/卸载转换，竞态 dispose 等待同一次完成。

## 五、加密安全视角

Harness 用法几乎是一份"插件系统安全清单"：

- **credentials seam**：配置只存机密的*引用*，实际值由提供方持有；消费方**按操作逐次解析**，密钥轮换在下一次请求立即生效；Web 网关只暴露脱敏视图 + 只写存储。
- **沙箱统一策略**：消费方交出确切 argv，沙箱后端逐次调用包装并报告强制情况；`sandboxPolicy` 单一真源保证 bash 与文件系统限制同一根目录。
- **审批走 waterfall**：`approval/request` 瀑布事件分派一次性权限决策；有决策权的监听器可短路，观察者必须委托；无回答方时以 unavailable 失败关闭。
- **遥测出进程前脱敏**：session-telemetry seam 捕获→脱敏→交后端，输出离开当前进程。
- **作用域注册（scope 包）**：身份标识（不透明 ScopeKey）+ 载体（Scoped<T> 品牌标记）+ 作用域层（ScopeLayer/ScopedLayers），同一注册上下文同时表达可见性与生命周期所有权。

## 六、对合鸣项目的借鉴

1. **可替换存储后端**：storage-json / storage-sqlite 并列注册同一 seam 的模式，适合服务端存储层改造。
2. **消息处理管线**：waterfall 环绕中间件天然适合撤回、过滤、审计等环绕逻辑。
3. **类型安全手法**：品牌化 ID（`Branded<B>`，SessionId/CallId 类型层面不可互换）；`…Map → keyof` 派生联合类型的声明合并扩展模式（插件加变体无需改拥有该类型的包）。
4. **多租户隔离**：`isolate()` 作用域隔离可映射到我们的会话/租户隔离需求。
5. **凭据管理**：配置存引用 + 按操作解析 + 轮换即生效，与项目隐私防护约定一致，可落地到服务器端凭据存储。

## 七、待深入方向

- [x] 拉 cordis 上游源码，读 Proxy 服务解析与 fiber 调度的具体实现 → 见 [Cordis源码深度解析.md](Cordis源码深度解析.md)
- [x] waterfall 在异步监听器下的组合细节与错误传播 → 深度解析第五节
- [ ] include 插件的 `!!js` 表达式 Loader 配置插值
- [ ] 下一个调研主题：高并发网络模型 / 加密协议
