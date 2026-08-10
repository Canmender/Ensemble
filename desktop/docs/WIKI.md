# 合鸣（Ensemble）Wiki

## 📖 目录

- [项目概述](#项目概述)
- [技术栈](#技术栈)
- [架构详解](#架构详解)
- [模块说明](#模块说明)
- [性能优化](#性能优化)
- [多 Agent 架构](#多-agent-架构)
- [开发指南](#开发指南)
- [部署与发布](#部署与发布)
- [故障排查](#故障排查)
- [变更日志](#变更日志)

---

## 项目概述

合鸣是一个桌面原生的多 Agent 协作平台，支持：
- 自定义创建 Agent（内置 LLM + 工具循环 / 本地 harness 接入）
- 多 Agent 协作（单发 / 工作流 DAG / 群聊头脑风暴）
- 实时监控（WebSocket 推送 + 日志/时间线/画布三视图）
- 分层记忆（长期 + 情境 + 全文检索）
- 跨网络通信（局域网直连 + 云端中继）

---

## 技术栈

| 层 | 技术 | 版本 | 职责 |
|---|---|---|---|
| **前端** | React + TypeScript | 18.3 | SPA UI |
| **样式** | Tailwind CSS | 3.4 | 原子化 CSS |
| **状态** | Zustand | 4.5 | 轻量状态管理 |
| **图表** | ReactFlow | 11.x | 工作流 DAG 可视化 |
| **构建** | Vite | 5.4 | 前端构建 + HMR |
| **后端** | Express + TypeScript | 4.19 | REST API |
| **实时** | ws (WebSocket) | 8.18 | 事件推送 |
| **数据库** | node:sqlite (SQLite) | 内置 | 持久化存储 |
| **桌面** | Electron | 43 | 桌面壳 |
| **打包** | electron-builder | 26 | 安装包生成 |
| **CLI** | Node.js | 20+ | 命令行工具 |

---

## 架构详解

### 整体架构

```
┌─────────────────────────┐   REST + WebSocket   ┌────────────────────────────────────────┐
│ 前端 (React + Tailwind)  │◄────────────────────►│ 后端 (Express + ws，本地同源服务)        │
│ 看板/工作流/群聊/设置…    │                      │  ┌────────────┐  ┌────────────────────┐ │
└─────────────────────────┘                      │  │ API 层      │  │ 编排引擎           │ │
                                                 │  │ /api/*     │  │ single/workflow/chat│ │
                                                 │  └─────┬──────┘  └─────────┬──────────┘ │
                                                 │        │                  │            │
                                                 │  ┌─────▼──────────────────▼─────────┐   │
                                                 │  │     Adapter Registry             │   │
                                                 │  │  BuiltinAgentExecutor / LocalAgent│   │
                                                 │  └──────┬────────────────────┬──────┘   │
                                                 │         │                    │          │
                                                 │  ┌──────▼──────┐    ┌────────▼───────┐  │
                                                 │  │ LLM Provider │    │ 工具/Skill/记忆 │  │
                                                 │  └─────────────┘    └────────────────┘  │
                                                 └────────────────────────────────────────┘
                        Electron 壳（单实例/托盘/开机自启/自动更新）
```

### 数据流

```
用户创建任务
  → POST /api/tasks
  → Engine.createAndExecuteTask()
  → 创建 Run (queued) + 广播 run.status
  → runAsync() 异步执行
  → Adapter.startTask() → AsyncGenerator<AgentEvent>
  → 每个事件：
      1. Store.appendRunEvent() 落库（单调 seq）
      2. Hub.broadcast() WebSocket 推送
      3. 前端实时渲染
  → 完成 → 更新 Run status + finalResult → 广播 run.result
```

---

## 模块说明

### 1. Agent 适配器 (`packages/server/src/adapters/`)

统一接口：

```typescript
interface AgentAdapter {
  readonly kind: "builtin" | "local";
  readonly capabilities: AgentCapabilities;
  startTask(input: AgentTaskInput): AsyncGenerator<AgentEvent>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}
```

**BuiltinAgentExecutor**（内置 Agent）：
- LLM Provider 调用（Anthropic / OpenAI 兼容）
- 工具循环（Hook 驱动）
- 上下文压缩 + 大结果 offload
- 记忆注入 + Skill 注入
- 工具循环恢复 + Steering 消息

**LocalAgentExecutor**（本地 harness）：
- 子进程调用本地 CLI（Claude Code / Hermes / OpenCode 等）
- prompt 转义防注入
- 输出流式解析

### 2. 编排引擎 (`packages/server/src/orchestration/`)

三种协作模式：

| 模式 | 文件 | 说明 |
|------|------|------|
| **single** | `single.ts` | 单发/多 Agent 并行 + 可选聚合 |
| **workflow** | `workflow.ts` | DAG 调度（依赖/条件边/模板注入） |
| **chat** | `chat.ts` | 群聊轮转（transcript 注入 / @agent 委派） |

统一通过 `Engine.executeJob()` 执行，支持：
- AbortController 取消
- Steering 消息队列
- 并行 Agent 执行

### 3. Harness 工具循环 (`packages/server/src/adapters/builtin/loop.ts`)

```
preReasoning（记忆注入/压缩）
  → Steering 消息检查
  → 工具循环检测
  → LLM 流式调用
  → postReasoning
  → 并行执行工具（确认串行）
  → postToolResult
  → postCall
```

**关键特性**：
- **Auto-Compact**：token 使用达 95% 时自动触发 LLM 摘要压缩
- **工具循环恢复**：相同工具+参数连续调用 3 次 → 自动终止
- **Steering 消息**：用户在运行中注入消息
- **并行工具**：独立工具 Promise.all 同时执行
- **大结果 offload**：超过阈值写盘 + 预览指针

### 4. 存储层 (`packages/server/src/orchestration/store.ts`)

SQLite 持久化，预编译 SQL 语句：

```typescript
// 构造时一次性 prepare
constructor(db: DatabaseSync) {
  this.stmts = {
    createTask: db.prepare("INSERT INTO tasks ..."),
    getTask: db.prepare("SELECT * FROM tasks WHERE id = ?"),
    // ... 共 18 个预编译语句
  };
}

// 使用时直接 bind+run
createTask(task) {
  this.stmts.createTask.run(task.id, task.title, ...);
}
```

**表结构**：
- `tasks`：任务定义
- `runs`：执行实例
- `jobs`：Agent 调用
- `run_events`：事件流（单调 seq）
- `chat_messages`：群聊消息
- `workflows`：工作流定义

### 5. WebSocket Hub (`packages/server/src/api/ws/`)

实时事件推送：

```typescript
// 订阅
ws.send({ type: "subscribe", runId: "run_xxx" });

// 接收
{
  v: 1,
  ts: 1234567890,
  runId: "run_xxx",
  seq: 42,
  event: { type: "agent.event", jobId: "...", event: {...} }
}
```

支持：
- 按 runId 订阅
- Wildcard 订阅（`*`，看板实时）
- 15s 心跳
- 断线重连 + afterSeq 补拉

### 6. 工具系统 (`packages/server/src/tools/`)

#### RAG 知识库 (`tools/rag.ts`)

```typescript
// 创建 RAG 存储
const ragStore = new RAGStore({
  chunkSize: 512,
  chunkOverlap: 50,
  topK: 5,
});

// 添加文档
await ragStore.addDocument({
  id: "doc1",
  content: "...",
  metadata: { source: "manual", title: "..." },
});

// 混合检索
const results = await ragStore.search("查询", {
  method: "hybrid", // BM25 + 向量
  topK: 5,
  filters: { source: "manual" },
});
```

**工具**：
- `knowledge_search`: 知识库检索
- `knowledge_manage`: 文档 CRUD

#### Function Calling 适配层 (`tools/api-adapter.ts`)

```typescript
// 从 API 定义生成工具
const tools = adapterToTools({
  name: "github",
  baseUrl: "https://api.github.com",
  auth: { type: "token", envKey: "GITHUB_TOKEN" },
  endpoints: [
    { name: "search_repos", method: "GET", path: "/search/repositories", params: {...} },
  ],
});

// 从 OpenAPI Spec 自动生成
const tools = await loadToolsFromOpenApi("https://api.github.com/openapi.json", auth);
```

**预定义适配器**：
- `githubAdapter`: GitHub API（仓库/Issue/PR）

### 7. 上下文管理 (`packages/server/src/context/`)

**ContextManager**：
- `prepare()`：每轮 LLM 调用前，offload + 超阈值压缩
- `recoverFromOverflow()`：context_length_exceeded 后极端压缩
- 原子组切分：`assistant(+tool_calls) + tool_results` 为一组

**OffloadStore**：
- 大工具结果写盘
- 返回预览 + read_file 指针
- 每日清理过期文件

---

## 性能优化

详见 [PERFORMANCE.md](PERFORMANCE.md)。

### 关键优化点

| 优化项 | 效果 | 文件 |
|--------|------|------|
| 路由懒加载 | 首屏 426KB→190KB | `web/src/App.tsx` |
| reactflow 动态加载 | RunPage 153KB→13KB | `web/src/pages/RunPage.tsx` |
| vendor chunk 拆分 | 缓存命中率↑ | `web/vite.config.ts` |
| GPU 光栅化 | 渲染性能↑ | `desktop/src/main/index.ts` |
| 后台节流 | 能耗↓ | `desktop/src/main/window.ts` |
| Auto-Compact 95% | 避免过早压缩 | `server/src/context/manager.ts` |
| 工具循环恢复 | 防止死循环 | `server/src/adapters/builtin/loop.ts` |
| Steering 消息 | 用户可中断/引导 | `server/src/adapters/builtin/loop.ts` |
| 预编译 SQL | DB 解析开销↓ | `server/src/orchestration/store.ts` |

---

## 多 Agent 架构

详见 [MULTI_AGENT_ARCHITECTURE.md](MULTI_AGENT_ARCHITECTURE.md)，涵盖：

| 主题 | 说明 |
|------|------|
| **Memory-Tool 协议** | 三层记忆架构（Working/Episodic/Semantic）、memory_write/read/list 交互协议 |
| **ReAct 拆解** | Plan → Execute → Reflect 三阶段、状态定义、路由逻辑 |
| **LangGraph 状态机** | 节点/边/条件边、State Schema、Checkpoint 恢复 |
| **角色分工** | Planner（规划）、Executor（执行）、Critic（评审）、Summarizer（总结） |
| **RAG 集成** | 向量检索 + BM25 混合、分块策略、Rerank |
| **Function Calling** | API 适配层、MCP 动态发现、OpenAPI 自动生成工具 |
| **对抗迭代** | Coder vs Tester、覆盖率驱动、自动 Bug 修复 |
| **容器化部署** | Docker/Docker Compose、Prometheus 监控、自动回滚 |
| **自动调优** | 日志驱动 Prompt 优化、Few-shot 自动选择、A/B 测试 |
| **10 万次稳定性** | 限流/重试/熔断/超时/降级/幂等/审计 |

### 集成路线图

| Phase | 内容 | 状态 | 文件 |
|-------|------|------|------|
| 1 | Memory-Tool 协议、ReAct 循环、上下文压缩 | ✅ 已完成 | `memory/`, `context/manager.ts` |
| 2 | Plan-Execute-Reflect、角色分工、状态机 | ✅ 已完成 | `orchestration/plan-execute-reflect.ts`, `plan.ts` |
| 3 | RAG 知识库、Function Calling | ✅ 已完成 | `tools/rag.ts`, `tools/api-adapter.ts` |
| 4 | Coder vs Tester 对抗迭代 | ✅ 已完成 | `orchestration/adversarial.ts`, `adversarial-mode.ts` |
| 5 | 容器化、监控、自动调优、10 万次验证 | 📋 规划中 | — |

### 任务模式

| 模式 | 说明 | 入口 |
|------|------|------|
| `single` | 单发/多 Agent 并行 + 可选聚合 | `orchestration/single.ts` |
| `workflow` | DAG 调度（依赖/条件边/模板注入） | `orchestration/workflow.ts` |
| `chat` | 群聊轮转（transcript 注入 / @agent 委派） | `orchestration/chat.ts` |
| `plan` | Plan-Execute-Reflect 三阶段迭代 | `orchestration/plan.ts` |
| `adversarial` | Coder vs Tester 对抗式代码迭代 | `orchestration/adversarial-mode.ts` |

---

## 开发指南

### 环境要求

- Node.js ≥ 20
- pnpm ≥ 10
- Windows 10/11（桌面端）

### 本地开发

```bash
# 安装依赖
pnpm install

# 构建共享包
pnpm --filter @ensemble/shared build
pnpm --filter @ensemble/server build

# 启动后端（watch 模式）
pnpm --filter @ensemble/server dev

# 启动前端（HMR）
pnpm --filter @ensemble/web dev

# 启动桌面应用
pnpm --filter @ensemble/desktop dev
```

### 添加新页面

1. 在 `packages/web/src/pages/` 创建 `XxxPage.tsx`
2. 在 `App.tsx` 中使用 lazy 导入：
   ```tsx
   const XxxPage = lazy(() => import("./pages/XxxPage"));
   ```
3. 添加路由：`<Route path="/xxx" element={<XxxPage />} />`
4. 在 `NAV_ITEMS` 中添加导航项

### 添加新工具

1. 在 `packages/server/src/tools/` 创建 `xxx.ts`
2. 实现 `AgentTool` 接口：
   ```typescript
   export const xxxTool: AgentTool = {
     name: "xxx",
     description: "...",
     parameters: { type: "object", properties: {...} },
     execute: async (input, ctx) => { ... },
   };
   ```
3. 在 `tools/index.ts` 中注册

### 添加新 Agent 类型

1. 在 `packages/server/src/adapters/` 创建 `xxx/executor.ts`
2. 实现 `AgentAdapter` 接口
3. 在 `adapters/registry.ts` 中添加分支

---

## 部署与发布

### 构建安装包

```bash
# 完整构建
pnpm --filter @ensemble/shared build
pnpm --filter @ensemble/server build
pnpm --filter @ensemble/web build
pnpm --filter @ensemble/desktop build

# 打包（生成 NSIS 安装包）
cd packages/desktop
pnpm package
```

### 自动更新

- 应用内检测 GitHub Releases 新版本
- 下载后弹窗提示，点击"立即重启安装"完成更新
- 配置：`packages/desktop/src/main/index.ts` 的 `autoUpdater` 部分

### 中继服务器（可选）

```bash
cd relay-server
npm install
npm run dev  # 开发模式
npm start    # 生产模式
```

---

## 故障排查

### 常见问题

**Q: 应用启动白屏**
A: 检查 `web/dist` 是否存在，运行 `pnpm --filter @ensemble/web build`

**Q: Agent 执行卡住**
A: 检查 LLM Provider 配置，查看 `runs/:id` 的事件日志

**Q: WebSocket 断开**
A: 自动重连机制会尝试恢复，检查网络连接

**Q: 工具循环检测误判**
A: 调整 `loop.ts` 中的 `maxConsecutive` 值（默认 3）

**Q: 上下文压缩失败**
A: 检查 LLM Provider 是否支持摘要调用，查看错误日志

### 日志位置

- **桌面应用**: `%APPDATA%/ensemble/logs/`
- **数据库**: `%APPDATA%/ensemble/data/ensemble.db`
- **配置**: `%APPDATA%/ensemble/config/`

---

## 变更日志

### v0.2.0 (2025-08-09) — 性能优化

**前端**:
- React.lazy 路由懒加载（首屏 ↓55%）
- reactflow 动态加载（RunPage ↓92%）
- Vite vendor chunk 拆分
- 移除死依赖 -94 包

**Electron**:
- GPU 光栅化 + 零拷贝
- 后台渲染节流

**引擎**:
- Auto-Compact 阈值 0.5→0.95（参考 OpenCode）
- 工具循环恢复（参考 OpenClaw）
- Steering 消息注入（参考 OpenClaw）
- 预编译 SQL 语句（参考 OpenCode sqlc）

### v0.1.0 — 初始版本

- 内置 Agent + 本地 harness 接入
- 多 Agent 协作（single/workflow/chat）
- 实时监控 + 日志/时间线/画布
- 分层记忆 + Skill 系统
- Electron 桌面应用 + 自动更新

---

## 参考项目

| 项目 | 语言 | 借鉴内容 |
|------|------|----------|
| [OpenCode](https://github.com/opencode-ai/opencode) | Go | Auto-Compact 阈值、预编译 SQL、PubSub 事件 |
| [OpenClaw](https://github.com/openclaw/openclaw) | TypeScript | 工具循环恢复、Steering 消息、EventStream 模式 |
