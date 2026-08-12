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
- 多 Agent 协作（单发 / 工作流 DAG / 群聊头脑风暴 / 规划-执行-反思 / 对抗迭代）
- 实时监控（WebSocket 推送 + 日志/时间线/画布三视图）
- 分层记忆（显式记忆池 + 隐式记忆池 + 全文检索）
- 跨网络通信（局域网直连 + 云端中继）
- 手机端联动（远程控制 + 实时同步 + 直接对话）

---

## 技术栈

| 层 | 技术 | 版本 | 职责 |
|---|---|---|---|
| **前端** | React + TypeScript | 18.3 | SPA UI |
| **样式** | Tailwind CSS | 3.4 | 原子化 CSS |
| **状态** | Zustand | 4.5 | 轻量状态管理 |
| **图表** | @xyflow/react | 12.x | 工作流 DAG 可视化（原 reactflow） |
| **构建** | Vite | 5.x | 前端构建 + HMR（base "./" + target es2022） |
| **后端** | Express + TypeScript | 5.2 | REST API |
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
- 按 runId 订阅（**Wildcard 订阅已禁用**，防止监听全部运行）
- 连接需 session token（`?token=` query 验证）
- 15s 心跳
- 断线重连 + afterSeq 补拉
- 事件驱动等待（`waitForRun`，替代轮询；chat 端点等回复/执行完成）

### 6. 记忆池系统 (`packages/server/src/memory/pool.ts`)

双记忆池架构：

```
┌─────────────────────────────────────────────┐
│            显式记忆池 (Explicit)             │
│  - 导航栏"记忆"页可见                        │
│  - Agent 可通过工具读取往期记忆               │
│  - 长期持久化，用户可管理                     │
│  - 1000 条/agent，手动淘汰                   │
├─────────────────────────────────────────────┤
│            隐式记忆池 (Implicit)             │
│  - 项目/Run 级别作用域                       │
│  - 多 Agent 共享重要上下文                    │
│  - 主动筛选注入 (重要度阈值 0.5)              │
│  - 100 条/scope，24h 自动过期                │
└─────────────────────────────────────────────┘
```

**工具**:
- `memory_pool_write`: 写入记忆 (显式/隐式)
- `memory_pool_read`: 读取记忆 (搜索/列表)
- `memory_pool_list`: 列出记忆条目

**API**:
- `GET/POST /api/memory-pool/explicit`: 显式记忆 CRUD
- `GET/POST /api/memory-pool/implicit`: 隐式记忆 CRUD
- `GET /api/memory-pool/stats`: 统计信息

### 7. 工具系统 (`packages/server/src/tools/`)

#### RAG 知识库 (`tools/rag.ts`)

支持向量语义检索、BM25 关键词检索、混合检索（RRF 排名融合）。

```typescript
// 创建 RAG 存储（可选注入 embedFn 启用向量检索）
const ragStore = new RAGStore({
  chunkSize: 512,
  chunkOverlap: 50,
  topK: 5,
  embedFn, // (texts: string[]) => Promise<number[][]>，OpenAI 兼容 embeddings
});

// 添加文档（配置 embedFn 时为分块生成向量）
await ragStore.addDocument({
  id: "doc1",
  content: "...",
  metadata: { source: "manual", title: "..." },
});

// 混合检索（向量 + BM25，单侧能力缺失时自动退化为另一侧）
const results = await ragStore.search("查询", {
  method: "hybrid", // vector | bm25 | hybrid
  topK: 5,
  filters: { source: "manual" },
});
```

