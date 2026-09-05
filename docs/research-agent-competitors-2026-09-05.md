# AI Agent 编排竞品调研报告（2026-09-05）

> 面向合鸣 Ensemble 的竞品/标准调研。信息通过官方 docs / GitHub 仓库 / 官方博客抓取核实（WebSearch 工具当日不可用，全部用 WebFetch/curl 直抓一手来源）。
> 调研时点：2026-09-05。版本号、发布日期均取自 GitHub releases API 与官方 changelog。

## 0. 执行摘要（TL;DR）

1. **框架层正在剧烈收敛，协议层正在剧烈扩展。** 框架（AutoGen→MAF、Swarm→Agents SDK→AgentKit 又拆回 SDK、Letta V1→letta-code、MetaGPT 转向 MGX 商业产品）都在换壳/停更/商业化，但 **MCP 与 A2A 两个开放协议在 2026 年上半年完成了各自的大版本跃迁**（MCP 2026-07-28 彻底无状态化；A2A v1.0 进入 Linux 基金会）。合鸣的互联定位应押注协议（A2A/MCP），不押框架。
2. **MCP 2026-07-28 是 host 实现者的重大变更**：删除 session/initialize 握手、协议全面无状态化、list 结果强制带 `ttlMs`/`cacheScope` 缓存字段、elicitation 被 Multi Round-Trip Requests 模式取代、tasks 从核心挪进官方扩展。合鸣若要升级 MCP host 能力，这是一次性对齐点。
3. **A2A v1.0（2026-03 GA）已具备合鸣"多 agent 互联"所需的全部原语**：Agent Card（`/.well-known/agent-card.json` 发现）、opaque 协作（不暴露内部状态/记忆/工具）、长任务（LRO + SSE + push notifications）、JSON-RPC 2.0 over HTTPS。AgentScope 2.0（2026-09）已内置 `A2AAgent` 远程聊天，说明 A2A 正在被各家框架当作"默认远程通信层"。
4. **记忆与状态是竞品差异化主战场**：LangGraph（durable execution + checkpoint 持久化恢复）、CrewAI（统一 Memory 类：语义+时近+重要度复合打分）、Letta（agent 自改写记忆块 + MemFS git 化）、OpenAI（SandboxAgent 跨长时间跨度保持工作区状态）。合鸣已有 memory 层，可借鉴点具体化在 §10。
5. **IM 即编排载体是合鸣独有的差异化**：竞品里只有 AgentScope 2.0 与 Letta Code 把 IM channel（钉钉/飞书/Discord/Slack/Telegram）做成一等公民。这是合鸣相对所有 Python 系框架的结构性优势，建议把"IM 消息流 = agent 事件流"写进架构叙事。
6. **人机协同（HITL）已标准化为"中断-批准-改状态"三件套**：LangGraph `interrupt`、OpenAI Agents SDK `needs_approval`、Claude Agent SDK hooks（PreToolUse deny）、MAF human-in-the-loop + time-travel。合鸣的 IM 卡片/消息确认交互天然适配，缺的是把 agent 状态机与"待确认消息"绑定。

---

## 1. LangGraph（langchain-ai/langgraph）

- **最新版本**：`langgraph 1.2.11`（2026-08-11）、`langgraph-sdk 0.4.4`（2026-08-27）；Python + JS（LangGraph.js）双栈。仓库已不再叫 "LangGraph Platform"，商业化整体并入 **LangSmith**（LangSmith Deployment 为产品名）。
- **编排模型**：**图（Pregel 超步模型）**。StateGraph = 节点（函数）+ 边（静态/条件），受 Google Pregel 与 Apache Beam 启发，接口借鉴 NetworkX。2025 起 README 主叙事从"图"转向 **durable execution（持久执行）**：任何节点失败/进程重启后可从 checkpoint 精确恢复。
- **状态与记忆**：双层。**短期**：graph state（reducer 合并策略，每超步落 checkpoint，`checkpoint` 包 4.2.0，2026-08 发布）；**长期**：跨 session 的持久 Store（长期记忆 API，按命名空间 key-value，可加向量索引）。thread = 一条状态线。
- **多 agent 模式**：官方推荐 **supervisor（主管分派）/ swarm（handoff 移交）/ 层级（hierarchical subgraphs）** 三种拓扑；subgraph 支持嵌套；`Deep Agents` 是 2025 年底推出的高层包（planning + subagents + 文件系统），定位"快速构建"，底层仍是 LangGraph。
- **通信协议**：框架内部消息/事件总线；对外走 **MCP**（工具）；与 A2A 的对接靠社区/`deployments-wrap-sdk`（把 Google ADK、CrewAI、AutoGen、Claude Agent SDK 都包成 LangGraph 部署，说明它想做"运行时中立层"）。
- **可观测性**：LangSmith tracing（trace 执行路径、state 迁移、运行时指标）；2026-08 SDK 新增"从 thread 流路由 LangSmith traces"。另有 **LangSmith Engine**：从生产 trace 自动发现反复失败并给根因。
- **HITL**：`interrupt` 原语——任意点暂停、人类检视/修改 state 后 resume；配合 checkpoint 天然支持"暂停数天再续"。
- **商业化/自部署**：LangSmith Deployment 四档：**Cloud（全托管）/ BYOC Hybrid（控制面托管+数据面自托管）/ 全自托管（K8s，Enterprise）/ Standalone Agent Server（Docker/K8s + 自带 PG/Redis，无控制面）**。执行模型三件套：**assistants（配置）/ threads（状态）/ runs（工作负载）**——这套命名值得合鸣直接对照（合鸣已有 agents/tasks/runs/jobs，概念高度同构）。
- **2025-2026 动向**：① 从"低层图框架"重新定位为"长时状态 agent 的基础设施"；② Deep Agents 高层包；③ 部署面吞并多框架（wrap-sdk）；④ JS 栈与 Python 栈功能对齐。
- **合鸣可借鉴**：
  - **assistants/threads/runs 三层资源模型**（对照合鸣 agents/runs/jobs，建议补显式 "thread=状态线" 概念，一条会话 = 一条可 checkpoint 的状态线）；
  - **durable execution 的"超步落盘"**：合鸣每个 agent 步骤（run）结束即写 checkpoint，崩溃后从最后完整步恢复，而不是重放 LLM 调用；
  - **interrupt = IM 卡片**：把 interrupt 渲染成 IM 里的"待确认卡片"，resume 走 IM 回复，这是合鸣相对 LangGraph 的 UX 优势；
  - Standalone 部署档 = 合鸣"单组织自部署"的产品形态参照。

