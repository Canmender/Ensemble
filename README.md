# 🎵 合鸣 Ensemble

> 一个本地优先的多 Agent 协作平台。连接 Claude Code、Hermes、OpenCode 等 AI Agent，通过可视化编排让它们协同工作。

[![Release](https://img.shields.io/github/v/release/Canmender/Ensemble)](https://github.com/Canmender/Ensemble/releases)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-145%20passed-brightgreen)](#测试)

---

## 它能做什么？

**一句话**：给多个 AI Agent 分配任务，让它们自动协作完成复杂工作。

```
用户: "帮我重构这个模块，同时写好测试和文档"
  ↓
合鸣: 自动拆解任务 → 分配给 Coder / Tester / Reviewer → 并行执行 → 汇总结果
```

### 五种编排模式

| 模式 | 适用场景 | 工作方式 |
|------|---------|---------|
| **单发** | 简单任务 | 一个或多个 Agent 并行执行 |
| **工作流** | 有依赖的任务链 | DAG 调度，支持条件边和模板注入 |
| **群聊** | 头脑风暴 | 多 Agent 轮转对话，@agent 委派 |
| **规划-执行-反思** | 复杂任务 | 自动拆解 → 执行 → 评估 → 迭代改进 |
| **对抗迭代** | 代码质量 | Coder vs Tester 对抗，覆盖率驱动 |

### 核心能力

- **多模型支持** — Anthropic Claude / OpenAI 兼容 / DeepSeek / Ollama / 自定义端点
- **本地 Agent 接入** — 自动识别 Claude Code / Hermes / OpenCode / Codex 等 harness
- **RAG 知识库** — BM25 + 向量混合检索，支持文档上传和语义搜索
- **工具系统** — 文件操作 / 命令执行 / 网络搜索 / MCP 动态发现
- **双记忆池** — 显式记忆（长期持久化）+ 隐式记忆（项目/Run 作用域）
- **实时监控** — WebSocket 推送，日志/时间线/画布三视图
- **IM 聊天** — 与 Agent 直接对话（消息持久化）+ **用户-用户 IM**（团队 1:1 实时会话，per-user 未读）
- **移动端** — 账号登录门禁 / 联系人通讯录（好友 + Agent）/ 会话与实时消息，自动直连云端服务器
- **账号系统** — 多用户注册/登录、数据按用户隔离；`ENSEMBLE_API_KEY` 机器级凭证
- **云部署** — Docker Compose（server + relay + nginx），域名 HTTPS 就绪

---

## 快速开始

### 环境要求

- Node.js ≥ 20
- pnpm ≥ 10

### 安装运行

```bash
# 克隆仓库
git clone https://github.com/Canmender/Ensemble.git
cd Ensemble/desktop

# 安装依赖
pnpm install

# 构建并启动
pnpm --filter @ensemble/shared build
pnpm --filter @ensemble/server build
pnpm --filter @ensemble/web build
pnpm --filter @ensemble/desktop start
```

### Docker 部署（中继服务器）

```bash
# 开发环境
docker compose up

# 生产环境
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## 项目结构

```
.
├── desktop/                    # 桌面应用
│   ├── packages/
│   │   ├── shared/             # 共享类型 + Zod schema
│   │   ├── server/             # 引擎核心（LLM/工具/编排/记忆/RAG）
│   │   ├── web/                # 前端（React + Tailwind + ReactFlow）
│   │   ├── desktop/            # Electron 壳
│   │   └── cli/                # 命令行工具
│   └── docs/                   # 文档
├── mobile/                     # 手机端（Expo + React Native）
├── relay-server/               # 云端中继服务器
├── shared/                     # 共享通信协议
└── nginx/                      # Nginx 反向代理配置
```

---

## 架构

```
┌─────────────────────────────────────────────────────┐
│  桌面端 (Electron)  │  手机端 (React Native)       │
├─────────────────────────────────────────────────────┤
│                    编排引擎                          │
│  single / workflow / chat / plan / adversarial      │
├─────────────────────────────────────────────────────┤
│                    工具系统                          │
│  文件 / 命令 / 网络 / RAG / MCP / 记忆              │
├─────────────────────────────────────────────────────┤
│                  LLM Provider                       │
│  Anthropic / OpenAI / DeepSeek / Ollama / 自定义    │
└─────────────────────────────────────────────────────┘
```

详细架构文档：
- [架构设计](desktop/docs/ARCHITECTURE.md) — 总体架构、核心模块、数据流
- [多 Agent 架构](desktop/docs/MULTI_AGENT_ARCHITECTURE.md) — 编排协议、RAG、对抗迭代
- [性能优化](desktop/docs/PERFORMANCE.md) — 前端/引擎优化措施
- [完整 Wiki](desktop/docs/WIKI.md) — 模块详解、开发指南、故障排查
- [更新日志](CHANGELOG.md) — 版本历史与发布说明（v0.1.0 → v0.7.10）

---

## 安全

项目经过两轮深度安全审查，修复了 16 项高危问题：

| 措施 | 说明 |
|------|------|
| HTTP API 认证 | 所有 `/api/*` 要求 Bearer token；`/api/ws-token` Origin 校验；支持 `ENSEMBLE_API_KEY` |
| WebSocket 认证 | Token 认证 + timingSafeEqual + 1MB 消息限制 |
| 命令注入防护 | Shell 元字符检测 + 词边界匹配 + MCP 命令审计 |
| API Key 加密 | AES-256-GCM 加密存储，自动迁移旧格式 |
| Electron CSP | Content-Security-Policy + 导航守卫 + 权限拒绝 |
| SSRF 防护 | 私有 IP 检测 + DNS 重绑定防护 |
| 速率限制 | API + WebSocket 双层限流 |
| 输入验证 | Zod schema + 字段白名单 + 路径穿越防护 |

### 移动端直连（局域网）

桌面端默认仅绑定 `127.0.0.1`。如需手机直连，启动桌面端前设置：

```bash
# 绑定局域网并自动发布 mDNS（手机端可发现）
ENSEMBLE_LAN_HOST=0.0.0.0
# 建议同时配置固定 API key（避免局域网内任意访问）
ENSEMBLE_API_KEY=your-secret-key
```

手机端通过 REST + 原生 WebSocket 直连桌面端（认证、任务创建、实时事件流），
或通过 `relay-server` 走云端中继（跨网络）。详见 [relay-server/README.md](relay-server/README.md)。

---

## 测试

```bash
cd desktop
pnpm --filter @ensemble/server test    # 145 个单元测试
pnpm --filter @ensemble/relay-server test  # 9 个集成测试（relay-server 目录）
pnpm -r typecheck                      # 全量类型检查
```

覆盖模块：API 认证（18 个用例）、安全检查（26 个用例）、LLM 重试（13 个用例）、RAG 向量检索（18 个用例）、Store 持久层（20 个用例）、编排引擎（3 个用例）、ConfigManager 异步写（10 个用例）、WebSocket 事件驱动（6 个用例）。

---

## 性能优化

| 优化项 | 效果 |
|--------|------|
| 路由懒加载 | 首屏 JS ↓55% |
| ReactFlow 动态加载 | RunPage ↓92%（@xyflow/react v12） |
| WebSocket 批量发送 | 帧数 ↓10-50x |
| Zustand 选择器优化 | 消除每 50ms 全页重渲染 |
| LLM 指数退避重试 | 429/5xx 自动恢复 |
| RAG 持久化 | 重启不丢失知识库 |
| 中文 bigram 分词 | 搜索质量显著提升 |

---

## 安装包

下载：[GitHub Releases](https://github.com/Canmender/Ensemble/releases)

| 平台 | 文件 | 说明 |
|------|------|------|
| Windows | `ensemble-x.x.x-setup.exe` | NSIS 安装向导 |
| Android | `app-release.apk` | 手机端 APK |

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 / TypeScript / Tailwind CSS / @xyflow/react / Zustand |
| 后端 | Express 5 / WebSocket / SQLite (node:sqlite) / Zod |
| 桌面 | Electron 43 / esbuild |
| 手机 | Expo / React Native |
| 部署 | Docker Compose / Nginx |
| 测试 | Vitest |

---

## 贡献

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/xxx`)
3. 提交更改 (`git commit -m 'feat: add xxx'`)
4. 推送并创建 Pull Request

开发指南见 [DEVELOPMENT.md](desktop/docs/DEVELOPMENT.md)。

---

## 许可证

[MIT License](LICENSE)
