# 合鸣（Ensemble）架构设计

桌面原生多 Agent 协作平台：在应用内自定义 Agent、管理记忆与技能，让多个 Agent 协作完成工作流与头脑风暴。

## 总体架构

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

实时链路：`Adapter → AsyncGenerator<AgentEvent> → Engine → WsHub → 前端`。
每条事件先落库（SQLite，单调 seq）再广播，断线重连后 REST `afterSeq` 补拉。

## 目录结构

```
packages/
├─ shared/     # 共享类型 + zod schema（@ensemble/shared）
├─ server/     # 引擎库（@ensemble/server）
│  └─ src/
│     ├─ llm/          # LLM Provider 抽象（Anthropic/OpenAI 兼容 + SSE）
│     ├─ tools/         # 可插拔工具（file/code/web/utility/memory/mcp）+ 安全围栏
│     ├─ skills/        # Skill 池（SKILL.md 解析/存储）
│     ├─ memory/        # 分层记忆（store/llm/provider/sql/mem0/backend）
│     ├─ hooks/         # Hook 化工具循环（manager/memory/compaction）
│     ├─ context/       # 上下文压缩（manager/offload）
│     ├─ adapters/      # Agent 适配器（builtin/local）
│     ├─ discovery/     # 本地 harness 识别与同步
│     ├─ orchestration/ # 编排引擎（engine/single/workflow/chat/store/state）
│     └─ api/           # REST 路由 + WebSocket hub
├─ web/        # 前端（@ensemble/web）
├─ desktop/    # Electron 壳 + 打包（@ensemble/desktop）
└─ cli/        # 命令行工具（@ensemble/cli）
```

## 核心模块

### Agent 适配器

统一接口 `AgentAdapter.startTask(input) → AsyncGenerator<AgentEvent>`，引擎/前端只依赖这一层。

- **BuiltinAgentExecutor**：内置 Agent（LLM + 工具循环），支持多 Provider、上下文压缩、记忆注入
- **LocalAgentExecutor**：本地命令 Agent（接入已有 harness CLI），prompt 转义防注入

### Harness（工具循环）

`adapters/builtin/loop.ts` 是 hook 驱动的 agentic 循环：

```
preReasoning（记忆注入/压缩）→ Steering 消息检查 → 工具循环检测 → LLM 流式 → postReasoning → 并行执行工具 → postToolResult → postCall
```

- **Hook 系统**：`preReasoning / postReasoning / postToolResult / postCall / onError` 可插拔事件点
- **上下文压缩**：原子组配对保护 + LLM 结构化摘要 + overflow 恢复 + 大结果 offload
- **Auto-Compact**：token 使用达 95% 时自动触发压缩（参考 OpenCode）
- **工具循环恢复**：相同工具+参数连续调用 3 次 → 自动终止并引导 LLM 换策略（参考 OpenClaw）
- **Steering 消息**：用户在 agent 运行中可通过 WS 发送消息注入上下文（参考 OpenClaw）
- **并行工具调用**：独立工具同时执行，确认串行（HITL）
- **安全围栏**：命令黑白名单/危险命令、网络/文件读/写开关、SSRF 防护

### 记忆系统（`memory/`）

分层记忆：
- **semantic**：长期记忆 `MEMORY.md`（LLM consolidate 提取）
- **episodic**：近期日常日志（具体情境）
- **相关检索**：SQLite FTS5 全文搜索（或可选 Mem0）
- **显式记忆**：`memory_write/read/list` 工具让 Agent 自主记忆
- 成本遥测 + 轮转清理 + 每日维护

### 编排引擎（`orchestration/`）

三种协作模式，统一通过 `executeJob` 执行：
- **single**：单发/多 Agent 并行 + 可选聚合
- **workflow**：DAG 调度（依赖/条件边/模板注入 `{{job.<id>.result}}`）
- **chat**：群聊轮转（transcript 注入 / `@agent:` 委派 / `@done` 终止）

### 事件与实时（`api/`）

- REST API + WebSocket hub（支持 wildcard 订阅 `*`，看板/工作流实时）
- 事件先落库（`run_events` 单调 seq）再广播，断线重连 `afterSeq` 补拉

### 原生 Windows（`desktop/`）

- Electron 壳：单实例锁、系统托盘、崩溃处理、开机自启、深色适配
- electron-builder NSIS 安装包（卸载程序 + 自定义目录）+ electron-updater 自动升级
- 本地同源服务：prod 随机端口 + 托管 `web/dist`

## 数据流示例（单发任务）

1. `POST /api/tasks` → Engine 创建 Run（queued）→ 广播 `run.status`
2. `runAsync` 进入 single 模式 → 创建 Job → `executeJob` 调 adapter
3. `startTask` 流式产出 AgentEvent → 每事件落库 + WS 广播 → 前端实时显示
4. 完成后更新 Run status + finalResult → 广播 `run.result`

## 扩展点（快速上手）

- **加工具**：`tools/` 新建文件 + `tools/index.ts` 注册（见 EXTENDING.md）
- **加 Agent 类型**：`adapters/` 新 executor + `registry.ts` 分支
- **加 Provider**：`llm/` 实现 `LLMProvider`
- **加 Skill**：`skills/` 或设置页 SKILL.md
- **加记忆后端**：`memory/backend.ts` 实现 `MemoryBackend`