## 2. CrewAI（crewAIInc/crewAI）

- **最新版本/状态**：活跃（2026-09-04 仍有 push）；star 58k。商业化 = **CrewAI AMP Suite**（managed deployment + observability + governance + security），其中 **Crew Control Plane** 可免费试用（app.crewai.com）。
- **编排模型**：**双轨**——
  - **Crews**：角色化 agent 团队协作（role/goal/backstory），process 分 `sequential` 与 `hierarchical`（manager agent 分派）；
  - **Flows**：事件驱动的精确控制流（`@start`/`@listen`/`@router` 装饰器），显式 state 管理、条件分支、可混入 Crew。官方口径："Crew 负责自主协作，Flow 负责精确控制，组合使用是生产姿势"。
- **状态与记忆**：2025 年重构为**统一 `Memory` 类**（替代旧的 short-term/long-term/entity/external 四种）：`remember()` 时 LLM 推断 scope/类目/重要度，`recall()` 用**复合打分（语义相似度 + 时近度 + 重要度，权重可调、half-life 可调）**；scope 是自动组织的**树形路径**（`/project/old` 可整体 `forget`）；`extract_memories()` 从长文本抽原子事实。Crew 级共享 + agent 级私有 scope。
- **多 agent 通信**：Crew 内消息/delegation（hierarchical 下 manager 通过 LLM 决定分派）；对外无标准协议（无 A2A/MCP 官方一等集成，主要靠工具层接 MCP）。
- **可观测性**：AMP/Control Plane 提供 tracing、metrics、logs、analytics（商业能力，开源核心不含）。
- **HITL**：task 级 `human_input=True`（任务产出后人工审核）；Flow 里就是普通 Python 分支（想怎么停怎么停）。
- **自部署**：纯 Python 库，任何环境；AMP 支持 on-premise。
- **2025-2026 动向**：统一 Memory 类、Flows 成为主推生产形态、面向 AI 编码 agent 发布官方 **Skills**（`crewai-skills`，教 Claude Code/Cursor 怎么写 CrewAI——注意：它也在做 skills 生态位争夺）、Control Plane 免费档拉新。
- **合鸣可借鉴**：
  - **复合打分记忆检索**（semantic+recency+importance 三权重可调）——合鸣 memory 层若只做向量检索，这是明确升级路径；
  - **scope 树**：把记忆按 `/org/agent/task` 路径组织、支持整支删除，与合鸣"单组织"模型吻合；
  - **Crew/Flow 双轨**验证了"自主协作 + 精确控制流"并存是用户真实需求——合鸣的 workflows（精确）与 agent 自由协作（自主）应显式共存，不要二选一。

## 3. AutoGen / AG2 / Magentic-One / Microsoft Agent Framework

- **现状（重大变化）**：**微软 AutoGen 已进入 Maintenance Mode**（README 顶部 CAUTION 明示：不再加新功能，社区维护；最后 release `python-v0.7.5` 停在 2025-09-30，仓库最后 push 2026-04）。官方后继 = **Microsoft Agent Framework（MAF）**（github.com/microsoft/agent-framework，1.0 生产可用：Python `agent-framework 1.17.0`（2026-09-03）、.NET `1.20.0`（2026-08-31），另有 Go SDK 独立仓库）。
- **AutoGen v0.4 架构（已冻结但仍是业界 actor 模型参照）**：async-first、**actor 模型**——每个 agent 是独立 actor，通过 **topic + subscription** 收发消息（pub/sub 而非点名调用），`autogen-core`（事件驱动运行时）+ `autogen-agentchat`（高层 team 抽象：RoundRobinGroupChat / SelectorGroupChat / Swarm）+ `autogen-ext`。多 agent 编排现推荐 `AgentTool`（把 agent 包成工具给主 agent 调，即"supervisor as tool-calling"）。
- **AG2**（AutoGen 社区 fork，现自称 "Open-Source AgentOS"）：**v1.0 已发布**（`ag2 1.0.3`，2026-08-28），彻底协议驱动重写：核心 `Agent.ask()` 异步返回 `AgentReply`；多 agent 用 **Network（hub + typed channels）** 取代 GroupChat；旧版（ConversableAgent/GroupChat）拆到 `ag2-classic` 仓库继续维护。harness 层有 knowledge、context assembly、history compaction；支持 HITL pause。
- **Magentic-One**：微软 2024 的通用多 agent 系统（orchestrator + web surfer/file surfer/terminal/coder），现已并入 MAF 的示例/模式层，不再是独立产品。
- **MAF 关键能力**（AutoGen 的正统继承者，**这是"微软系 2026 现状"的正确答案**）：
  - 图工作流：sequential / concurrent / handoff / group collaboration 四模式；
  - **checkpointing + streaming + HITL + time-travel**（回退到历史状态点重放）；
  - **跨运行时互操作：官方 A2A + MCP 双协议支持**（README 明示 "cross-runtime interoperability via A2A and MCP"）；
  - **Declarative Agents**：YAML 定义 agent（版本化、非代码配置）；
  - **Agent Skills**：从文件/代码/类库构建领域知识库供 agent 发现使用（与 Claude Skills 同赛道）；
  - OpenTelemetry 原生集成；中间件管道；Foundry Hosted Agents（2 行代码部署到微软托管）。
