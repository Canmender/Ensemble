# Cordis 应用方案：合鸣服务端插件化改造

> 编制日期：2026-08-22 | 依据：《Cordis插件系统调研》《Cordis源码深度解析》《Cordis生态全景与精通验证》三轮调研 + 服务端代码审计
> 范围：`ensemble-cloud/packages/server`（主战场）；relay-server 与客户端不在本期范围

## 一、为什么是现在：现状诊断

`createAppContext()`（`ensemble-cloud/packages/server/src/context.ts:101-296`）是一个 296 行的手动装配函数，cordis 要解决的四个问题在这里全部真实存在：

| 痛点 | 现状代码 | cordis 的答案 |
|---|---|---|
| **手动装配顺序** | 14 个服务按隐式依赖顺序 new 出来（AppContext 共 21 个字段），顺序错了运行时才炸 | `inject` 声明依赖，框架拓扑排序等待就绪 |
| **手动逆序清理** | `dispose()` 里人工维护 5 步清理顺序（timer→registry→memory→mcp→hub），新增服务必须记得同步改两处 | 每个服务的资源都是 effect，卸载自动逆序执行 |
| **手动 reload 传播** | `reloadAgents()`/`reloadProviders()` 靠人肉在配置变更点调用，漏调一次就数据不一致 | 服务声明 `inject: ['config']`，配置变更框架自动重跑 |
| **回调接线散落** | `hub.onDeviceStatus` 闭包手捕 store/hub；`wsAskConfirm` 闭包手捕 hub | 类型化事件解耦：生产方 emit，消费方 on |

另外两处「已经是 seam 但没统一」：`KeyStore` 接口有 File/Electron 双实现；memory 后端有 Mem0/SQLite 双实现靠 if-else 切换——正是 cordis「同一 seam 并列注册可替换后端」的标准场景。

## 二、目标与非目标

**目标**
1. 服务装配/清理/重载全部交给框架，新增一个服务只需「写 Service 类 + 声明 inject」，不再碰装配函数。
2. hub 与 engine 解耦：业务事件走类型化事件总线，WS 广播降级为一个监听器。
3. memory/KeyStore/adapter 三处 seam 正式化，为未来「第三方能力包」留口。
4. 行为不变：迁移全程 API 契约、数据库 schema、WS 协议零变化。

**非目标**
- 不改 Express 路由层（`api/routes/*` 继续通过 facade 拿服务）。
- 不做跨进程插件（沙箱/子进程是另一期）。
- 不引入 cordis 的 loader/HMR 配置树（阶段 3 按需再上）。
- 客户端（mobile/desktop）不动。

## 三、服务映射表

| 现有模块 | ctx 键 | Service 化改造要点 |
|---|---|---|
| ConfigManager | `ctx.config` | 保留写锁队列；缓存刷新后 `notify` 依赖方（替代手动 reload） |
| Store（SQLite 编排存储） | `ctx.store` | 无状态包装，直接注册 |
| UserStore | `ctx.users` | 同上 |
| WsHub | `ctx.hub` | **降级为传输监听器**：订阅 `chat/*`、`device/*` 事件后广播；`requestConfirm` 改为 `tool/confirm` 异步短路事件（见阶段 2 事件设计） |
| OrchestrationEngine | `ctx.engine` | `inject: ['store','adapters','hub','config']`；`setAgents` 改为 inject config 驱动 |
| AdapterRegistry | `ctx.adapters` | **正式插件化**：现有 `builtin`/`local` 两类 adapter（`adapters/registry.ts:18`，local 承载 discovery 检测到的本机 CLI agent）各自成为插件，自带 dispose |
| ProviderRegistry | `ctx.providers` | `inject: ['config','keyStore']`，reload 自动化 |
| ToolRegistry | `ctx.tools` | 内置工具/MCP 工具/memory 工具都变成「向 ctx.tools 注册的插件」 |
| MemoryProvider + Pool | `ctx.memory` | 后端 seam：`memory-backend-sqlite` / `memory-backend-mem0` 并列注册，settings 选择 |
| KeyStore | `ctx.keyStore` | seam：`keystore-file` / `keystore-electron` 并列注册，宿主按环境装配 |
| SkillStore | `ctx.skills` | 内置 skill 补写逻辑 → `[Service.init]` 生成器 effect |
| McpManager | `ctx.mcp` | 工具贡献者插件 |
| 24h 维护定时器 | `ctx.interval(...)` | effect 化，dispose 自动清理（删掉手动 `clearInterval`） |

## 四、分阶段路线

### 阶段 0：无痕引入（约半天）

