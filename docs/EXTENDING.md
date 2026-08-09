# 合鸣（Ensemble）扩展指南

如何扩展平台：添加工具、Agent 类型、LLM Provider、Skill、记忆后端。

## 添加一个工具

工具是 Agent 可调用的能力。所有工具在 `packages/server/src/tools/` 下。

**步骤：**

1. 新建 `packages/server/src/tools/xxx.ts`：
```ts
import type { AgentTool, ToolContext } from "./types";

export const myTool: AgentTool = {
  name: "my_tool",                                     // 小写下划线
  description: "When to use / what it returns / constraints",  // 描述是契约：说明何时用、返回格式
  parameters: {                                        // JSON Schema
    type: "object",
    properties: { input: { type: "string" } },
    required: ["input"],
  },
  requiresConfirmation: false,                         // 高危工具设 true（HITL）
  async execute(input: unknown, ctx: ToolContext): Promise<string> {
    // ctx: cwd / workspaceRoot / signal / agentId / appSettings(安全围栏) / askConfirm
    return "result text";
  },
};
```

2. 在 `packages/server/src/tools/index.ts` 注册：
```ts
import { myTool } from "./xxx";
// registerBuiltinTools 内：
for (const t of [myTool]) registry.register(t);
```

3. 前端 Agents 表单会自动列出新工具（health 端点），Agent 勾选即可启用。

**规范：**
- 描述说明"何时用/何时不用"（提升模型选择准确率）
- 高权限操作设 `requiresConfirmation`（桌面弹窗确认）
- 遵守安全围栏（文件/网络权限在 execute 内检查）

## 添加 Agent 类型

Agent 通过 `AgentAdapter` 接口接入引擎。当前有 `builtin`（LLM+工具）和 `local`（本地命令）。

1. 新建 `packages/server/src/adapters/<type>/executor.ts`，实现 `AgentAdapter`：
```ts
export class XxxExecutor implements AgentAdapter {
  readonly kind = "xxx" as const;
  get capabilities() { return this.cfg.capabilities; }
  async *startTask(input: AgentTaskInput): AsyncGenerator<AgentEvent> {
    // yield status/output/tool_use/error/done 事件
  }
}
```

2. 在 `adapters/registry.ts` 的 `createAdapter` 加分支。
3. `shared/src/types/agent.ts` 的 `AgentKind` 加类型 + schema。

## 添加 LLM Provider

1. `packages/server/src/llm/types.ts` 定义 `LLMProvider` 接口（chat / stream / listModels / testConnection）。
2. 新建 `llm/<name>.ts` 实现（参考 `anthropic.ts` / `openai.ts`）。
3. 在 `llm/registry.ts` 的 `buildProvider` 按类型实例化。
4. 前端设置页 Provider 类型加选项。

**要点：** 内部用 provider 中立消息格式（`tool_calls`/`tool` 角色），各 provider 负责映射到自己的 wire format。SSE 流式用 `llm/sse.ts` 的 `parseSse`。

## 添加 Skill

Skill 是 SKILL.md 格式的能力包（YAML frontmatter + markdown 正文）。

- **内置**：`packages/server/src/skills/index.ts` 的 `BUILTIN_SKILLS` 数组加一项（bootstrap 自动补写）
- **运行时**：设置页 → Skill 池 新建/编辑

```markdown
---
name: my-skill
description: 何时使用这个技能（模型据此判断激活）
---
# 技能名
## 流程
## 检查清单
```

**渐进式注入**：Agent 勾选的 skill 全量注入 system prompt（保持 ≤2KB，过长可拆 references/）。

## 添加记忆后端

记忆后端实现 `MemoryBackend` 接口（`packages/server/src/memory/backend.ts`）：

```ts
export interface MemoryBackend {
  readonly id: string;
  enabled: boolean;
  add(agentId: string, text: string): Promise<void>;          // 存储事实
  search(agentId: string, query: string, topK?: number): Promise<string[]>;  // 语义检索
  listByAgent?(agentId: string, limit?: number): MemoryEntryLike[];
  listAllAgents?(): Array<{ agentId: string; count: number; updatedAt: string }>;
  clear?(agentId: string): void;
}
```

- 参考实现：`memory/sql.ts`（SQLite + FTS5，默认）、`memory/mem0.ts`（HTTP 语义记忆）
- 在 `context.ts` 装配时选择后端

## 添加 MCP 服务器

设置页 → MCP 添加（stdio 命令或 HTTP URL）。工具自动注册为 `mcp__<server>__<tool>`，Agent 勾选后即可调用。

`McpServerConfig` 字段见 `tools/mcp/types.ts`。

## 添加工作流

`config/workflows/*.json` 或前端创建：

```json
{
  "id": "my-flow",
  "name": "我的流程",
  "nodes": [
    { "id": "a", "agentId": "agent-x", "prompt": "Do X: {{task.prompt}}" },
    { "id": "b", "agentId": "agent-y", "prompt": "Do Y: {{job.a.result}}" }
  ],
  "edges": [{ "from": "a", "to": "b", "when": "on_success" }]
}
```

## 修改安全围栏

安全围栏配置在设置页（`AppSettings.security`），工具层在 `tools/security.ts` 应用。加新检查时：
1. `shared/src/types/provider.ts` 的 `AppSettings.security` 加字段 + schema
2. `tools/security.ts` 加检查函数
3. 在对应工具的 execute 开头调用
4. 设置页加 UI（`web/src/pages/SettingsPage.tsx`）

## 通用规范

- **类型**：共享类型放 `@ensemble/shared`（前端/后端同用），zod schema 校验配置
- **事件**：一切 Agent 输出走 `AgentEvent`（status/output/tool_use/tool_result/error/done）
- **持久化**：先落库再广播（事件不丢）；`run_events` 单调 seq
- **安全**：prompt 不进 shell、路径白名单、IPC 入参校验、SSRF 防护
- **测试**：核心逻辑（hook/压缩/记忆/skill/offload/安全）写 vitest 单测