- **可观测性**：MAF 内置 OTel 分布式 tracing（AutoGen 旧版靠事件流自行接）。
- **合鸣可借鉴**：
  - **MAF 是"企业级默认答案"的信号**：checkpoint + time-travel + OTel + 声明式 YAML agent + A2A/MCP 互操作，这五件事就是合鸣 agent 编排层的验收清单；
  - **actor + topic 模型**（AutoGen v0.4）适合 IM 场景：agent 订阅 IM 频道话题（topic），比"agent 互调 API"更符合 IM 心智；
  - **time-travel**（回退状态点）对"IM 里误操作 agent"是高价值 UX——用户说"回退到上一步"即可。

## 4. OpenAI Agents SDK / Swarm / AgentKit

- **现状**：**Swarm 已正式退役**，演进路径 Swarm（实验，2024-10）→ **OpenAI Agents SDK**（2025-03 GA，当前 `v0.22.0`，2026-08-19，JS 版同步）→ 2025-10 发布 **AgentKit**（低代码平台）→ **2026-06-03 官方宣布：Agent Builder 与 Evals 产品将于 2026-11-30 起下线**，引导回 Agents SDK（代码优先）或 ChatGPT Workspace Agents。**OpenAI 的低代码平台尝试已收缩**——这对合鸣是利好信号：纯低代码画布路线被原厂自己证伪，代码/协议优先回潮。
- **编排模型**：**轻量级图 + handoff**。Agent（instructions+tools+guardrails）→ `Runner` 执行循环；**handoffs**（agent 把控制权移交给另一 agent）或 **agents-as-tools**（agent 作为工具被调用）两种多 agent 模式；无显式状态机，状态靠 session。
- **状态与记忆**：**Sessions**（自动跨 run 管理对话历史，支持 SQLite/Redis 后端）；**SandboxAgent**（2025 新增）：agent 预绑定容器工作区，跨长时任务保持文件/命令/patch 状态（`Manifest` 声明初始工作区，支持 GitRepo 拉取）；RealtimeAgent（gpt-realtime 语音）与 VoicePipeline（STT→agent→TTS）。
- **通信协议**：MCP 工具官方一等支持；**无 A2A**（OpenAI 阵营走自家 Responses API + Connector Registry）；handoff 是 SDK 内部机制，不跨进程/跨框架。
- **可观测性**：内置 **Tracing**（agent run 全链路 trace，OpenAI 平台内可视化/调试/优化；Evals 产品下线后评估能力部分回沉到 SDK/ChatGPT）。
- **HITL**：内置机制——工具调用可声明需要人工批准（`needs_approval`），run 暂停等批准后 resume；guardrails 做输入/输出校验（可独立部署，开源 guardrails 库有 Py/JS 两版）。
- **合鸣可借鉴**：
  - **SandboxAgent 的 Manifest 思路**：合鸣的 run/作业环境可用"清单声明初始状态（仓库/文件/依赖）"的方式复现，长任务跨天不丢现场；
  - **Agent Builder 下线的教训**：合鸣做可视化编排时保持"画布只是 API 的视图"（Dify 模式），不要做成独立运行时，否则重蹈 Agent Builder 覆辙；
  - guardrails 作为**独立可部署的安全层**（mask PII / 反 jailbreak）值得合鸣插件化。

## 5. Anthropic Claude Agent SDK / MCP 生态

### 5.1 Claude Agent SDK（claude-agent-sdk）

- **现状**：Claude Code SDK 已更名 **Claude Agent SDK**（TS `@anthropic-ai/claude-agent-sdk`，Node 18+；Python 同步）。核心 API：`query()`（单次）/ `ClaudeSDKClient`（会话式）。
- **subagent 机制**（合鸣 agents 层直接对标）：
  - 三种定义方式：**程序化（`agents` 参数 AgentDefinition，官方推荐）/ 文件系统（`.claude/agents/*.md` markdown 定义）/ 内置 general-purpose**；
  - AgentDefinition 字段：`description`（何时用）、`prompt`、`tools`/`disallowedTools`（工具白/黑名单，支持 `mcp__server__*` 通配）、`model`、`skills`（预载技能）、`memory`（user/project/local 三源）、`mcpServers`、`maxTurns`、`background`（后台执行）、`effort`、`permissionMode`；
  - 设计收益四件套：**上下文隔离 / 并行化 / 专精指令 / 工具限制**；subagent 默认后台跑，可嵌套（有深度/并发/花费上限控制）；
  - `run_in_background` 默认 true（v2.1.198+ 起）——**"子任务默认异步"已成主流约定**。
- **hooks 机制**（合鸣插件/治理层直接对标）：事件驱动回调，`PreToolUse`（可 block/改输入）、`PostToolUse`（审计）、`PostToolUseFailure`、`PostToolBatch`、`UserPromptSubmit`（注入上下文）等；matcher 正则过滤工具名；回调返回 `permissionDecision: allow/deny` + reason。**典型用途：危险操作拦截、合规审计日志、输入输出变换、敏感操作强制人工批准**。
- **skills 机制**：遵循 **Agent Skills 开放标准**（SKILL.md + YAML frontmatter，跨多个 AI 工具通用），Claude Code 扩展了 invocation 控制、subagent 执行、动态上下文注入；**技能正文按需加载**（不占上下文直到被调用）——这是"长参考材料零成本"的关键设计。
- **对合鸣"作为 MCP host"的差距评估**：Claude Agent SDK 的 host 面 = 按 agent 粒度挂载 MCP server（`mcpServers` 字段）、工具级授权过滤（`mcp__server__*`）、skills 与 MCP prompts 融合（UserPromptExpansion hook 能拦 MCP prompt 展开）。合鸣若要达到同等 host 成熟度，需要：① MCP server 按 agent/组织 作用域挂载；② MCP 工具名通配授权；③ skills 可引用 MCP 资源。

### 5.2 MCP 规范（modelcontextprotocol/modelcontextprotocol）