- `pnpm add cordis` 到 `@ensemble/server`。**ESM 兼容已核实**：cordis 是 ESM-only（`type: module`），而 server 也是 ESM（package.json `"type": "module"` + tsx/tsc ESNext），无冲突；依赖仅 cosmokit + @standard-schema/spec（类型），无 native 二进制。
- **zod 版本核实项**：server 声明 `^3.23.0`，该范围本身包含实现了 standard-schema 的 ≥3.24；但 worktree 内未安装依赖、无法确认锁文件解析版本——阶段 0 第一步先 `pnpm ls zod` 确认 ≥3.24，若锁定在 3.23.x 则刷新锁文件（schema 定义不变）。
- `createAppContext` 内部创建根 Context，现有服务**原样** `ctx.provide()` 注册；`AppContext` 接口保持不变，字段改为从 ctx 读取（facade 模式）。
- **验收**：`appContext.test.ts`、`store.test.ts`、`engine.test.ts` 全绿；启动日志与迁移前逐行一致。
- **回滚**：删一个文件。

### 阶段 1：核心服务 Service 化 + 生命周期托管（约 2-3 天）

- config/store/hub/engine/providers 六个核心类改继承 `Service`，`inject` 声明依赖。
- 维护定时器改 `ctx.interval`；`reloadAgents`/`reloadProviders` 删除，由 inject 驱动；`dispose()` 函数删除，由框架接管。
- **验收**：① 全部测试绿；② 手动验证：杀进程前所有定时器/WS 连接被清理（无 unref 残留）；③ 修改 agent 配置后 engine 无需手动 reload 即生效。
- **回滚**：git revert 单提交。

### 阶段 2：事件化 + seam 正式化（约 1 周）

- 定义类型化事件（声明合并，模式固定）：

```ts
interface Events {
  'chat/message'(msg: ChatMessage): void            // emit → hub 监听并广播
  'chat/deleted'(msgId: string): void               // emit
  'chat/read'(userId: string, readTs: string): void // emit
  'device/status'(userId: string, d: Device, online: boolean): void  // emit
  /** HITL 确认：serial 派发，监听器返回 { approved } 对象即短路决策（含拒绝），
   *  返回 undefined 表示不处理、交给下游；无监听器短路时走默认拒绝。
   *  注意不能用同步 waterfall：requestConfirm 是分钟级异步等待；
   *  也不能用布尔返回值：cordis 的 bail 语义里 false 不算短路。 */
  'tool/confirm'(runId: string, tool: string, args: unknown): Promise<{ approved: boolean } | undefined>
}
```

- engine 不再 import hub，改 emit；hub 变成 `ctx.on('chat/message', ...)` 的纯传输插件。
- memory backend / KeyStore 双实现改为并列注册 + settings/环境选择（对标 cordis storage-json/sqlite 模式）。
- **验收**：`grep -rn "from.*hub" orchestration/` 零结果（engine 与传输层解耦）；双后端切换只改配置不改代码。

### 阶段 3：插件生态（按需启动，本期不排期）

- adapters 目录外置为插件目录（每个 harness 一个包），loader 配置树管理启停。
- `isolate('adapters')` 为多 agent 并行会话提供独立 adapter 作用域。
- 触发条件：出现「第三方写 adapter/工具包」的真实需求。

## 五、风险与对策

| 风险 | 评估 | 对策 |
|---|---|---|
| `notify()` 全量扫描 O(服务数×注入数) | 本项目服务数 ~16，无压力 | 不动；若未来服务过百再上反向索引（调研已留方案） |
| Proxy 调试体验（服务打印为 Proxy） | 中 | 团队约定：服务内部用 `Context.is()` 判型、日志打 `ctx.fiber.name`；必要时 `symbols.original` 取原对象 |
| zod 版本兼容 | 低 | 阶段 0 先核实解析版本 ≥3.24（声明范围 ^3.23 已覆盖），锁文件过旧则刷新，schema 不变 |
| 与 Express 边界模糊 | 低 | 铁律：routes 只经 facade 拿服务，永不触碰 ctx 内部 |
| 学习曲线 | 中 | 本方案 + 三篇调研文档即培训材料；阶段 0-1 改动模式高度重复，做两个服务后即可复制 |

## 六、与 P0 修复的关系

- **P0-a（补拉参数名 bug）立即修**，一行改动，与本方案零耦合，不等架构。
- **P0-b/c（chat_messages seq、client_msg_id 幂等、重连补拉）建议排在阶段 1 之后**：这些改动落在 store/hub 上，先 Service 化再改，避免同一处代码改两遍。
- 顺序建议：P0-a → 阶段 0 → 阶段 1 → P0-b/c → 阶段 2。

## 七、工作量与里程碑

| 里程碑 | 内容 | 预估 | 验收物 |
|---|---|---|---|
| M0 | 阶段 0 无痕引入 + P0-a bug 修复 | 0.5 天 | 测试全绿 + 补拉生效 |
| M1 | 阶段 1 核心服务化 | 2-3 天 | 装配函数缩减到 <50 行；dispose/reload 删除 |
| M2 | 阶段 2 事件化 + seam | 5 天 | engine↔hub 解耦；双后端配置化切换 |
| M3 | P0-b/c 可靠性修复 | 2-3 天 | seq/幂等/重连补拉落地（在新架构上） |

合计约 **2.5 周**（含测试与验证）。每阶段独立提交、独立可回滚，符合项目版本号递进惯例。
