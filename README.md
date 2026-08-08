# 丛林系统 · 桌面原生多 Agent 协作平台

在桌面应用内**自定义创建 Agent**（选择 LLM 提供商、定义角色、配置工具），并让多个 Agent 协作完成任务。支持单发、工作流 DAG、对话式群聊三种协作模式，实时流式输出。

## ✨ 特性

- **桌面原生**：Electron 应用，本地同源服务，无云端依赖，数据与密钥留在本机
- **内部自定义 Agent**：为每个 Agent 选择模型（Anthropic / OpenAI 兼容 / 本地端点）、编写角色提示词、按需启用工具
- **多模型提供商**：Anthropic Claude API · OpenAI 兼容（OpenRouter / DeepSeek / Ollama）· 自定义端点
- **可插拔工具**：文件读写、命令执行、联网搜索、网页抓取、**MCP 工具接入**（按 Agent 配置启用）
- **Skill 系统**：Skill 池（SKILL.md 标准）+ 每个 Agent 独立勾选，运行注入上下文
- **Agent 记忆**：两级文件记忆（daily log + MEMORY.md）+ 可选 **Mem0 外部语义记忆**
- **现代 harness**：Hook 化工具循环、上下文主动压缩、大结果 offload、overflow 恢复
- **三种协作模式**：🎯 单一分发 · 🛠️ 工作流 DAG · 💬 对话式群聊
- **实时流式**：token 级输出、工具调用、运行日志实时可见
- **安全**：API Key 用系统级加密（Windows DPAPI）存储；工具操作有工作区白名单与确认弹窗

## 🚀 快速开始

前置：Node ≥ 20、pnpm。

```bash
# 1. 安装依赖（Electron 二进制国内镜像已配好）
pnpm install

# 2. 构建
pnpm --filter @jungle/shared build
pnpm --filter @jungle/server build
pnpm --filter @jungle/web build
pnpm --filter @jungle/desktop build

# 3. 启动桌面应用
pnpm --filter @jungle/desktop start
```

> 开发模式（热更新）：终端 1 `pnpm dev:web`，终端 2 `pnpm --filter @jungle/desktop dev`。

### 首次使用三步

1. **设置页 → LLM Providers**：添加提供商（Anthropic / OpenAI 兼容 / 自定义），填入 Base URL 与 API Key，点"测试连接"，可"拉取模型"
2. **Agents 页**：新建 Agent，选择 Provider + 模型，编写角色 System Prompt，勾选启用的工具
3. **任务页**：选择协作模式（单发 / 工作流 / 群聊），下发任务，实时查看流式输出与工具调用

## 🖥️ 使用示例

**单发**：一个任务发给一个或多个 Agent 并行执行，可聚合汇总。

**工作流**：DAG 编排，按依赖顺序在 Agent 间流转，支持 `{{task.prompt}}` / `{{job.<id>.result}}` 模板注入。
```json
{ "nodes": [
    { "id": "research", "agentId": "ds-researcher", "prompt": "Research: {{task.prompt}}" },
    { "id": "summary",  "agentId": "ds-assistant",  "prompt": "Summarize: {{job.research.result}}" }
  ],
  "edges": [{ "from": "research", "to": "summary", "when": "on_success" }] }
```

**群聊**：多个 Agent 轮转对话，`@agent:任务` 委派，`@done` 终止。

## 🧩 项目结构

```
packages/
├─ shared/     # 共享类型 + zod schema
├─ server/     # 引擎库：LLM Provider 层 + 工具系统 + 内置 Agent 执行器 + 编排引擎 + 本地服务
├─ web/        # 前端（Vite + React + Tailwind），桌面与浏览器均可
├─ desktop/    # Electron 壳（main/preload + 打包）
└─ cli/        # 命令行冒烟工具
```

## 🔌 API 概览

| 端点 | 说明 |
|---|---|
| `GET /api/health` | 健康检查 + Agent/Provider/工具概览 |
| `GET/POST /api/providers` | Provider 管理（API Key 入系统密钥库，永不返回） |
| `POST /api/providers/:id/test` · `GET /:id/models` | 测试连接 · 拉取模型列表 |
| `GET/POST /api/agents` | 自定义 Agent 管理 |
| `POST /api/tasks` | 创建任务并执行（single / workflow / chat） |
| `GET /api/runs` · `GET /api/runs/:id` | 运行列表 / 详情（jobs + 事件） |
| `POST /api/runs/:id/cancel` | 取消运行 |
| `GET/PUT /api/settings` | 应用设置（工作区 / 确认策略 / 搜索） |
| `WS /ws` | 实时事件推送 |

## 🧠 Agent 能力详解

- **记忆**：Agents → Agent → 记忆按钮可查看/整理。开启"长期记忆"后 Agent 跨任务积累（需消耗少量 token 做记忆提取）。可选连接 Mem0 服务获得语义检索（设置 → 工具与安全 → 外部记忆）。
- **Skill**：设置 → Skill 池 管理 SKILL.md；创建 Agent 时勾选启用的 Skill，运行时注入上下文（全量注入 SKILL.md 正文）。
- **MCP**：设置 → MCP 添加服务器（stdio 命令或 HTTP URL），工具自动注册为 `mcp__<server>__<tool>`，Agent 勾选后即可调用。

## 🔐 安全说明

- API Key 经 Electron `safeStorage`（Windows DPAPI）加密存储，明文只在主进程内存
- 工具白名单：文件读写 / 命令执行默认限制在 `工作区根目录`
- 命令执行默认弹窗确认；超时自动终止并递归清理进程树
- 本地服务仅绑定 `127.0.0.1`

## 🧪 冒烟测试

```bash
pnpm --filter @jungle/cli smoke        # 检查健康
pnpm --filter @jungle/server smoke -- <agentId> "prompt"
```
