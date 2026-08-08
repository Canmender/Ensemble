# 架构设计

## 总览

```
前端 (Vite+React+Tailwind)  ◄── REST + WebSocket ──►  后端 (Express + ws)
后端核心：
  API 层 (/api/*)
    → 编排引擎 (OrchestrationEngine)
        → 三种模式：SingleMode / WorkflowMode / ChatMode
        → Adapter Registry → ClaudeCodeAdapter / HermesAdapter
实时链路：
  Adapter → AsyncGenerator<AgentEvent> → Engine → WsHub → 前端
  每条事件先落库（SQLite，单调 seq）再广播，断线后 REST afterSeq 补拉
```

## 分层

### shared（@jungle/shared）
类型基石：`AgentEvent`（归一化事件）、`AgentConfig`、`Task/Run/Job`、`WorkflowDef`，以及 zod schema。前后端共用。

### server（@jungle/server）

| 模块 | 职责 |
|---|---|
| `adapters/types.ts` | `AgentAdapter` 接口：`startTask(input) → AsyncGenerator<AgentEvent>` |
| `adapters/claudeCode/` | Claude Code 适配器：官方 `@anthropic-ai/claude-agent-sdk` 的 `query()`，映射 stream_event 为归一化事件 |
| `adapters/hermes/` | Hermes 适配器：CLI 子进程（`hermes -z`），含 Windows 进程树清理（taskkill /T）与 WSL 路径转换 |
| `orchestration/engine.ts` | 统一执行器：job 创建、事件落库+广播、run 级 abort、per-agent 串行锁 |
| `orchestration/{single,workflow,chat}.ts` | 三种协作模式的调度 |
| `orchestration/store.ts` | SQLite 持久化（node:sqlite DatabaseSync） |
| `api/ws/hub.ts` | WebSocket 订阅/广播，心跳，cancel 转发 |

### web（@jungle/web）
Vite + React + Tailwind + zustand。`wsClient`（`lib/ws.ts`）负责连接/重连/补拉，事件经 zustand store 分发到页面。

## 关键设计决策

1. **事件先行落库**：`appendRunEvent` 分配单调 seq 写入 `run_events`，再广播。客户端重连后用 `afterSeq` 补齐缺口，保证事件不丢失。
2. **Agent 适配器归一化**：不同 Agent 的 SDK/CLI 差异全部收敛到 `AgentEvent` 联合类型，编排引擎与前端只依赖这一层。
3. **per-agent 串行**：`withAgentLock` 保证同一 Agent 实例的任务串行（防打爆），不同 Agent 并行。
4. **配置即文件**：`config/agents/*.yaml` 是 source of truth，前端 CRUD 写回文件，启动时 zod 校验。

## 状态机

```
Run:  queued → running → success | error | cancelled
Job:  queued → starting → running → success | error | cancelled
```

## 适配器差异

| | Claude Code | Hermes |
|---|---|---|
| 驱动方式 | TS SDK `query()` | CLI 子进程 `hermes -z` |
| 流式 | token 级（stream_event） | 整段返回（行级聚合） |
| 会话复用 | `session_id` + `options.resume` | `--resume <id>` |
| 工具事件 | ✓ | ✗ |
| 取消 | `AbortController` | 杀进程树（taskkill /T /F） |