**embedding 配置**（`settings.rag`）：
- `embeddingUrl` / `embeddingModel`：OpenAI 兼容 `/embeddings` 端点（Ollama 等本地端点亦可）
- 未配置时复用默认 provider 的 baseUrl/apiKey/模型
- 工具通过 `tools/embedding.ts` 的 `embedTexts` 调用，复用 `fetchWithRetry`

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
| @xyflow/react 动态加载 | RunPage 153KB→13KB | `web/src/pages/RunPage.tsx` |
| vendor chunk 拆分 | 缓存命中率↑ | `web/vite.config.ts` |
| GPU 光栅化 | 渲染性能↑ | `desktop/src/main/index.ts` |
| 后台节流 | 能耗↓ | `desktop/src/main/window.ts` |
| Auto-Compact 95% | 避免过早压缩 | `server/src/context/manager.ts` |
| 工具循环恢复 | 防止死循环 | `server/src/adapters/builtin/loop.ts` |
| Steering 消息 | 用户可中断/引导 | `server/src/adapters/builtin/loop.ts` |
| 预编译 SQL | DB 解析开销↓ | `server/src/orchestration/store.ts` |

---

## 企业级能力

### 账号系统

多用户支持（服务器部署）：

| 端点 | 说明 |
|---|---|
| `POST /api/auth/register` | 注册（用户名 3-32 位 + 密码 ≥6 位），返回会话 token |
| `POST /api/auth/login` | 登录（scrypt 校验）|
| `GET /api/auth/me` | 当前用户信息 |
| `POST /api/auth/logout` | 登出（删除会话）|

**认证双凭证**（`api/auth.ts`，按序判定）：
1. 用户 session token → `req.user`（多用户数据隔离）
2. `ENSEMBLE_API_KEY` → system 用户（机器级，headless/Docker/移动端直连）
3. 设备 token（桌面本地免登录）

**数据隔离**：`userId` 经 task → run → job → event → chat 全链传播；`tasks/runs/chat_messages` 按 `user_id` 过滤（`OR user_id = ''` 保留共享数据）。agents/workflows 团队全局共享。预留 `org_id` 字段（后续组织/租户）。

**Web 前端**：`AuthProvider` 三态（用户 / 本地模式 / 未登录）+ 路由守卫；token 存 localStorage；401 跳登录。

### agent 原生支持（harness 自动安装）

对常用开源 agent CLI（opencode / claude-code / codex / gemini / qwen / aider）的原生支持：

- **启动自动检测**：`createAppContext` 启动时 `detectAgents()` + 自动创建配置（`ENSEMBLE_AUTO_SYNC_LOCAL=false` 可关），已安装的默认启用
- **一键安装**：设置页 → 本地 agent → 未安装的显示"一键安装"（`POST /api/discovery/:type/install`）
- **中文镜像**：npm 走 npmmirror、pip 走阿里（`ENSEMBLE_NPM_REGISTRY` / `ENSEMBLE_PIP_INDEX` 可覆盖）
- **手动引导**：hermes / goose 等暂不支持自动安装，提供官方文档引导

### 会话系统（企业级 IM）

| 端点 | 说明 |
|---|---|
| `GET /api/conversations` | 会话列表（含 lastMessage / 当前用户未读）|
| `POST /api/conversations` | 创建会话（`type: direct \| group`）|
| `GET /api/conversations/:id/messages` | 消息分页（`before` 游标 + `limit`）|
| `POST /api/conversations/:id/messages` | 发送消息（fire-and-forget，回复走 WS）|
| `POST /api/conversations/:id/read` | 标记已读（当前用户）|
| `POST /api/conversations/:id/archive` | 归档 / 恢复会话 |
| `DELETE /api/conversations/:id` | 删除会话 |

- **direct** = 用户与单个 agent 的持续对话（chat run + 1 participant）或**用户与用户**的 1:1 IM（无 run，消息直接落库 + 定向推送）；**group** = 多 agent 群聊
- 会话生命周期：关联 run 终态后拒绝发送（防"只进不出"）；用户-用户会话无 run，不受此限
- **未读（per-user）**：agent/群聊会话按归属计共享未读；用户-用户会话各自计数（`conversation_reads` 表），`/read` 只清当前用户
- **访问控制**：用户-用户会话仅归属用户与参与者可读写；agent 会话仅归属用户或共享会话可访问
- 消息统一落 `chat_messages`（发送经后端广播，修复 WS steer 不落库问题）
- 桌面 web 端与移动端均已接入：用户联系人分区、首次发送懒创建会话、历史 + WS 实时合并、发送者昵称显示

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
| 5 | 容器化部署 | ✅ 已完成 | `docker-compose.yml`, `relay-server/Dockerfile`, `nginx/` |

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

