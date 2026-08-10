# 🌴 合鸣（Ensemble）— 多 Agent 协作平台

[![GitHub release](https://img.shields.io/github/v/release/Canmender/Ensemble)](https://github.com/Canmender/Ensemble/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 桌面 + 移动端统一的多 Agent 协作平台，支持局域网直连和跨网络云端中继。

<p align="center">
  <img src="desktop/docs/images/banner.png" alt="合鸣" width="100%" />
</p>

---

## ✨ 核心能力

| 能力 | 说明 |
|------|------|
| **多 Agent 编排** | 5 种模式：单发 / 工作流 / 群聊 / Plan-Execute-Reflect / 对抗迭代 |
| **内置 Agent** | 多模型支持（Anthropic / OpenAI / 自定义端点）、工具、Skill、记忆 |
| **本地 Agent 接入** | 自动识别 Claude Code / Hermes / OpenCode / Codex 等 harness |
| **RAG 知识库** | BM25 + 向量混合检索、递归/语义分块、文档管理 |
| **Function Calling** | API 适配层、OpenAPI Spec 自动生成工具、MCP 动态发现 |
| **对抗式迭代** | Coder vs Tester 对抗、覆盖率驱动、自动 Bug 修复 |
| **实时监控** | WebSocket 批量推送、日志/时间线/画布三视图 |
| **分层记忆** | 长期 + 情境 + 全文检索 + 可选 Mem0 语义记忆 |
| **容器化部署** | Docker Compose + Nginx 反向代理 |

---

## 🏗️ 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        合鸣（Ensemble）                          │
├─────────────────────────────────────────────────────────────────┤
│  桌面端 (Electron)          │  手机端 (React Native)           │
│  ├─ Web UI (React)          │  ├─ 远程控制面板                 │
│  ├─ 内嵌服务器              │  ├─ Agent 管理                   │
│  └─ 系统托盘/自动更新       │  └─ 实时监控                     │
├─────────────────────────────────────────────────────────────────┤
│                        编排引擎                                  │
│  ├─ single: 单发/多 Agent 并行                                  │
│  ├─ workflow: DAG 调度                                          │
│  ├─ chat: 群聊轮转                                              │
│  ├─ plan: Plan → Execute → Reflect                              │
│  └─ adversarial: Coder vs Tester                                │
├─────────────────────────────────────────────────────────────────┤
│                        工具系统                                  │
│  ├─ 文件/代码/网络工具                                          │
│  ├─ RAG 知识库 (BM25 + 向量)                                    │
│  ├─ Function Calling 适配层                                     │
│  ├─ MCP 工具服务器                                              │
│  └─ 记忆工具 (memory_write/read/list)                           │
├─────────────────────────────────────────────────────────────────┤
│                        LLM Provider                             │
│  ├─ Anthropic Claude                                            │
│  ├─ OpenAI 兼容 (OpenRouter/DeepSeek/Ollama)                    │
│  └─ 自定义端点                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📁 项目结构

```
.
├── desktop/                    # 电脑端（Electron + React）
│   ├── packages/
│   │   ├── shared/             # 共享类型 + Zod schema
│   │   ├── server/             # 引擎库（LLM/工具/编排/记忆）
│   │   ├── web/                # 前端（React + Tailwind + ReactFlow）
│   │   ├── desktop/            # Electron 壳
│   │   └── cli/                # 命令行工具
│   └── docs/                   # 文档
├── mobile/                     # 手机端（Expo + React Native）
├── shared/                     # 共享通信协议
├── relay-server/               # 云端中继服务器
├── nginx/                      # Nginx 配置
├── docker-compose.yml          # Docker 部署配置
└── README.md
```

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 20
- pnpm ≥ 10
- Android SDK（手机端构建）

### 电脑端

```bash
cd desktop
pnpm install

# 构建共享包
pnpm --filter @ensemble/shared build
pnpm --filter @ensemble/server build
pnpm --filter @ensemble/web build

# 启动桌面应用
pnpm --filter @ensemble/desktop start
```

### 手机端

```bash
cd mobile
npm install
npx expo start
```

### 中继服务器

```bash
cd relay-server
npm install
npm run dev
```

### Docker 部署

```bash
# 开发环境
docker compose up

# 生产环境
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## 🤖 Agent 编排模式

### 1. Single（单发）

单个或多个 Agent 并行执行，可选聚合结果。

### 2. Workflow（工作流）

DAG 调度，支持依赖关系、条件边、模板注入。

### 3. Chat（群聊）

多 Agent 轮转对话，支持 transcript 注入、@agent 委派。

### 4. Plan-Execute-Reflect（规划-执行-反思）

```
Plan (分解任务) → Execute (调用工具) → Reflect (评估质量)
     ↑                                      │
     └──────── 修订计划 (score < 0.85) ←────┘
```

- 质量阈值控制（默认 0.85）
- 最大迭代限制（默认 5 次）
- 自动修订循环

### 5. Adversarial（对抗迭代）

```
Coder (生成代码) ←──→ Tester (找 Bug)
         ↓
    覆盖率 ≥ 90% + Bug = 0 → 完成
```

- 双 Agent 对抗
- 覆盖率驱动
- 自动迭代（最大 10 轮）

---

## 🛠️ 工具系统

### 内置工具

| 工具 | 功能 |
|------|------|
| `read_file` / `write_file` | 文件读写 |
| `execute_command` | 命令执行 |
| `web_search` / `web_fetch` | 网络搜索/抓取 |
| `memory_write` / `memory_read` / `memory_list` | 记忆管理 |
| `knowledge_search` | RAG 知识库检索 |
| `knowledge_manage` | 知识库文档管理 |

### Function Calling

```typescript
// 从 API 定义自动生成工具
const tools = adapterToTools({
  name: "github",
  baseUrl: "https://api.github.com",
  auth: { type: "token", envKey: "GITHUB_TOKEN" },
  endpoints: [
    { name: "search_repos", method: "GET", path: "/search/repositories" },
  ],
});

// 从 OpenAPI Spec 自动生成
const tools = await loadToolsFromOpenApi("https://api.github.com/openapi.json");
```

### MCP 工具服务器

支持 Model Context Protocol，可动态接入外部工具服务器。

---

## 📊 性能优化

| 优化项 | 效果 |
|--------|------|
| 路由懒加载 | 首屏 JS ↓55% |
| reactflow 动态加载 | RunPage ↓92% |
| WebSocket 批量发送 | 帧数 ↓10-50x |
| 内存 seq 计数器 | 消除 SELECT MAX |
| 预编译 SQL | DB 解析开销↓ |
| permessage-deflate | JSON 压缩 |

---

## 📦 安装包

下载最新版本：[GitHub Releases](https://github.com/Canmender/Ensemble/releases)

| 平台 | 文件 | 说明 |
|------|------|------|
| Windows | `ensemble-x.x.x-setup.exe` | NSIS 安装向导 |
| Android | `app-release.apk` | 手机端 APK |

---

## 📚 文档

| 文档 | 说明 |
|------|------|
| [多 Agent 架构](desktop/docs/MULTI_AGENT_ARCHITECTURE.md) | Memory/Tool 协议、ReAct 拆解、状态机编排、RAG、对抗迭代 |
| [架构设计](desktop/docs/ARCHITECTURE.md) | 总体架构、核心模块、数据流、扩展点 |
| [性能优化](desktop/docs/PERFORMANCE.md) | 前端/Electron/引擎优化措施、设计决策 |
| [Wiki](desktop/docs/WIKI.md) | 完整 Wiki（架构/模块/开发/部署/故障排查） |
| [事件协议](desktop/docs/event-protocol.md) | WebSocket 事件协议与断线补拉 |
| [开发指南](desktop/docs/DEVELOPMENT.md) | 本地开发、构建、测试、打包 |
| [扩展指南](desktop/docs/EXTENDING.md) | 添加工具/Agent/Provider/Skill |

---

## 🧪 测试

```bash
cd desktop
pnpm --filter @ensemble/server test   # 单元测试
pnpm -r typecheck                    # 全量类型检查
```

---

## 🔐 安全说明

- API Key 经系统加密存储（Windows DPAPI）
- 工具白名单 + 命令确认（HITL）
- 本地服务仅绑定 127.0.0.1
- 容器化部署支持资源限制

---

## 🤝 参与贡献

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/xxx`)
3. 提交更改 (`git commit -m 'feat: add xxx'`)
4. 推送到分支 (`git push origin feature/xxx`)
5. 创建 Pull Request

---

## 📄 许可证

[MIT License](LICENSE)

---

## 🔗 相关项目

| 项目 | 说明 |
|------|------|
| [OpenCode](https://github.com/opencode-ai/opencode) | Go 终端 AI 助手 |
| [OpenClaw](https://github.com/openclaw/openclaw) | 个人 AI 助手 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 状态机编排框架 |
| [AutoGen](https://github.com/microsoft/autogen) | 多 Agent 框架 |
| [MCP](https://modelcontextprotocol.io/) | Model Context Protocol |