- **规范版本线**（GitHub schema 目录核实）：2024-11-05 → 2025-03-26 → **2025-06-18** → **2025-11-25** → **2026-07-28（当前最新，2026-07-28 GA，RC 于 2026-05-29）**。Schema 以 TypeScript 定义、发布 JSON Schema。
- **2025-06-18 版要点**（OAuth 大版本）：MCP server 定性为 **OAuth Resource Server**（RFC 9728 protected resource metadata 发现 AS）；**客户端必须实现 RFC 8707 Resource Indicators**（防恶意 server 拿 token）；elicitation（server 向用户要补充信息）；structured tool output；去 JSON-RPC batching；`MCP-Protocol-Version` 头。
- **2025-11-25 版要点**：OpenID Connect Discovery 1.0 增强授权发现；**OAuth Client ID Metadata Documents（CIMD，SEP-991）成为推荐客户端注册方式**（免动态注册）；URL 模式 elicitation；sampling 支持 tool calling；**tasks 实验特性**（可轮询的持久请求）。
- **2026-07-28 版要点（host 实现者必读，破坏性大）**：
  - **彻底无状态化**：删除 `initialize` 握手与 `Mcp-Session-Id`；每个请求自带协议版本+客户端能力（`_meta` 的 `io.modelcontextprotocol/protocolVersion`/`clientCapabilities`）；list 端点不再随连接变化；跨调用状态改用 server 铸造的显式 handle（SEP-2567）；
  - 新增 `server/discover` RPC（server 声明支持的版本/能力/身份，可作 STDIO 向后兼容探测）；
  - **subscriptions/listen**：单一长连接 POST 流取代 HTTP GET 端点与 `resources/subscribe`，按类型订阅变更（toolsListChanged 等）；
  - **Multi Round-Trip Requests（MRTR，SEP-2322）取代 server 主动请求**（roots/list、sampling、elicitation）：server 返回 `InputRequiredResult`（`resultType: "input_required"`），客户端带 `inputResponses` **重试原请求**；所有结果带 `resultType`；
  - **tasks 移入官方扩展** `io.modelcontextprotocol/tasks`：轮询 `tasks/get` + `tasks/update`（客户端向 server 补输入），支持 server 主动返回 task handle——**长时 agent 任务的标准化机制**；
  - 缓存：`CacheableResult` 强制 `ttlMs`+`cacheScope`（public/private）；要求 tools/list 确定性排序（提升 LLM prompt cache 命中）；
  - 可观测性：**OpenTelemetry trace 上下文经 `_meta`（traceparent/tracestate/baggage）传播**（SEP-414）；
  - 安全：iss 参数校验（RFC 9207）、凭据绑定发行 AS（换 AS 必须重注册）、`x-mcp-header` 透传。
- **合鸣可借鉴/差距**：
  - 合鸣 MCP host 若停留在 2025-06-18 之前，需一次性对齐 2026-07-28：无状态请求、`server/discover`、MRTR 重试模式（**这与 IM 交互极配：agent 需要补充信息 = 发一条 IM 追问，用户回复 = 带 inputResponses 重试**）、tasks 扩展（长任务 = IM 里的"进行中"消息 + 轮询/推送）；
  - `ttlMs`/`cacheScope` 缓存协议可直接套用到合鸣 skills/MCP 工具的元数据下发，降低 LLM prompt 体积（呼应合鸣性能铁律"95% 成本是数据"）；
  - OTel trace context 经 `_meta` 传播——合鸣可观测层直接复用，不需要自造。

## 6. 低代码 Agent 平台：Dify / Coze / FastGPT

### 6.1 Dify（langgenius/dify）

- **版本/状态**：`1.17.0`（2026-08-25），star 154k（竞品中最高），月更节奏稳定。定位："Agentic workflows + RAG pipelines + 模型管理 + 可观测性 的一体化协作工作区，Cloud/VPC/自部署"。
- **架构**：**可视化画布 Workflow（DAG 节点图）**，节点类型：LLM / Knowledge Retrieval（RAG）/ 代码 / 条件分支 / 迭代 / 变量等；**变量环境**（环境变量可绑定整个模型配置，多节点共享，一处改处处生效）；上下文变量注入 + **自动引用溯源（citations）**；结构化输出三通道（可视化编辑器/JSON Schema/AI 生成）。
- **Agent 能力**：Function Calling 或 ReAct 两种 agent 模式 + 50+ 内置工具。
- **RAG Pipeline**：文档摄取（PDF/PPT 等）到检索的完整管线，开箱即用。
- **可观测性**：LLMOps 日志/性能监控 + 注解迭代；集成 **Opik / Langfuse / Arize Phoenix**（外接标准 OTel 系评估平台，不自造轮子）。
- **部署**：Docker Compose 一键自部署（社区版）；企业版邮件询价；BaaS 全 API 化。
- **合鸣可借鉴**：**画布 = API 视图**（所有能力同时有 API，画布可被替换）；**citations 溯源**在 IM 场景即"回复附引用来源卡片"；模型配置走环境变量而非节点硬编码。

### 6.2 Coze（字节）

- **现状**：国内头部低代码 agent 平台（Bot/Workflow/插件/知识库/数据库/调度），闭源 SaaS 为主 + 开源 Coze Studio（2025 开源自部署版）。工作流为可视化 DAG + 代码节点；插件生态（官方插件市场）；支持多 agent Bot（单 agent 编排 + 多 agent 协作两种模式）。2025-2026 重心在**插件生态与企业知识库**，未跟进 A2A（走自家协议）。本次抓取 coze.com open_docs 受限，细节以公开资料为准，**建议后续单独深挖 Coze Studio 开源版仓库**。
- **合鸣可借鉴**：插件市场 = 合鸣 skills 生态的产品化参照（上架/审核/分发/版本）。

### 6.3 FastGPT（labring/FastGPT）

- **版本/状态**：`v4.16.2`（2026-09-03），star 29.6k，周更节奏。定位："知识库优先的 LLM 应用平台：数据处理 + RAG 检索 + 可视化 AI 工作流编排"。
- **架构**：可视化工作流（DAG）+ **强 RAG**（知识库切片/检索/重排管线是其起家能力，中文文档解析强）+ 插件市场 + 渠道接入（微信/网页嵌入）。Node.js/TS 技术栈（与合鸣同栈，**代码层可参考性最高**）。
- **合鸣可借鉴**：同为 TS 栈，其 workflow 节点 DSL 的序列化/执行器实现、RAG 管线中文文档处理经验值得直接读源码（labring/FastGPT，MIT）。

