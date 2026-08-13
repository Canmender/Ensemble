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

- **修订号（z）**：**每次代码提交 → 第三位 +1**（每个提交都是一个可追踪的迭代版本，便于按提交数核对代码迭代），并在 [CHANGELOG.md](../../CHANGELOG.md) 为该提交追加一条记录
- **次版本号（y）**：中型修改（新功能、重构、非破坏性变更、依赖升级）→ 第二位 +1
- **主版本号（x）**：破坏性变更或重大里程碑 → 第一位 +1

**提交时同步**：每次 bump 修订号，同步更新全部版本号位置：desktop 根 + cli/desktop/server/shared/web 共 6 处 package.json、mobile package.json、mobile app.json（version + versionCode）、移动端 SettingsPage `APP_VERSION`、connection.ts `appVersion`。

**版本主题**：**0.7 系列（0.7.0+）整体定位为「IM 聊天优化」**。0.7.x 内所有版本均在 IM 聊天范围内迭代（用户-用户 IM、会话加固、移动端 IM 修复等）；涉及非 IM 的新功能/重构应升 **0.8.0**，不放进 0.7.x。

发布流程：bump 后同步更新 [CHANGELOG.md](../../CHANGELOG.md)，再打包发布。

---

## 变更日志

完整版本历史见 **[CHANGELOG.md](../../CHANGELOG.md)**（v0.1.0 → v0.7.16，含历次发布说明）。

## 移动端

### 架构

```
┌─────────────────────────────────────────────┐
│  手机端 (Expo + React Native)               │
│  ├─ LoginPage: 登录/注册（应用门禁）        │
│  ├─ DashboardPage: 看板 + 任务统计          │
│  ├─ TasksPage: 任务管理 + 创建              │
│  ├─ ChatPage: 会话列表 + 实时消息 + 连接状态 │
│  ├─ ContactsPage: 联系人（用户 + Agent）    │
│  ├─ RunPage: 任务执行详情 (实时事件流)       │
│  ├─ AgentsPage: Agent 管理                  │
│  └─ SettingsPage: 账号/服务器/关于          │
├─────────────────────────────────────────────┤
│  Services                                    │
│  ├─ connection.ts: 自动连云端 + 事件发射器   │
│  ├─ api.ts: REST API（类型化 + 解包信封）    │
│  └─ wslink.ts: 原生 WebSocket 事件流        │
├─────────────────────────────────────────────┤
│  Store (Zustand)                             │
│  ├─ authGateStore: 登录门禁（in/out/loading）│
│  ├─ chatTargetStore: 联系人→聊天跳转        │
│  ├─ deviceStore: 连接状态 + 当前服务器       │
│  └─ taskStore: 任务/运行/Agent + 事件订阅   │
└─────────────────────────────────────────────┘
```

### 连接模式（仅云端）

- 应用启动自动直连自用云端服务器（`http://SERVER_IP_REDACTED:8787`），无手动连接配置
- 通信：REST API（Bearer 认证）+ 原生 WebSocket（`/ws`，实时事件流）
- 登录门禁：未登录进登录页，登录后进主界面；登录 token 持久化（AsyncStorage）
- 网络安全配置：仅放行自用服务器明文 HTTP（Android 9+），其余强制 HTTPS
- 注：域名 `DOMAIN_REDACTED` HTTPS 受阿里云备案拦截，待备案合规后切换

### 实时与 IM

- 用户-用户 1:1 会话、Agent 对话、多 Agent 群聊（conversations API + WS 实时推送）
- 联系人页：好友（注册用户）+ Agent 分组、搜索、点击开聊
- 聊天页顶部连接状态条（已连接云端/未连接/重连中）

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