## 安全

### HTTP API 认证

所有 `/api/*` 端点（除 `/api/health` 探活）要求 `Authorization: Bearer <sessionToken>`：

- **session token**：桌面版启动时随机生成（32-byte hex），前端通过 `GET /api/ws-token` 获取；HTTP 与 WebSocket 共用同一 token
- **`/api/ws-token` Origin 校验**：仅放行 `localhost`/`127.0.0.1` 来源（或非浏览器客户端），防恶意网页跨站盗取
- **headless/Docker**：`ENSEMBLE_API_KEY` 配置固定 key 覆盖随机 token，且禁用 `/api/ws-token`（防公网绕过）
- **对外绑定强制**：`ENSEMBLE_LAN_HOST` 设为对外地址但未配置 API key 时 headless 拒绝启动
- 401 响应带 `WWW-Authenticate`；Bearer 校验 timing-safe

### 其他加固

- 所有写端点（POST/PUT/PATCH/DELETE）速率限制（60/min/IP）
- 配置 id（agent/workflow/provider）字符白名单 `^[a-z0-9-]+$`（防路径穿越）
- settings 中的第三方 API key（searchApi/mem0）响应掩蔽
- MCP 命令白名单：无 `allowedCommands` 时拒绝解释器命令（python/sh 等）
- `ConfigManager` 写操作互斥串行化（防并发丢失）

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

**鉴权**：生产环境务必设置 `RELAY_AUTH_KEY`（Socket.IO 握手 + `/devices` 均要求 Bearer token）。客户端连接时传 `auth: { token: <key> }`。

### 移动端局域网直连

桌面端默认仅绑定 `127.0.0.1`。要让移动端直连：

```bash
# 桌面端设置监听局域网 + 自动发布 mDNS（_ensemble._tcp）
ENSEMBLE_LAN_HOST=0.0.0.0
# 对外绑定建议同时配置固定 API key（否则局域网内任何设备可获取 session token）
ENSEMBLE_API_KEY=<random>
```

移动端通过 mDNS 自动发现或手动输入 IP，经 REST API + 原生 WebSocket（`/ws?token=...`）连接。直连模式下移动端支持：任务创建/取消、群聊消息、实时事件流（`wslink.ts` 解析 WsEnvelope）。

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

## 版本号规则

采用语义化版本 `x.y.z`（主版本.次版本.修订）：

- **修订号（z）**：小提交或 Bug 修复 → 第三位 +1，并**必须**在下方变更日志记录
- **次版本号（y）**：中型修改（新功能、重构、非破坏性变更、依赖升级）→ 第二位 +1
- **主版本号（x）**：破坏性变更或重大里程碑 → 第一位 +1

发布流程：每次 bump 版本号时，同步更新各 package.json 与下方变更日志，再打包发布。

---

## 变更日志

### v0.7.1 (2026-08-12) — 修复：桌面端启动崩溃 + 移动端直连云服务器 + 白色主题

**桌面端（v0.7.0 安装后打不开）**
- 修复数据库迁移崩溃：`migrateUserColumns` 重建 `chat_messages` 时兼容无 `user_id` 列的旧库（v0.6.0 之前的库升级时 `no such column: user_id`）
- 已用真实旧库副本 + 构造旧库验证迁移，数据保留

**移动端**
- 移除「连接模式」设置（LAN 直连/云端中继/手动 IP/连接历史/设备发现），应用启动自动直连云服务器 `47.92.39.184:8787`
- 新增账号登录/注册（用户 token AsyncStorage 持久化）；WS 携带用户会话 token（云服务器 ws-token 已禁用，登录鉴权）
- 修复设置页版本号显示（原硬编码 0.6.0）