## 7. SOP 型多 agent：MetaGPT / ChatDev

- **MetaGPT**（FoundationAgents/MetaGPT）：star 70k，但 **OSS 发布节奏明显放缓**（最新 release `v0.8.2` 停在 2025-03-09；仓库 push 2026-01）。核心哲学不变：`Code = SOP(Team)`——LLM 角色（PM/架构师/工程）按 SOP 流水线产出 PRD/设计/代码。2025 起主线精力转向商业产品 **MGX（mgx.dev）**（"AI agent 开发团队"，Product Hunt 周榜第一）与 **AFlow**（ICLR 2025 oral：用 MCTS 自动搜索 agent 工作流结构）。**趋势信号：SOP 型框架的学术价值（AFlow 证明了"工作流结构可自动搜索"）在沉淀，产品价值被 MGX 带走**——纯 SOP 开源框架对合鸣的直接参考价值下降。
- **ChatDev**（OpenBMB/ChatDev）：`2.0`（2026-01-07）→ `2.1.0`（2026-01-22）→ `v2.2.0`（2026-03-23），2026 上半年有恢复更新。ChatDev 2.0 主打 "Dev All through LLM-powered Multi-Agent Collaboration"（软件水瀑布多 agent 协作的 2.0 重构）。
- **合鸣可借鉴**：① AFlow 思路——合鸣的 workflows 编辑器可长期演进出"根据任务历史自动推荐 DAG 结构"；② SOP 即"预置 skills 包"：把 MetaGPT 的 SOP 理解为一组带顺序约束的 skills，与合鸣 skills 体系不冲突。

## 8. 其他值得注意的

### 8.1 Letta（MemGPT 后继）

- **重大结构变化**：**letta-ai/letta 仓库已归档为落地页**（V1 API server 源码保留在 `archive` 分支，明确"勿用于生产"）；现役代码在 **letta-ai/letta-code**（`@letta-ai/letta-code`，v0.31.12，2026-09-03，双日更节奏）。
- **letta-code 定位**："stateful agent harness——更像人而非工具的 agent"。核心机制：
  - **自我改进**：agent 通过 **memory blocks** 程序化改写自己的 system prompt/记忆（"dreaming"定时整理 `/sleeptime`、记忆质量审计 `/doctor`、记忆可视化 `/palace`）；
  - **MemFS**：全部上下文（含记忆块）用 **git 追踪**，可同步到自定义 GitHub 仓库（记忆版本化！）；
  - **Skills**：全局（`~/.letta`）/ 项目（`.agents/skills`）/ agent 级（MemFS 内）三级作用域；
  - **Subagents & Multi-agent**：内置 general-purpose/forked/recall/history-analyzer 子代理后台运行；**任何 agent 可调任何其他 agent（含自己）作 subagent**；
  - **Channels**：Slack/Telegram/Discord/自定义 IM 渠道接同一个 agent（**IM 载体路线的又一验证**）；
  - **Hooks / Permissions / Crons**：执行点挂脚本、权限模式（自动批准/拒绝清单）、心跳与 cron 自管理调度；
  - **Letta Cloud**：agent 状态（记忆/身份/对话）存云，harness 跑在任意机器（笔记本/VM/GitHub Actions/托管沙箱），`letta computers` 跨机路由。
- **合鸣可借鉴**：① **MemFS git 化**——合鸣 agent 的 memory/skills/提示词纳入 git 版本管理，"记忆可 diff/回滚"是高价值差异化；② 三级 skills 作用域（全局/项目/agent）与合鸣"组织自部署"权限模型天然匹配；③ agent 互调（agent-as-subagent 无白名单）配合合鸣的 agents 层可直接实现。

### 8.2 AgentScope 2.0（阿里）

- **版本/状态**：`v2.0.7`（2026-08-24），star 30.7k，月更。定位："生产就绪、少束缚——利用模型自身的推理/工具能力而非强加编排"。
- **与合鸣重合度最高的竞品**（IM 载体 + 多 agent + 插件化）：
  - **A2A 协议支持（2026-09，最新）**：`A2AAgent` 与任意远程 A2A agent 聊天——**A2A 被框架内置为远程通信默认件**；
  - **Pipeline（2026-08）**：固定逻辑多 agent，单一事件流驱动；
  - **Channels（2026-08）**：钉钉/飞书/Discord 等 IM 平台接入 agent service（**IM 一等公民**）；
  - **MCP & Skill Hub（2026-08）**：浏览 hub→安装到库→加入工作区；内置 GitHub MCP Registry 与 ClawHub 作为 hub（**skills/MCP 生态位争夺白热化**）；
  - ReAct agent + 实时中断/恢复 + 批处理工具调用；统一事件总线（推理/工具调用/多 agent 消息同流）；自动 compaction + 工具结果 offload 的 context 管理；K8s/OpenSandbox/Daytona 沙箱。
- **合鸣可借鉴**：① A2AAgent 模式（把远程 A2A agent 当本地 agent 同等对待）应作为合鸣"relay 互联"的标准实现路径；② 事件总线统一"推理事件 + 工具事件 + 多 agent 消息"——合鸣 IM 消息流可直接作为这条事件总线的对外投影；③ hub（MCP/skills 市场）作为产品模块。

### 8.3 Semantic Kernel

- 微软 SK 的 agent 能力已整体并入 **MAF**（官方提供 from-semantic-kernel 迁移指南）。SK 本体仍维护（2026-09-04 push）但 agent 新特性归 MAF。合鸣跟踪微软系只需盯 MAF 一个仓库。

### 8.4 2026 新动向速览

