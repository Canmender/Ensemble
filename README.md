# 🌴 丛林系统（Jungle System）

桌面原生多 Agent 协作平台 —— 在应用内自定义创建 Agent、管理记忆与技能，让多个 Agent 协作完成工作流与头脑风暴。

![GitHub release](https://img.shields.io/github/v/release/Canmender/jungle-system)

## ✨ 核心能力

| 能力 | 说明 |
|---|---|
| **内置 Agent** | 为每个 Agent 选择模型（Anthropic / OpenAI 兼容 / 本地）、编写角色、按需启用工具与技能 |
| **本地 Agent 接入** | 自动识别本机已安装的 harness（Claude Code / Hermes / OpenCode / Codex 等），选母本一键创建，同步其技能/记忆/配置 |
| **多模型提供商** | Anthropic Claude · OpenAI 兼容（OpenRouter / DeepSeek / Ollama）· 自定义端点 |
| **可插拔工具** | 文件读写、命令执行、联网搜索、JSON/时间、MCP 工具接入、显式记忆读写 |
| **Skill 系统** | Skill 池（SKILL.md 标准）+ 每个 Agent 独立勾选，运行时注入上下文 |
| **Agent 记忆** | 分层记忆（长期 MEMORY.md + 近期情境 + SQL 全文检索）+ 可选 Mem0 语义记忆 |
| **现代 Harness** | Hook 化工具循环、上下文主动压缩、并行工具调用、大结果 offload、HITL 审批 |
| **协作看板** | 准备中 / 进行中 / 审核中 / 已完成 四列，活跃 Agent 高亮，工作流步骤进度条 |
| **工作流** | 链式递进可视化：实时显示当前步骤、已完成输出、待执行步骤 |
| **群聊头脑风暴** | Agent 讨论空间（不直接改项目），完成后审批通过即放入看板/工作流制作 |
| **实时监控** | WebSocket 全局订阅，日志/时间线/画布三视图，工具调用链可视化 |

## 🚀 快速开始

前置：Node ≥ 20、pnpm。Claude Code / Hermes 等本地 harness 按需。

```bash
# 1. 安装依赖（Electron 二进制国内镜像已配）
pnpm install

# 2. 构建
pnpm --filter @jungle/shared build
pnpm --filter @jungle/server build
pnpm --filter @jungle/web build
pnpm --filter @jungle/desktop build

# 3. 启动桌面应用
pnpm --filter @jungle/desktop start
```

### 首次使用

1. **设置 → LLM Providers**：添加提供商，测试连接，拉取模型
2. **Agents**：新建内置 Agent（选 Provider+模型+工具+Skill）或本地 Agent（选 harness 母本）
3. **任务**：单发 / 工作流 / 群聊，实时看板/工作流页跟进

## 📦 安装包与升级

- 一键安装（含卸载程序），可自定义安装目录
- **自动升级**：应用内检测 GitHub Releases 新版本，下载新安装包一键更新（electron-updater）
- 手动下载最新版：GitHub [Releases](https://github.com/Canmender/jungle-system/releases)

## 🧩 项目结构

```
packages/
├─ shared/     # 共享类型 + zod schema
├─ server/     # 引擎库：LLM Provider、工具、Skill、记忆、发现、编排、本地服务
├─ web/        # 前端（React + Tailwind + ReactFlow）
├─ desktop/    # Electron 壳（含打包/自动更新）
└─ cli/        # 命令行工具
```

## 🔌 API 概览

| 端点 | 说明 |
|---|---|
| `GET /api/health` | 健康检查 + Agent/工具/技能概览 |
| `GET/POST /api/providers` | LLM Provider 管理 |
| `GET/POST /api/agents` | Agent 管理（内置 / 本地） |
| `GET/POST /api/skills` | Skill 池管理 |
| `GET/POST /api/mcp` | MCP 服务器管理 |
| `GET/POST /api/tasks` | 任务创建与执行（single/workflow/chat） |
| `GET /api/memory` | 全局记忆汇总 |
| `GET/POST /api/discovery` | 本地 harness 识别与同步 |
| `WS /ws` | 实时事件推送（支持 wildcard 订阅） |

## 🧪 测试

```bash
pnpm --filter @jungle/server test   # 单元测试
pnpm -r typecheck                    # 全量类型检查
```

## 📄 日志

功能演进见 [CHANGELOG.md](CHANGELOG.md)。

## 🔐 安全说明

- API Key 经系统加密存储，明文只在主进程
- 工具白名单（工作区）+ 命令确认（HITL），缺确认环境自动拒绝
- 本地命令 Agent 的 prompt 已做 shell 转义防注入
- 本地服务仅绑定 127.0.0.1
