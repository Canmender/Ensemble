# 变更日志

本项目采用语义化版本（SemVer）。所有值得注意的变更记录于此。

## [0.4.3] - 2026-08-10

安全加固 + 协作画布修复 + 工具确认内部弹窗 + 单元测试。

### 🔒 安全加固

- 命令注入防护：Shell 元字符检测 + 词边界黑名单 + 首 token 精确匹配
- API Key 加密存储：AES-256-GCM 加密 + 自动迁移旧明文格式
- WebSocket 认证：Token 认证 + timingSafeEqual + 1MB 消息限制
- Electron CSP：Content-Security-Policy + will-navigate 导航守卫 + 权限拒绝
- SSRF 防护：私有 IP 检测 + OpenAPI loader + 符号链接穿越防护
- MCP 命令注入检测 + 审计日志
- 速率限制：API + WebSocket 双层限流
- 数据库：任务删除级联清理 + 复合索引优化

### 🎉 新增

- 工具确认内部弹窗（替代 Electron native dialog）
- ErrorBoundary 全局错误边界
- LLM 指数退避重试（429/5xx 自动恢复，尊重 Retry-After）
- RAGStore 持久化（JSON 文件 + 60s 自动保存）
- 中文 bigram 分词（搜索质量显著提升）
- CI/CD 流水线（GitHub Actions: typecheck + test + build + docker）
- 单元测试（vitest，58 个用例，覆盖安全/重试/工具/编排）

### 🔧 修复

- 协作画布：注册 AgentNode 自定义组件，修复空白显示
- 前端性能：Dashboard 消除全页重渲染，TasksPage/ChatPage memo 优化
- 错误处理：所有 silent catch 添加日志，前端表单 toast 反馈
- 编排引擎：Agent 错误传播修复，DAG 死锁仅阻塞依赖链
- 记忆池：SQL LIKE 通配符转义，过期记忆自动清理，ID 碰撞消除
- Chat 轮询优化 + error/cancelled 提前退出
- Nginx 安全头（HSTS/CSP/Referrer/Policy）
- Dockerfile 端口修复（3001 → 8888）

### ♿ 无障碍

- 7 个页面添加 aria-label / role / aria-expanded / aria-current

### 📦 代码质量

- 3 个共享模块提取（useConfirm / historyCache / loadRunDetail）
- TypeScript any 消除（desktop.d.ts 类型声明 + 具体类型替换）
- 移除未使用的 p-limit 依赖

## [0.4.2] - 2026-08-10

IM 风格聊天 + 可视化协作画布 + 简化任务创建。

### 🎉 新增

**IM 风格聊天**
- ChatPage: 与 Agent 直接对话，消息跨页面切换持久化
- 新增 chat API 端点 (`/api/chat`)
- WebSocket steer 支持实时消息注入

**协作画布**
- WorkflowsPage: 基于 React Flow 的可视化协作画布
- 画布展示所有任务节点及关联关系

**任务创建优化**
- DashboardPage: 简化为单任务创建模式
- AI 自动决定协作方式，降低用户操作门槛

## [0.4.1] - 2026-08-10

深色模式色彩修复版本。

### 🔧 修复

- AgentsPage: 硬编码 amber 颜色改为 warning 语义 token
- ChatPage: 硬编码 blue/emerald 颜色改为 primary/success 语义 token
- ChatPage/TasksPage: text-white 改为 text-primary-fg
- 所有颜色统一使用语义化设计 token，深色模式兼容

## [0.4.0] - 2026-08-10

双记忆池系统，参考腾讯 Agent Memory 架构。

### 🎉 新增

**记忆池系统**
- 显式记忆池: 长期持久化，导航栏可见，Agent 可读取往期记忆
- 隐式记忆池: 项目/Run 作用域，多 Agent 共享重要上下文
- 主动筛选: 重要度阈值过滤 (0.5)，自动评估重要度
- 自动过期: 隐式记忆 24h TTL，超限自动淘汰
- 记忆池工具: memory_pool_write/read/list
- 记忆池 API: /api/memory-pool/explicit/implicit/stats

**架构改进**
- 参考腾讯 Agent Memory L0-L3 分层
- 延迟嵌入模式 (异步后台计算)
- 上下文分割 (动态/稳定分离)
- 混合检索 + RRF 融合

## [0.3.0] - 2026-08-10

多 Agent 架构大版本。实现完整的 Agent 编排框架。

### 🎉 新增

**编排模式**
- Plan-Execute-Reflect 三阶段迭代（质量阈值 0.85，最大 5 轮）
- Coder vs Tester 对抗式代码迭代（覆盖率驱动，最大 10 轮）
- Planner / Critic / Summarizer 角色分工

**工具系统**
- RAG 知识库：BM25 + 向量混合检索，递归/语义分块
- Function Calling 适配层：API 定义自动生成工具，OpenAPI Spec 解析
- 预定义 GitHub API 适配器