- **协议 > 框架**：MCP 无状态化 + A2A v1.0 + AGNTCY（下节）——2026 上半年的主线是"agent 互联网"基础设施，框架层反而在洗牌收缩（AutoGen 停更、Agent Builder 下线、Letta 换仓库、MetaGPT 转商业）。
- **Sandbox/工作区成为标配**：OpenAI SandboxAgent、AgentScope Daytona/K8s 沙箱、MAF hosting——长任务 agent 的"持久工作区"已是共识能力。
- **Voice/Realtime agent**：OpenAI（RealtimeAgent/VoicePipeline）与各家跟进；合鸣 IM 载体天然可承接语音消息 → agent 的链路，是差异化机会。
- **skills 标准化**：Claude 的 Agent Skills 开放标准 + CrewAI/MAF/AgentScope/Letta 全部跟进 skills 概念，skills 正成为"跨工具可移植的 agent 能力包"事实标准（详见 §9 与合鸣 skills 层对齐建议）。

## 9. A2A 协议与 agent 身份互操作（标准专节）

### 9.1 A2A（Agent2Agent）

- **治理/状态**：**Linux 基金会项目**（Google 2025-04 发起并捐赠），Apache 2.0；**v1.0 GA 2026-03-12**，v1.0.1 2026-05-28；star 25.6k；SDK 覆盖 Python/Go/JS/Java/.NET/Rust。
- **协议模型**：
  - **JSON-RPC 2.0 over HTTPS**；
  - **Agent Card**：JSON 自描述（name/description/provider、服务 url、capabilities：streaming/pushNotifications、auth schemes、**skills 列表**：AgentSkill{id,name,description,inputModes,outputModes,examples}）；
  - **发现三策略**：① well-known URI（`https://{domain}/.well-known/agent-card.json`，RFC 8615，公开 agent 推荐）；② 策展注册表（registry/marketplace，按 skill/tag 检索，**规范未规定注册表 API 标准**——生态位空缺）；③ 直接配置（私有/硬编码）；
  - **交互模式**：同步 request/response + **SSE 流式** + **异步 push notifications**（LRO 长任务）；
  - **Opaque 原则**：协作不暴露内部状态/记忆/工具——agent 以"agent"而非"tool"身份互连（与 MCP 的 tool 暴露互补，官方口径反复强调）；
  - **Task 生命周期**：submitted → working → input-required → completed/failed/canceled，支持多轮（input-required 时向调用方要补充输入——**与 MCP MRTR 同构**）。
- **路线图（官方 "What's next"）**：AgentCard 内嵌授权方案与可选凭据；`QuerySkill()` 动态技能查询；任务中动态协商 UX（中途加音视频）；客户端发起方法（超越任务管理）；流式可靠性与 push 机制增强。
- **与合鸣的映射**：合鸣 relay 互联 = A2A 的天然宿主。建议：
  1. **每个合鸣 agent 发布 Agent Card**（组织内 registry 托管，走策略②；对外走 well-known URI）；
  2. **relay 即 A2A 传输层**：A2A 的 push notification 用合鸣已部署的 ntfy 推送通道承载（relay 五份协议漂移的整合机会——用 A2A 标准信封统一）；
  3. **IM 消息 = A2A message/part 的渲染**：text/file/structured JSON 三类 part 正好映射 IM 文本/文件/卡片消息；
  4. `input-required` 状态 = IM 追问消息，用户在 IM 里回复即推进任务——**A2A 任务生命周期与 IM 对话流是 1:1 的**，这是合鸣相对所有纯协议实现的体验优势。

### 9.2 AGNTCY 与 agent 身份

- **AGNTCY**（LF Projects 旗下，"Internet of Agents" 计划）：开源栈 = **Discovery**（联邦式跨框架/跨协议/跨注册表的 agent 发现目录）+ **Communications（SLIM 协议，网络层 agent 安全通信标准）+ OASF** + **Identity**（跨组织 agent/tool 身份签发与验证）+ **Secure Runtime**（身份验证 + 门控 secrets + OS 级沙箱 + 加密本地记忆）+ **AgentBridge**（让编码 agent/CLI 走 A2A 交接上下文、委托任务）+ **Observability/Evaluation**。多语言 SDK（Go/Python/.NET/Java/Kotlin/React Native）。
- **现状判断**：方向正确（A2A 管"怎么说话"，AGNTCY 补"你是谁"+ 联邦发现），但**生态成熟度远低于 A2A/MCP**，2026 上半年以基础设施发布为主，未见头部框架深度集成（AgentScope 内置的是 A2A 而非 SLIM）。**合鸣短期不需要实现 AGNTCY，但应跟踪其 Identity 方向**——A2A 官方路线图里"AgentCard 内嵌凭据"正是身份问题的标准化入口；单组织自部署的合鸣对跨组织身份需求弱，对"组织内 agent 身份/授权"需求强（可用 mTLS + agent 证书自实现，预留 AGNTCY/A2A 身份字段即可）。
- **其他身份动向**：A2A 的 auth 走标准 OAuth2/Bearer（AgentCard 声明 schemes）；MCP 2025-11-25/2026-07-28 的 OAuth 体系（CIMD、RFC 9207 iss 校验、凭据绑定 AS）事实上确立了 **agent↔tool 调用的身份与授权基线**。合鸣作为 MCP host + A2A 节点，两套身份体系要统一到一个"agent 身份"抽象上。

### 9.3 标准格局一句话

- **MCP**：agent ↔ 工具/数据/上下文（下行，tool 粒度，无状态化后更轻量）；
- **A2A**：agent ↔ agent（平级，opaque，任务粒度，LRO）；
- **AGNTCY/身份层**：agent 是谁、去哪找（发现 + 身份，尚在早期）；
- 合鸣的"多 agent 互联定位"= **A2A 实现者 + IM 体验层**，工具面补齐 MCP 2026-07-28 对齐即可，身份面预留接口跟踪。

## 10. 编排模型对比总表