**移动端白色主题**
- `theme.ts` 浅色系配色 + `userInterfaceStyle: light` + 启动页/图标白底

**移动端联系人（后续补充）**
- 底部导航新增「联系人」标签：用户（好友）+ Agent 分组、搜索、点击开聊（参考微信/Telegram 通讯录）
- 聊天页顶部连接状态条（已连接云端/未连接/重连中）；Dashboard 移除局域网设备发现
- APK versionCode 5 → 6

**版本**：0.7.0 → 0.7.1（bug 修复 → patch），APK versionCode 5

### v0.7.0 (2026-08-12) — 用户-用户 IM 全链路（桌面端）+ 会话加固

**用户-用户 IM（桌面 web 端补全，与移动端对齐）**
- 新增「用户」联系人分区（`/api/auth/users` 排除自己），已有会话显示未读 / 最后消息
- 点击用户首次发送时懒创建 direct 会话；消息方向按发送者==当前用户判定（用户会话双方 role 都是 user）
- 发送者昵称显示；历史 + WS 实时合并去重；打开会话清空旧 live 以历史为准
- 新消息到达节流刷新会话列表（未读 / 最后消息实时更新）

**服务端修复（Node 集成验证，4 处真实 bug）**
- `sendToUser` 补传 runId（原为空串，用户-用户实时消息两端关联不上会话）
- 用户-用户会话历史不过滤 userId（原按归属过滤，对方看不到消息）
- `listConversations` 增加 participant_ids 匹配（原只按归属，会话在对方列表不可见）
- 用户-用户推送接收者含会话归属用户（原只遍历 participantIds，创建者收不到对方回复）

**会话加固**
- **per-user 未读**：新增 `conversation_reads` 表，用户-用户会话各自计数，`/read` 只清当前用户（原共享计数，A 读会清 B 的未读）
- **访问控制**：用户-用户会话仅参与者可读写；agent 会话仅归属用户或共享会话可访问（原任意登录用户知道 conv id 即可读历史/发消息）

**测试**
- server 145 单元测试（新增 per-user 未读回归）；Node 双用户集成验证 12 项全通过

### v0.6.0 (2026-08-11) — 企业级升级：账号系统 + agent 原生支持 + 会话系统

**账号系统（P0）**
- users/sessions 表 + 密码登录（scrypt，零新依赖）
- 认证双凭证：用户 session token / 机器 API key / 设备 token（桌面本地）
- `/api/auth`：注册 / 登录 / 当前用户 / 登出
- 数据隔离：任务 / 运行 / 聊天按用户隔离（userId 全链传播）；agents 团队共享
- Web 登录/注册页 + 路由守卫 + token 持久化

**agent 原生支持（P1）**
- 启动自动检测并接入本机 harness（opencode / claude-code / hermes 等）
- 缺失一键安装（npm/pip，走中文镜像 npmmirror/阿里）
- 已安装的本地 agent 默认启用

**会话系统 / 企业级 IM（P2）**
- conversations 表：direct（1:1 个体对话）/ group（多 agent 群聊）
- `/api/conversations`：列表 / 创建 / 消息分页 / 发送 / 已读 / 删除
- 未读计数、会话生命周期（终态拒绝发送）
- 前端会话列表持久化 + 消息落库统一

**其他**
- 版本号规则（x.y.z：bug→patch，中型→minor）写入 WIKI

### v0.5.0 (2026-08-11) — 安全加固 + RAG 向量检索 + 移动端局域网直连 + 依赖升级

