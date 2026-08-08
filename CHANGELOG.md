# 变更日志

本项目采用语义化版本（SemVer）。所有值得注意的变更记录于此。

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