| 竞品 | 编排模型 | 状态/记忆机制 | 多 agent 通信协议 | 可观测性 | HITL 设计 | 自部署 | 2026 活跃度 |
|---|---|---|---|---|---|---|---|
| **LangGraph** | 图（Pregel 超步）+ durable execution | checkpoint（每超步落盘）+ 长期 Store；thread=状态线 | 内部事件总线；MCP 工具；wrap-sdk 吞并多框架 | LangSmith trace + Engine 根因 | interrupt 暂停/改 state/resume | 开源库全自部署；Agent Server standalone/BYOC | 高（月更，1.2.11） |
| **CrewAI** | 双轨：Crews（角色协作）+ Flows（事件驱动精确控制） | 统一 Memory：语义+时近+重要度复合打分，scope 树 | 内部 delegation（LLM 分派） | AMP 商业（tracing/metrics） | task human_input 审核 | 开源库；AMP on-prem | 高（58k★，周更） |
| **AutoGen v0.4** | **actor + topic/pub-sub**（async 事件驱动） | 会话状态（agent 内） | 内部 message；MCP workbench | 事件流自接 | 人作为 agent 参与对话 | 开源库 | **停更（maintenance，2025-09 止）** |
| **AG2 v1.0** | Network（hub + typed channels） | harness：knowledge/compaction | 内部 Network | telemetry/observers | run 暂停等人工 | 开源库 | 中（1.0.3，8 月更） |
| **Microsoft Agent Framework** | 图工作流（seq/concurrent/handoff/group） | **checkpointing + time-travel** | **官方 A2A + MCP 互操作** | **内置 OTel** | HITL + 回退重放 | 开源（Py/.NET/Go）；Foundry 托管 | 高（MAF 1.0 生产版，月更） |
| **OpenAI Agents SDK** | 轻量循环 + handoffs / agents-as-tools | Sessions（SQLite/Redis）+ **SandboxAgent 持久工作区** | MCP；无 A2A（自家 Responses/Connector Registry） | 内置 Tracing（Evals 产品将下线） | 工具调用 needs_approval | 开源库 | 高（0.22.0，月更） |
| **Claude Agent SDK** | agent loop + subagent（默认后台、可嵌套） | 会话 + memory 三源（user/project/local）；MemFS 思路（Letta） | **MCP host（按 agent 挂载、通配授权）**；无 A2A | OTel/SDK 消息流 | **hooks（PreToolUse deny）+ permission modes** | 开源 SDK（商用条款） | 高（随 Claude Code 周更） |
| **Dify** | 可视化 DAG 工作流 + Agent 节点（FC/ReAct） | 工作流变量 + 知识库（RAG） | 内部节点连边；BaaS API | 内置 LLMOps + Opik/Langfuse 集成 | 人工审核节点/聊天干预 | Docker Compose 一键 | 高（1.17.0，154k★） |
| **Coze** | 可视化 DAG + 多 agent Bot | 知识库 + 数据库 + 变量 | 内部；无 A2A | 平台内置 | 人工节点 | Coze Studio 开源自部署 | 高（闭源 SaaS 主导） |
| **FastGPT** | 可视化 DAG（强 RAG） | 知识库（中文文档强） | 内部 | 平台内置 | 聊天干预 | 开源自部署（TS 栈） | 高（v4.16.2，周更） |
| **MetaGPT** | **SOP 流水线**（角色按 SOP 产出制品） | 共享消息池 + 角色记忆 | 内部 publish-subscribe | 研究向 | 人工介入角色 | 开源库 | **低（OSS 停更，转 MGX 商业）** |
| **ChatDev** | 软件水瀑布 phase 化多 agent | 角色工作区 | 内部对话 | 研究向 | 人工评审 phase | 开源库 | 中（v2.2.0，3 月止） |
| **Letta (letta-code)** | agent harness（长时状态人格） | **memory blocks 自改写 + MemFS git 化 + 云端状态** | subagent 互调；channels（IM）；Letta Cloud 跨机 | 内置（/doctor 审计） | 权限模式 + hooks | npm 全局 + Letta Cloud | 高（v0.31.x，双日更） |
| **AgentScope 2.0** | ReAct + Pipeline + 统一事件总线 | context 自动 compaction + offload | **内置 A2A（A2AAgent）**；MCP & Skill Hub | 事件总线可视化 | 实时中断/恢复 | 开源库 + 渠道部署（K8s 沙箱） | 高（v2.0.7，月更） |

## 11. 合鸣差距映射（机制级，按优先级）

> 合鸣现状锚点：agents/tasks/runs/jobs/workflows/memory/skills/MCP/providers 层已存在；IM 为载体；relay 互联 + ntfy 推送已落地；Node/TS 单栈；单组织自部署定位。

### P0（直接决定"多 agent 互联"定位成败）

1. **A2A v1.0 节点能力**（目前缺失）：
   - 每个 agent 生成/发布 **Agent Card**（含 skills 列表、inputModes/outputModes）；组织内走 registry 发现，对外 `/.well-known/agent-card.json`；
   - relay 消息信封对齐 A2A Task 生命周期（submitted/working/**input-required**/completed/failed/canceled）+ JSON-RPC 2.0 + SSE 流式 + ntfy 承载 push notification；
   - 实现 **remote agent 当本地 agent 用**（AgentScope `A2AAgent` 模式），先支持"合鸣 agent ↔ 任意 A2A server"单向互连，再双向。
2. **MCP host 对齐 2026-07-28**（目前大概率停留在早期版本）：无状态请求（每请求带版本+能力 `_meta`）、`server/discover`、MRTR（`input_required` 结果 + 带 `inputResponses` 重试——**直接映射 IM 追问交互**）、`subscriptions/listen` 单流订阅、`ttlMs`/`cacheScope` 缓存（工具元数据下发省 token）、`io.modelcontextprotocol/tasks` 扩展（长任务）、OTel trace context 经 `_meta` 传播。
3. **durable execution**（目前 runs 是否有 checkpoint 恢复待确认）：run 步骤级 checkpoint 落盘 + 崩溃恢复不重放 LLM 调用；对照 LangGraph 的 assistants/threads/runs 资源模型，把"会话=可恢复状态线"显式化。

### P1（差异化竞争力）