**安全加固**
- HTTP API 认证：所有 `/api/*` Bearer token；`/api/ws-token` Origin 校验；`ENSEMBLE_API_KEY` 支持
- relay-server 鉴权：`RELAY_AUTH_KEY` 握手鉴权 + `/devices` 保护 + 同设备顶替防串扰
- 三轮代码审查修复：headless 默认回环绑定 + 对外强制 API key；workflow id 路径穿越；settings 第三方 key 掩蔽；MCP 解释器命令白名单；全量写限流；health 收敛
- 取消语义：run 级取消（plan/adversarial 取消不再误标成功；取消终止本地子进程）

**新功能**
- RAG 向量检索：OpenAI 兼容 embedding 接入，vector/BM25/混合（RRF 融合）
- Chat 事件驱动：`WsHub.waitForRun` 替代 200ms 忙等待轮询
- 移动端局域网直连：桌面端 `ENSEMBLE_LAN_HOST` + mDNS；移动端原生 WebSocket 事件流（wslink）
- ConfigManager async：读缓存 + 异步写 + 互斥串行

**依赖升级**
- Express 5、reactflow → @xyflow/react v12、vitest 3、Vite base "./" + target es2022

**测试**
- server 128 单元测试 + relay-server 9 集成测试；移动端 typecheck 0 错误

### v0.4.3 (2026-08-10) — 安全加固 + 画布修复 + 内部弹窗 + 移动端全面改进

**桌面端安全加固（两轮深度审查，16 项高危修复）**
- 命令注入防护：Shell 元字符检测 + 词边界黑名单 + MCP 命令审计
- API Key AES-256-GCM 加密存储
- WebSocket Token 认证 + timingSafeEqual
- Electron CSP + will-navigate + 权限拒绝
- SSRF 防护（私有 IP + 符号链接穿越 + OpenAPI loader）
- 速率限制（API + WebSocket 双层）
- 数据库级联删除 + 复合索引

**桌面端新增功能**
- 工具确认内部弹窗（ToolConfirmDialog，替代 native dialog）
- ErrorBoundary 全局错误边界
- LLM 指数退避重试（尊重 Retry-After）
- RAGStore 持久化 + 中文 bigram 分词
- CI/CD 流水线（GitHub Actions）
- 58 个单元测试（vitest）

**桌面端修复**
- 协作画布：AgentNode 注册 + 历史事件绕过节流
- 前端性能：Dashboard/ChatPage/TasksPage memo 优化
- 编排引擎：错误传播 + DAG 死锁改进
- 记忆池：LIKE 转义 + 过期清理 + ID 碰撞消除
- 错误处理：silent catch → 日志 + toast 反馈
- 无障碍：7 个页面 ARIA 属性

**移动端全面改进**
- 新增 RunPage：任务执行详情页（实时事件流、工具调用、取消操作）
- ChatPage 改进：直接 Agent 对话 + Agent 选择器 + 错误反馈
- API 服务：全面类型化 + 15s 超时 + 用户友好错误信息
- 连接服务：事件发射器 + 指数退避重连 + 连接质量监控
- DashboardPage：任务卡片可点击 + REST API 刷新 + 连接质量显示
- SettingsPage：Ping 测试 + 连接历史 + 调试信息 + 中继认证
- ErrorBoundary 全局错误边界
- Store：事件订阅 + 类型化选择器 + 级联删除

**安全加固（两轮深度审查，16 项高危修复）**
- 命令注入防护：Shell 元字符检测 + 词边界黑名单 + MCP 命令审计
- API Key AES-256-GCM 加密存储
- WebSocket Token 认证 + timingSafeEqual
- Electron CSP + will-navigate + 权限拒绝
- SSRF 防护（私有 IP + 符号链接穿越 + OpenAPI loader）
- 速率限制（API + WebSocket 双层）
- 数据库级联删除 + 复合索引

**新增功能**
- 工具确认内部弹窗（ToolConfirmDialog，替代 native dialog）
- ErrorBoundary 全局错误边界
- LLM 指数退避重试（尊重 Retry-After）
- RAGStore 持久化 + 中文 bigram 分词
- CI/CD 流水线（GitHub Actions）
- 58 个单元测试（vitest）