**网络优化**
- WebSocket 消息批量发送（16ms 缓冲，帧数 ↓10-50x）
- permessage-deflate 压缩 JSON 负载
- 背压处理（bufferedAmount > 4MB 时仅发送关键消息）
- 内存 seq 计数器（消除 SELECT MAX 查询）
- LLM 模型列表缓存（5 分钟 TTL）
- SSE 缓冲区保护（10MB 上限）
- WS 重连抖动（防雷群效应）

**容器化部署**
- Docker Compose 完整配置（relay + nginx）
- Nginx 反向代理（WebSocket 支持、Gzip 压缩）
- 生产环境资源限制配置

**UI 设计优化**
- 深色模式色彩修复（语义化 token）
- Modal 增强（role=dialog + 动画 + 焦点陷阱）
- 自定义 ConfirmDialog / Toast 替换原生 confirm/alert
- Checkbox 样式统一
- 无障碍改进（aria-label、focus-visible）

### 📚 文档

- 新增 docs/MULTI_AGENT_ARCHITECTURE.md：多 Agent 架构设计手册（1200+ 行）
- 更新 docs/WIKI.md：路线图进度、工具系统文档
- 更新 docs/ARCHITECTURE.md：新增任务模式表格

## [0.2.0] - 2026-08-09

性能优化大版本。参考 OpenCode (Go) 和 OpenClaw (TypeScript) 的架构模式。

### ⚡ 性能优化

**前端**
- React.lazy 路由懒加载：首屏 JS 426KB → 190KB（↓55%）
- reactflow 动态加载：RunPage 153KB → 13KB（↓92%），仅画布视图按需加载
- Vite vendor-react/vendor-flow chunk 拆分，长期缓存命中率↑
- 移除死依赖（@anthropic-ai/claude-agent-sdk, uuid）：-94 个包

**Electron**
- GPU 光栅化 + 零拷贝渲染标志，减少 CPU 占用
- 后台渲染节流（setBackgroundThrottling），窗口最小化时降频

**引擎**
- Auto-Compact 阈值 0.5 → 0.95（参考 OpenCode），避免过早压缩浪费 LLM 调用
- 工具循环恢复（参考 OpenClaw）：相同工具+参数窗口内重复 3 次 → 自动终止
- Steering 消息注入（参考 OpenClaw）：用户在 agent 运行中可通过 WS 发送消息
- 预编译 SQL 语句（参考 OpenCode sqlc）：启动时一次性 prepare，减少重复解析

### 📚 文档

- 新增 docs/PERFORMANCE.md：性能优化措施、设计决策、维护指南
- 新增 docs/WIKI.md：完整 Wiki（架构/模块/开发/部署/故障排查）
- 更新 docs/ARCHITECTURE.md：Harness 部分（Auto-Compact/循环恢复/Steering）
- 更新 docs/event-protocol.md：Steering 消息协议

### 🔧 修复

- 代码审查修复：工具循环检测改进（滑动窗口）、offload 目录统一、类型定义统一

## [0.1.0] - 2026-08-08

合鸣首个发布版。基于完整的 MultiAgent 平台演进，更名并打包发行。

### 🎉 新增

**核心平台**
- 桌面原生应用（Electron + 本地同源服务）
- 内置 Agent：多模型提供商（Anthropic / OpenAI 兼容 / 自定义端点）、角色、工具、参数
- 本地命令 Agent：接入已有 harness（Claude Code / Hermes / OpenCode / Codex 等）

**Harness 能力**
- Hook 化工具循环（preReasoning/postToolResult/onError 等可插拔事件点）
- 上下文主动压缩（原子组配对保护、结构化摘要、overflow 恢复）
- 并行工具调用（独立工具同时执行，3-5× 加速）
- 大工具结果 offload + 可读指针
- HITL 审批可视化（等待输入状态）

**记忆系统**
- 分层记忆：长期 MEMORY.md + 近期情境 + SQLite 全文检索（FTS5）
- 显式记忆工具（memory_write/read/list，agent 自主记忆）
- 可选 Mem0 语义记忆、记忆成本遥测、轮转清理

**Skill 系统**
- Skill 池（SKILL.md 标准）+ per-agent 配置 + 全量注入
- 10 个内置 skill（代码评审/调研/写作/数据分析/问题拆解/API 设计/SQL/git/正则/TDD）

**协作与可视化**
- 协作看板（准备中/进行中/审核中/已完成 四列 + 状态字形 + 工作流步骤进度）
- 工作流链式递进可视化（实时步骤、已完成输出、待执行）
- 群聊头脑风暴空间 + 审批通过 → 看板/工作流制作
- Run 页日志/时间线/画布（ReactFlow）三视图

**本地集成**
- 本地 harness 自动识别（9 种）+ 选母本创建 Agent
- 一键同步本地技能/记忆/配置
- 全局记忆页

### 🔧 修复（自检）
- run_events seq 碰撞 → 原子分配
- 记忆/技能删除路径穿越 → 正则校验
- 本地命令 prompt shell 注入 → 转义 + shell:false
- execSync 阻塞 → TTL 缓存
- 并行工具/确认弹窗 abort 不感知 → race
- 多页历史加载守卫、负 seq 冲突、store 无限增长等 20+ 项

### 🏷️ 更名
- 项目更名为 **合鸣（Ensemble）**，包名 `@ensemble/*`