4. **HITL 标准化三件套**：agent 状态机增加 `awaiting_human` 态；渲染为 IM 待确认卡片（含 allow/deny/修改输入三选项）；对应 Claude hooks 的 PreToolUse-deny 语义 + LangGraph interrupt 语义。敏感操作（写库/花钱/对外发消息）默认走此路径。
5. **skills 生态对齐开放标准**：合鸣 skills 若尚未采用 SKILL.md（Agent Skills 开放标准，frontmatter+按需加载正文），建议对齐——CrewAI/MAF/AgentScope/Letta 都在抢这个生态位；补三级作用域（组织/工作区/agent，Letta 模式）+ skills 可预载进 subagent（Claude AgentDefinition.skills 字段）。
6. **subagent 机制升级**：合鸣 agents 层支持"agent 调 agent"（AgentTool/agents-as-tools 语义）+ **默认后台异步 + 仅回传最终结果**（上下文隔离，Claude subagent 四收益：隔离/并行/专精/工具限制）+ 嵌套深度/并发上限。
7. **记忆层升级**：
   - 检索复合打分（语义+时近+重要度权重可调，CrewAI Memory 模式）；
   - scope 路径树（`/org/agent/...`，整支可删）；
   - **记忆 git 版本化**（Letta MemFS：记忆/提示词/skills 可 diff、可回滚、可同步）——合鸣单组织自部署场景下"agent 记忆可审计"是高价值卖点。

### P2（中长期卡位）

8. **可观测性 OTel 化**：runs/jobs 事件映射 OTel spans（MAF/OpenAI/MAF 全部 OTel 原生；Dify 外接 Langfuse/Opik）；不自造 trace 格式。
9. **workflow 画布保持"API 的视图"**（Dify 模式，反 Agent Builder 覆辙）：画布序列化 = workflows 数据模型，代码与画布等价可互转；长期演进 AFlow 式"按历史任务推荐 DAG"。
10. **agent 身份预留**：单组织内用 mTLS + agent 证书实现身份/授权；Agent Card 预留 credentials 字段（A2A 路线图）；跟踪 AGNTCY Identity 但**不提前实现**。
11. **语音链路**：IM 语音消息 → agent（OpenAI Realtime/VoicePipeline 验证了该链路；合鸣 IM 载体天然具备入口）。
12. **sandbox/工作区**：长任务 run 绑定持久工作区（Manifest 声明初始状态，OpenAI SandboxAgent 模式）；合鸣 providers/作业体系可扩展为"带工作区的作业"。

### 明确不跟的

- 纯低代码画布运行时（Agent Builder 2026-11-30 下线是原厂证伪）；
- SOP 型框架（MetaGPT 停更转商业，学术价值用 AFlow 思路吸收即可）；
- AGNTCY SLIM 协议实现（早期，A2A+MCP 足够）；
- 跨组织 agent 身份联邦（与单组织自部署定位不符，预留接口即可）。

---

## Sources

- LangGraph README（raw.githubusercontent.com/langchain-ai/langgraph/main/README.md）；LangGraph releases API（1.2.11 / sdk 0.4.4 / checkpoint 4.2.0）；LangSmith Deployment 文档（docs.langchain.com/langsmith/deployments）
- CrewAI README（crewAIInc/crewAI）；CrewAI Memory 文档（docs.crewai.com/en/concepts/memory）；CrewAI AMP（README 内链接 crewai.com/amp）
- AutoGen README（microsoft/autogen，Maintenance Mode 声明 + MAF 迁移指引）；AutoGen releases API（v0.7.5 止）
- AG2 README（ag2ai/ag2，v1.0 Network/hub+channels 架构）；AG2 releases（v1.0.3）
- Microsoft Agent Framework README（microsoft/agent-framework：图工作流/checkpointing/time-travel/A2A+MCP/OTel/Declarative Agents/Skills）；releases（python-1.17.0 / dotnet-1.20.0）
- OpenAI Agents SDK README（openai/openai-agents-python：handoffs/guardrails/sessions/tracing/SandboxAgent/RealtimeAgent）；releases（v0.22.0）；OpenAI AgentKit 公告（openai.com/index/introducing-agentkit/，含 2026-06-03 Agent Builder/Evals 下线更新）
- Claude Agent SDK TS README（anthropics/claude-agent-sdk-typescript）；Subagents 文档（docs.claude.com/en/api/agent-sdk/subagents，AgentDefinition 全字段）；Hooks 文档（docs.claude.com/en/api/agent-sdk/hooks）；Skills 文档（docs.claude.com/en/docs/claude-code/skills，Agent Skills 开放标准）
- MCP 规范仓库（modelcontextprotocol/modelcontextprotocol）schema 版本目录；changelog 2025-06-18（modelcontextprotocol.io/specification/2025-06-18/changelog）；changelog 2025-11-25；changelog 2026-07-28（无状态化/MRTR/tasks 扩展/缓存/OTel）
- A2A（a2aproject/A2A，Linux 基金会）README + specification（a2a-protocol.org）：Agent Card、well-known 发现、SSE/push、Task 生命周期、"What's next" 路线图；releases（v1.0.0 2026-03-12 / v1.0.1）
- AGNTCY 官网（agntcy.org：Discovery/SLIM/OASF/Identity/Secure Runtime/AgentBridge）
- Dify README + workflow LLM 节点文档（docs.dify.ai）；releases（1.17.0）
- FastGPT 仓库元数据与定位（labring/FastGPT）；releases（v4.16.2）
- Coze 官方文档入口（coze.com/open_docs，抓取受限，标注待深挖）
- MetaGPT README（MGX/AFlow 动向）；releases（v0.8.2 止）；ChatDev releases（2.0/2.1/2.2.0）
- Letta README（letta-ai/letta 归档说明）+ letta-code README（letta-ai/letta-code：memory blocks/MemFS/skills/subagents/channels/hooks/crons/remote computers）；releases（v0.31.12）
- AgentScope 2.0 README（agentscope-ai/agentscope：A2A/Pipeline/Channels/MCP&Skill Hub 新闻）；releases（v2.0.7）