**修复**
- 协作画布：AgentNode 注册 + 历史事件绕过节流
- 前端性能：Dashboard/ChatPage/TasksPage memo 优化
- 编排引擎：错误传播 + DAG 死锁改进
- 记忆池：LIKE 转义 + 过期清理 + ID 碰撞消除
- 错误处理：silent catch → 日志 + toast 反馈
- 无障碍：7 个页面 ARIA 属性

### v0.4.2 (2026-08-10) — 测试与依赖清理
- 新增 vitest 单元测试框架
- 新增 `security.ts` 单元测试（shell 元字符检测、命令黑白名单、边界情况）
- 新增 `retry.ts` 单元测试（重试逻辑、Retry-After、AbortSignal）
- 移除未使用的 `p-limit` 依赖
- 更新架构文档：补充记忆池系统与 plan/adversarial 编排模式说明

### v0.4.1 (2026-08-10) — 深色模式修复
- 修复硬编码颜色，统一使用语义化 token
- 深色模式完全兼容

### v0.4.0 (2026-08-10) — 双记忆池系统
- 显式记忆池: 长期持久化，导航栏可见
- 隐式记忆池: 项目/Run 作用域，多 Agent 共享
- 记忆池工具 + API

### v0.3.0 (2026-08-10) — 多 Agent 架构
- Plan-Execute-Reflect 三阶段编排
- Coder vs Tester 对抗迭代
- RAG 知识库 + Function Calling 适配层
- 容器化部署 (Docker + Nginx)

### v0.2.0 (2026-08-09) — 性能优化

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

## 移动端

### 架构

```
┌─────────────────────────────────────────────┐
│  手机端 (Expo + React Native)               │
│  ├─ DashboardPage: 看板 + 设备发现          │
│  ├─ TasksPage: 任务管理 + 创建              │
│  ├─ ChatPage: Agent 直接对话                │
│  ├─ RunPage: 任务执行详情 (实时事件流)       │
│  ├─ AgentsPage: Agent CRUD                  │
│  └─ SettingsPage: 连接管理 + 调试           │
├─────────────────────────────────────────────┤
│  Services                                    │
│  ├─ connection.ts: WebSocket + 事件发射器    │
│  ├─ api.ts: REST API (类型化 + 超时)        │
│  └─ discovery.ts: mDNS 设备发现             │
├─────────────────────────────────────────────┤
│  Store (Zustand)                             │
│  ├─ deviceStore: 连接状态 + 质量 + 历史     │
│  └─ taskStore: 任务/运行/Agent + 事件订阅   │
└─────────────────────────────────────────────┘
```

### 通信协议

| 方式 | 用途 | 说明 |
|------|------|------|
| mDNS | 设备发现 | 自动发现同网段桌面端 |
| WebSocket | 实时通信 | socket.io，支持局域网和云端中继 |
| REST API | 数据查询 | HTTP 请求桌面端 API |

### 连接模式

1. **局域网直连** — 同一 WiFi 下直接连接桌面端 IP
2. **云端中继** — 通过阿里云服务器中继，支持跨网络

### 连接质量监控

- 延迟采样（10 次 ping/pong）
- 等级：excellent (<50ms) / good (<150ms) / fair (<500ms) / poor (≥500ms)
- 自动重连（指数退避 + 抖动，最大 10 次）

### 构建 APK

```bash
cd mobile
npm install
cd android && ./gradlew assembleRelease
# 输出: android/app/build/outputs/apk/release/app-release.apk
```

---

## 参考项目

| 项目 | 语言 | 借鉴内容 |
|------|------|----------|
| [OpenCode](https://github.com/opencode-ai/opencode) | Go | Auto-Compact 阈值、预编译 SQL、PubSub 事件 |
| [OpenClaw](https://github.com/openclaw/openclaw) | TypeScript | 工具循环恢复、Steering 消息、EventStream 模式 |
