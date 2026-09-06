# 「多 Agent 协同 + IM 融合」竞品与技术调研报告

> 面向 **合鸣（Ensemble）** 项目 · 调研日期 2026-09-05
> 合鸣定位：IM 聊天为载体 + 多 agent 协作编排 + 插件系统 + 自部署，让团队在一个聊天软件里编排多个 AI agent 干活。
> 方法：联网抓取官方 docs / 博客 / 论文（arXiv API）。部分站点（docs.discord.com、aily.feishu.cn、botpress.com）被 Cloudflare/JS 壳拦截，相关结论标注「据公开产品知识，未直连验证」。

---

## 0. TL;DR（最关键的 6 个发现）

1. **「Agent ≠ Bot ≠ Workflow ≠ Assistant」已成行业共识词表**（Slack 官方明确定义）。合鸣需要一个等价的「智能体类型学」，把「能自主多步 + 用工具 + 有记忆 + 有边界」写进产品语义，而不是所有 agent 都叫"机器人"。
2. **A2A 协议已到 1.0.0 并移交 Linux 基金会**（Google 主导，2025-2026）。它给出了 agent 互操作的**标准任务状态机**（8 态：submitted/working/completed/failed/canceled/rejected + 两个**人类介入态 input_required / auth_required**）+ 流式(SSE)+ Webhook 推送。**这是合鸣「长任务进度 IM 化呈现」可直接对齐的骨架。**
3. **长任务的「人机交接」被三家独立收敛到同一套设计**：GitHub cloud agent（原 Copilot coding agent，2026 改名）= 置信度分级 + 低置信变更**挂起等人工 review**；Cursor Cloud Agents = 从 Slack/iOS/Web 启动 + 隔离 VM 长跑 + 回 PR；Factory Droid = App/CLI/Web/Mobile 多面 + Droid Computers。**共性：任务在后台跑，人在 IM/移动端收「进度 + 需确认」的推送，而非盯着 IDE。**
4. **Copilot Studio 在 2026 把 agent 分成「三种 harness」**（GitHub Copilot harness = 重推理多步 + 文件原生；standard = 规则可预测；chat = 扩展 M365 Copilot Chat），且 agent 可**互相 handoff**、调用 workflows / connectors / **MCP**。说明"编排多 agent + 混合自主度"已是旗舰产品形态。
5. **学术前沿出现「组织科学」派**：IMACS 把「谁在团队(organization) / 怎么对齐(coordination) / 用哪个融合算法(collaboration protocol)」拆成**三个正交、可独立替换的层**，把 Belbin 角色、Mintzberg 协调、RACI 问责做成**可执行可验证的配置**，并用 contextual-bandit 自适应路由协议。**这几乎就是合鸣「团队权限体系(见 org-permission-design)」的学术版答案——组织设计不能硬编码，要按模型/任务可配置、可学习。**
6. **开源新物种 LangBot（2025-2026，1.7w+ star）与合鸣定位高度重叠**：开源、生产级、**Agent + 知识库编排 + 插件系统 + MCP**，一个代码库打通 Discord/Telegram/Slack/QQ/微信/企业微信/飞书/钉钉/Matrix（Matrix 还能桥 Signal/WhatsApp/iMessage/Zulip 等）。它是**"把 agent 塞进 IM"这条赛道最直接的对标与潜在合作/借鉴对象**——但它是「单 agent 多平台分发」，**没有合鸣的"多 agent 编排 + 自部署 IM 本体"**，这恰是合鸣的差异化护城河。

**合鸣的机会点（一句话）**：把「A2A 的任务状态机 + input_required 人审门」作为**消息/卡片一等公民**，用「组织科学正交分层」做多 agent 分工，把合鸣自己的 IM（而非寄生在 Slack/Discord 里）作为 agent 协作的**原生主场**——这是 LangBot 们做不了（寄生在别家 IM）、大厂做不到（不可自部署）的空档。

---

## 1. IM×Agent 融合模式分类学（Taxonomy）

在逐产品分析前，先给出一个可复用的分类框架，后文所有产品都落进这个格子。

### 1.1 五个维度

| 维度 | 取值谱系 | 说明 |
|---|---|---|
| **A. 存在形式**（agent 以什么身份活在 IM 里） | ①独立账号/成员 ②频道/群机器人 ③@提及召唤的幽灵 ④内嵌卡片里的动作 ⑤跨多面（IM+Web+IDE）同体 | 决定"它看起来是不是个人" |
| **B. 触发机制** | ①@提及/mention ②关键词/意图 ③事件驱动（webhook：新 issue、定时）④主动轮询 ⑤被别的 agent handoff 唤起 | 决定"谁让它动起来" |
| **C. 状态呈现**（长任务怎么显示进度） | ①一次性回复 ②流式逐字 ③线程内追加多消息 ④**卡片原地更新**（edit message）⑤独立状态面板 + IM 通知 | 决定"人如何不盯屏也知道进展" |
| **D. 人机交接 / 人审门** | ①无 ②完成后通知 ③**关键动作前挂起等确认**(human-in-the-loop) ④置信度分级+低置信自动挂起 ⑤可中断/可纠偏/可接管 | 决定"信任与责任如何分配" |
| **E. 多 agent 组织** | ①单 agent ②固定流水线(角色硬编码) ③动态编排(编排者运行时选) ④群聊共识 ⑤分层委派(父任务拆子任务) | 决定"分工机制" |

### 1.2 三类融合范式（由浅入深）

- **范式 I · 寄生型（IM 是别人的，agent 是插件）**：LangBot、各类 matrix+LLM bot、Discord bot 生态。agent 寄生在 Slack/Discord/微信里，**IM 本体不归你**。优点：借现成用户/网络效应；缺点：受制于别家 IM 的卡片/权限/计费 API，**无法做"多 agent 编排的原生主场"**。
- **范式 II · 编排面板型（IM 是协作面，agent 在后台）**：GitHub cloud agent、Cursor Cloud、Factory Droid、Devin。IM（Slack/移动端）只是**遥控 + 汇报面**，真正执行在隔离 VM/沙箱。**这是"任务进度的 IM 化呈现"设计最成熟的地方。**
- **范式 III · 原生主场型（IM 本身 = agent 编排画布）**：合鸣的目标形态。IM 不只是汇报面，**agent 就是群成员、线程就是任务、@就是派工、卡片就是交接物**。**目前市面上没有一家把"多 agent 编排"做成"IM 本体的一等公民"**——这是空白区。

> 合鸣 = 用范式 III 的野心，吃范式 II 的成熟机制（状态机/人审/多面），参考范式 I 的生态位（别家 IM 的 API 能力清单）。

---

## 2. 方向一：IM 内嵌 Agent 的产品

### 2.1 Slack —— Agentforce / Agents in Slack（最完整的官方 agent 语义）

**核心设计（agent 在 IM 中的存在形式 / 触发 / 状态呈现）**
- Slack 官方把 **agent 定义为"在既定边界内部分自主、目标导向、会用工具、有记忆"的系统**，并**明确区分 agent 与 bot / workflow / assistant**：
  - *Bot*：固定输入→输出，无推理/记忆/适应；
  - *Workflow*：非 AI 的、可重复触发执行的步骤序列；
  - *Assistant*：会对话、会理解、会推理，但**不能自主决定下一步**；
  - *Agent*：以上全部 + **能在无人逐步提示时决定"下一步做什么"**，并在**越权时暂停向人求确认而非硬猜**。
- **四层记忆模型**（直接可抄进合鸣的 agent 语义文档）：in-context（当前 prompt 窗）/ short-term（本任务线程内）/ long-term（跨会话持久到 workspace）/ **shared memory（多 agent 系统里其他 agent 可访问的共享状态）**。
- **交互基底**：Block Kit（卡片/组件）+ 上下文感知 + **多面编排（multi-surface orchestration）** + 内建身份与权限。
- **典型用例**（Slack 官方列举）：channel expert（频道级专家，就地答疑）、service agent（替代传统客服 bot）、SDR（7×24 销售开发代表）、Sales Coach（角色扮演陪练）、Merchandiser、Campaign Optimizer。

**长任务管理（进度 / 中断 / 交接）**
- 核心原则"**人始终感觉掌控体验**"：**agent 的每个动作和决策都要可被用户看到**；**任何有真实世界输出的动作（发邮件、审批、改记录）必须显式人工确认**；"为失败而设计"（agent 会错会幻觉，要有清晰方式理解发生了什么并继续工作）。
- 分布方式：internal（公司内部）或 **Slack Marketplace**（跨组织分发）——agent 可以像 app 一样上架市场。

**多 agent 分工**
- Slack 文档明确工具里有一种是 **"Agent tools: invoke another agent"**（调用另一个 agent）——即 agent 可被当作"工具"由另一个 agent 调用，这是**分层委派**的官方背书。
- Slack AI 的 "Today"（智能简报）+ 频道/线程摘要 + 跨源企业搜索，是 agent 的**"信息聚合"底座**（agent 干活前先聚合上下文）。

**合鸣可借鉴点（机制级）**
1. **抄「agent vs bot vs workflow vs assistant」四象限**，落成合鸣的"智能体类型"标签（自部署场景下用户更需要理解"这个 agent 到底能自主到什么程度"）。
2. **抄四层记忆模型**，尤其 **shared memory**——这是合鸣"多 agent 在同一 IM 里协作"的记忆基础设施，应作为消息/频道级的一等存储。
3. **抄"越权暂停 + 真实动作必确认"原则**，直接映射到合鸣的卡片按钮（见 5.2）。
4. **agent-as-tool（调用另一个 agent）** 作为合鸣多 agent 编排的原语之一。
5. **Marketplace 思路** → 合鸣插件系统已有生态位，可对齐"agent 可上架/分发"。

### 2.2 Microsoft Teams / M365 —— Copilot Studio Agents（"三种 harness" + handoff）

**核心设计**（官方 agents-overview，**Last updated 2026-08-03**，非常新）
- **Agent = 理解业务上下文、代你行动的 AI 助手**。2026 年的关键架构变化：**agent 构建在"三种 harness"之一上**：
  - **GitHub Copilot harness**：重推理、多步业务流程；把复杂目标**拆步、遇错恢复、随情况自适应**；**原生支持 skills 与 memory，跑在安全沙箱**；**能原生创建/编辑/推理 Word/Excel/PPT/PDF**；按 Copilot Credits 计费。适合复杂流程（应付账款、合同审查、招聘）、文件密集型、多工具编排。
  - **standard harness**：规则型、可预测；遵循你定义的 topics/rules；适合 help-desk、信息查询、结构化对话。
  - **Copilot chat harness**：扩展 M365 Copilot Chat，接企业知识；知识优先场景（onboarding、政策 FAQ）。
- **agent 可以 handoff 给其他 agent、调用 workflows、通过 connectors / REST API / MCP servers 接业务系统**，并**多渠道部署（Teams、Web、企业应用）**。

**长任务管理 / 人机交接**
- GitHub Copilot harness 的"遇错恢复 + 自适应"= 长任务韧性；MCP 集成 = 长任务的工具面。
- **合鸣可借鉴**：把"三种 harness"抽象为合鸣 agent 的**三档自主度/能力档**（推理型沙箱 agent / 规则型 / 知识问答型），让用户在"同一个 IM"里按需派不同档位的 agent，且**MCP 作为统一的工具接入面**（合鸣插件系统可直接吃 MCP）。

### 2.3 Discord —— Bot 生态与 Activities（据公开产品知识，docs.discord.com 被 CF 拦截，未直连验证）

**核心设计**
- Discord 的 agent 载体是**应用(App)+ 机器人(Bot)**，交互靠 **Interactions**（slash 命令、button、select menu 等**组件/卡片**）、**线程(thread)** 做任务隔离、**Activities** 作为**嵌入式表面**（把交互塞进频道/语音旁的小面板，而非纯消息流）。
- 触发以 **@提及 / 命令 / 事件(webhook)** 为主；**Activity 是"内嵌卡片里的动作"这一存在形式的典型**（范式 A.④）。

**长任务 / 多 agent**
- Discord 本身不提供 agent 编排，靠第三方（见 LangBot 的 "Customer Service Discord Bot with Agentic RAG"）把 LLM/agent 塞进来；**长任务多靠"thread 内追加消息 + 卡片按钮"呈现**。
- **合鸣可借鉴**：**Activity（嵌入式表面）** 这个形态值得抄——合鸣在移动端/Web 端给 agent 开一个"任务侧栏/小组件"，比纯聊天流更适合呈现长任务，与 2.2 的"多面"呼应。

### 2.4 飞书 智能伙伴 / aily（aily.feishu.cn 为 JS 壳，未取到正文，据公开产品知识）

**核心设计**
- **aily（飞书智能伙伴）**：面向企业的"智能伙伴搭建平台"，可构建**对话式智能体（chatbot 形态）+ 可挂接知识/流程/API**，发布到飞书群/单聊，也支持**"应用/插件"形态嵌入飞书各工作流**；强调**低代码 + 知识库 + 流程编排**，与合鸣"团队自部署"最像的是**面向国内企业、中文语境、重落地**。
- **合鸣可借鉴**：aily 的"中文企业落地 + 低代码搭建 + 知识库"组合，验证了合鸣"自部署 IM 里搭 agent"的国内市场需求；**合鸣差异化在于：自部署数据主权 + 多 agent 编排（aily 偏单智能体搭建）**。

---

## 3. 方向二：Agent 团队协作产品（多 agent 分工 / 讨论 / 共识）

### 3.1 MetaGPT —— 软件公司即多 Agent 系统（SOP 驱动分工）

- **核心机制：`Code = SOP(Team)`**——把"标准作业流程(SOP)"物化并施加到由 LLM 角色组成的团队上。输入一行需求，内部由**产品经理 / 架构师 / 项目经理 / 工程师**分工，输出用户故事/竞品分析/需求/数据结构/API/文档。
- 分工是**角色硬编码 + SOP 流水线**（范式 E.②），是"公司化模拟"的教科书实现。
- **2026 现状**：已推出 **MGX (MetaGPT X, mgx.dev)**（2025-02 上线，PH 周榜第一）= "world's first AI agent development team"，是 MetaGPT 的产品化。另有 SPO、AOT（AOT=Tree of Thoughts 类规划）、**AFlow（ICLR 2025 oral，自动优化 agent 工作流）**等论文。
- **合鸣可借鉴**：**SOP 即"团队配置"** 的思想——合鸣的"团队权限体系/部门树"可以承载一套"SOP 模板"（比如"新功能交付 SOP = 需求→架构→编码→测试→review 五个角色 agent 依次接力"），把分工从"写死在 prompt"升级为**"可配置的团队剧本"**。

### 3.2 ChatDev —— 从"虚拟软件公司"进化到"零代码多 Agent 编排平台"（2026-01 发布 2.0）

- **ChatDev 1.0（legacy，chatdev1.0 分支）**：**虚拟软件公司**——CEO/CTO/Programmer 等 agent 参与**专业功能研讨会(functional seminar)**，自动跑完设计→编码→测试→文档全生命周期，是"communicative agent collaboration"（以**对话/讨论**为协作载体的协作范式）的奠基者。**"研讨会"= 群聊共识机制（范式 E.④）的原型。**
- **ChatDev 2.0 (DevAll, 2026-01-07 发布)**：进化为**零代码多 Agent 编排平台**，用户通过简单配置（无需编码）定义 agent、workflow、task，编排数据可视化、3D 生成、深度研究等复杂场景。
- **学术亮点**：**Puppeteer 范式**（2025-05，NeurIPS 2025 接收）：用一个**可学习的中央编排者(puppeteer，用 RL 优化)**动态决定**激活哪些 agent、按什么顺序**，构造协作——这是"动态编排（范式 E.③）"的代表。
- **合鸣可借鉴**：
  1. **ChatDev 2.0 的"零代码编排 UI"验证了合鸣"在 IM 里用自然语言/简单配置编排多 agent"的产品直觉**——合鸣的 IM 对话流本身就是最自然的"零代码编排 UI"。
  2. **Puppeteer 中央编排者** = 合鸣"编排者 agent / 团队 leader agent"的学术背书，且指向**编排策略可学习（RL）**这条长期路线。

### 3.3 CAMEL —— Role-Playing 与"找 agent 的 scaling law"

- **核心机制：两个 agent 扮演「AI User + AI Assistant」**，通过**结构化的 role-playing 协议**（inception prompting）协作完成任务；是**第一个 LLM 多 agent 框架**，社区使命是"**研究 agent 的 scaling law（规模化规律）**"。
- 2026 现状：扩展到多 agent 社会（societies）、Workforce、Agentic RAG（含 **Discord customer-service bot** 教程）、动态知识图谱角色协作等。
- **合鸣可借鉴**：**"AI User（提问者/需求方）+ AI Assistant（执行者）"双角色** 是合鸣"人派 agent"的一个优雅抽象——合鸣里"人"可以被视为隐式的 AI User 角色，**"发起任务的措辞质量直接决定 agent 产出"**，这应成为合鸣"派工 UX"的设计输入。

### 3.4 AutoGen（Microsoft）—— Group Chat / Teams 的现代实现（工程上最完整）

**核心机制（团队 = 多 agent 协作的运行时）**
- **四种 team preset（直接可抄成合鸣的"协作模式"开关）**：
  - **RoundRobinGroupChat**：轮流发言，共享上下文（最基础）；
  - **SelectorGroupChat**：**每条消息后用 LLM 选下一个发言人**（动态路由）；
  - **MagenticOneGroupChat**：面向开放网页/文件任务的通用多 agent 系统（带**外层编排者 orchestrator**管理 ledger/计划）；
  - **Swarm**：用 **HandoffMessage 信号 agent 之间的交接**（范式 D/E 的 handoff 原语）。
- **反思(reflection)模式**：primary + critic 两 agent 互评；官方明说"**简单任务先用单 agent，单 agent 不够再上 team**"（工程纪律）。
- 底层 **Core = 事件驱动、可分布式（gRPC worker runtime）多 agent 框架**；AgentChat = 其上的人/agent 对话层；**MCP Workbench** 接入 MCP。
- **合鸣可借鉴**：
  1. **四种 team preset → 合鸣"群协作模式"**：一个群里可切换"轮流 / 智能选人 / 编排者主导 / 交接接力"。
  2. **HandoffMessage** → 合鸣消息里加一个"交接给 @某 agent"的结构化事件（与 2.1 Slack 的 agent-as-tool 对齐）。
  3. **MagenticOne 的 ledger（显式任务台账）** → 合鸣"任务卡片"应显式记录**计划/已完成/下一步**，这正是"长任务进度 IM 化"的数据模型。
  4. **"先单 agent 后 team"** 的纪律写进合鸣的默认体验。

---

## 4. 方向三：人机混合协作流（长时任务如何向人汇报 / 请求确认 / 交接）

> 这一方向是"任务进度 IM 化呈现"设计的**最成熟样本区**，是合鸣最该细抄的地方。

### 4.1 GitHub Copilot cloud agent（原 Copilot coding agent，2026 改名——重要信号）

**核心设计**
- **能力**：copilot 可**研究仓库 → 创建实现计划 → 在分支上改代码**；人 **review diff → 迭代 → 满意再开 PR**。
- **agent management（集中管控页）**：一个中心页面**在多个 agent 会话间跳转、查进度、不失位**——这是"多长任务并行时人的指挥台"。
- **Custom agents**：按需定制 agent。
- **Copilot automations**：可**定时或按仓库事件自动触发** cloud agent（范式 B.③ 事件驱动）。
- **关键创新——"rationale, confidence, and approvals for issues"**：自动化 triage 时，agent **解释每处改动 + 给置信度打分 + 把低置信度的改动挂起等你 review**（范式 D.④ 置信度分级 + 自动挂起）。
- **MCP** 集成 + 面向 Enterprise/Business 的**访问策略/按仓库禁用**（治理）。

**长任务汇报 / 确认 / 交接（机制级，合鸣直接抄）**
- **汇报**：任务在后台跑，人从**集中管控页 / PR 通知**收结果（而非盯 IDE）；
- **确认**：**置信度 < 阈值 → 自动 hold，不合并**，推给人审；高置信 → 直接进 PR；
- **交接**：产物是**分支 + diff + PR**，人"接管"就是 review/merge，**责任边界清晰（agent 出 diff，人负责合并）**。

### 4.2 Cursor Cloud Agents（从 IM/移动端启动长任务的最佳样本）

**核心设计**
- **Cloud agent = 用同样的 agent 内核，但跑在云端隔离 VM**（clone 好的仓库、装好的依赖、secrets、启动命令、网络）→ **能构建、测试、与改后的软件交互，甚至控制桌面/浏览器**；支持 **MCP**；支持**多仓库环境**（前后端/基础设施/共享库跨仓协调改动、在改动的仓库里开 PR）。
- **可并行跑任意多个 agent，不依赖本地机器在线**。
- **启动面（关键！范式 A.⑤ 跨多面同体）**：
  - **Cursor for iOS**（手机 App 里启动/管理 agent）
  - **Cursor Web**（cursor.com/agents，任意设备）
  - **Cursor Desktop**（输入框下拉选 "Cloud"）
  - **Slack**（**直接从 Slack 启动/管理 cloud agent** ← 这就是"IM 化遥控长任务"的活案例）
- **builds / automations / self-hosted runtime** 等周边能力。

**合鸣可借鉴（机制级）**
- **合鸣移动端 = Cursor iOS 的角色**：手机上收到"agent 在跑"的推送 → 点开看进度 → 批准/纠偏/接管。这是"任务进度的 IM 化呈现"的**移动端闭环**。
- **"从 Slack 启动 agent"** 印证：IM 是长任务的**最佳启动面**（人在哪，就从哪派工）——合鸣天然成立，因为**合鸣自己就是 IM**。
- **隔离 VM + 多仓库** → 合鸣 agent 沙箱应支持"跨多个代码仓库的协调改动 + 按仓库出 PR/diff"。

### 4.3 Factory.ai / Droid（"自主性堆栈" + 全 SDLC 自动化）

**核心设计**
- 定位 **"The Autonomy Stack for Enterprise Teams"**（企业自主性堆栈）；**Droid 全端一致**：Factory App / Droid CLI / **Web & Mobile** / headless exec；**Droid Computers** = 云端会话同步，浏览器随处可达（app.factory.ai）。
- **三条价值路径**：①Ship Code Faster（派任务→review diff→从 App 或终端 merge）；②**Automate the Full SDLC**（把 code review / QA / 文档全自动跨仓库跑）；③Plan an Enterprise Rollout（部署/安全/治理/可观测）。
- **合鸣可借鉴**：**"企业治理面（部署/安全/治理/可观测）"** 是合鸣"自部署 + 团队权限体系"的**商业化必备面**——合鸣不能只有"好玩"，要有**agent 行为的治理/审计/可观测**（谁派了哪个 agent、agent 做了什么、花了多少、结果如何）。

### 4.4 Devin（Cognition）—— 长时自主 + 主动协作

**核心设计**
- "**不知疲倦的熟练队友**"，可**陪你一起构建，也可独立完成任务供你 review**。
- **长时推理与规划**：能规划/执行**需要上千个决策**的复杂工程任务；**每步召回相关上下文、随时间学习、自我纠错**。
- **沙箱内齐备开发工具**（shell / 编辑器 / 浏览器）；**"主动与人协作：实时汇报进度、接受反馈、按需与人一起敲定设计选择"**（范式 D.⑤ 可中断/可纠偏/可接管）。
- **合鸣可借鉴**：**"实时汇报进度 + 接受反馈 + 共同决策"** 三件套 = 合鸣 agent 卡片应有的三态交互（**进度流 / 反馈入口 / 决策点**）。

### 4.5 四家共性提炼（合鸣"长任务 IM 化"设计蓝图）

| 机制 | GitHub cloud agent | Cursor Cloud | Factory Droid | Devin | **合鸣落地建议** |
|---|---|---|---|---|---|
| 后台隔离执行 | 分支 | 隔离 VM | Droid Computers | 沙箱 | agent 沙箱 + 任务工作区 |
| 从哪启动 | PR/issue/自动化 | **iOS/Web/Desktop/Slack** | App/CLI/Web/Mobile | 平台 | **合鸣移动端 + IM 内派工** |
| 进度呈现 | 管控页 + PR 通知 | 会话同步 + 通知 | 云端会话 | **实时汇报** | **任务卡片原地更新 + IM 推送** |
| 人审门 | **置信度分级 + 低置信挂起** | review/merge | review/merge | 接受反馈 | **卡片按钮：批准/驳回/追问** |
| 交接物 | diff/PR | PR | diff/PR | 代码/部署 | **diff/文档/PR 卡片** |
| 多任务指挥 | 集中管控页 | 并行多 agent | 多会话 | — | **合鸣"任务频道/看板"** |

> **结论**：长任务 IM 化的黄金三角 = **①隔离后台执行 + ②IM/移动端收"进度+人审"推送 + ③产物以可 review 的卡片/diff 交接**。合鸣把 IM 本体做成①②③的载体，即形成差异化。

---

## 5. 方向四：开源新物种（2025-2026 出现的 IM+Agent 融合开源项目）

### 5.1 LangBot（**最直接对标，重点分析**，2025-2026，~1.7w+ star）

**核心设计**
- 定位：**"生产级多平台 agentic IM bot 平台"**，开源；**一个代码库**打通 Discord / Telegram / Slack / LINE / QQ / 微信 / 企业微信 / 飞书(Lark) / 钉钉 / KOOK / **Matrix（并可桥接 Signal、WhatsApp、Messenger、iMessage、Mattermost、Google Chat、IRC、XMPP、Zulip 等）**。
- **能力**：多轮对话、**tool calling**、多模态、**流式输出**、**内建 RAG 知识库**、深度对接 Dify/Coze/n8n/Langflow/Deerflow/Weknora。
- **生产级**：访问控制、限流、敏感词过滤、监控、异常处理。
- **插件生态**：数百插件、**事件驱动架构**、**MCP 协议支持**、Web 管理面板（无需改 YAML）。
- **多流水线架构**（不同 bot 不同场景 + 监控）。
- 部署：`uvx langbot` 一行 / Docker / **LangBot Cloud（零部署）** / K8s。

**长任务 / 多 agent / 分工**
- **单 agent 多平台分发**为主，**不是**"多 agent 编排"——它解决的是"一个 agent 铺到所有 IM"，而**不是**"多个 agent 在一个 IM 里协作"。
- 但通过对接 **Dify/n8n/Coze** 等编排平台，间接获得了多 agent 编排能力（把编排外包）。

**与合鸣的对照（关键差异化）**

| 能力 | LangBot | 合鸣 |
|---|---|---|
| IM 本体 | 寄生在别家 IM（Discord/Slack/微信…） | **自研自部署 IM 本体** |
| 多 agent 编排 | 无（外包给 Dify/n8n） | **核心卖点** |
| 插件系统 | 有（事件驱动 + MCP） | 有（含 MCP，见 2.2 建议对齐） |
| 数据主权 | 弱（agent 跑在别家 IM 上，消息经别家服务器） | **强（自部署，E2EE 差异化）** |
| 知识库/RAG | 有（内建 + 对接） | 待补强（**应补**） |
| 生产级治理 | 有（访问控制/限流/敏感词/监控） | 待补强（**应抄**） |
| 移动端 | 依赖宿主 IM 的 App | **自研移动端** |

**合鸣机会点**：
1. **LangBot 验证了"IM+Agent"赛道的开源需求真实存在且热（1.7w+ star）**——合鸣方向正确。
2. **合鸣的护城河 = LangBot 做不了的**：多 agent 编排 + 自部署 IM 本体 + 数据主权 + 移动端一体。LangBot 是"把 agent 塞进别家 IM"，合鸣是"造一个 agent 天然生活的 IM"。
3. **可借鉴/互补**：LangBot 的**多平台适配层**、**生产级治理能力**（访问控制/限流/敏感词/监控）可直接对标补强合鸣；**LangBot 是潜在合作/上游生态对象**（合鸣可作为 LangBot 的一个"IM 后端/前端"，或反之）。

### 5.2 Matrix + LLM bot 生态（开源 IM 协议 + agent）

- **Matrix**（去中心化开放 IM 协议）是"自部署 IM"的开源标杆，**合鸣自建 relay/协议可参考 Matrix 的端到端/去中心化/桥接(bridge)设计**。
- 生态里有大量 Matrix+LLM bot（baibot 等），但多为**单 bot**；**Matrix 的 bridge 机制**（桥接 Signal/WhatsApp/iMessage/Zulip）是合鸣"多端互联/跨平台"可借的协议思路（呼应合鸣 device-link-plan 的 mDNS+relay 双通道）。
- **合鸣可借鉴**：Matrix 的**事件流(event source)模型**——所有消息/状态都是**可重放的事件**，天然适合 agent 订阅"频道里发生了什么"（agent 的感知层 = 订阅 Matrix 式事件流）。

### 5.3 Rasa 3.x / CALM、Botpress Hub（传统 bot 框架向 agent 转型）

- **Rasa**：传统 NLU/对话 bot 框架，3.x 探索 **CALM**（context-aware language model 方向）向 LLM agent 靠拢；**Botpress**：低代码 bot 构建 + **Botpress Hub**（市场/分发）。二者代表"**传统客服 bot → agentic**"的转型，**偏"单对话 agent + 工作流"**，多 agent 编排非重点。
- **合鸣可借鉴**：**低代码 agent 搭建 UX**（Rasa/Botpress 的拖拽/可视化）可参考，但合鸣用"IM 对话流本身"做搭建（见 3.2 ChatDev 2.0 零代码），体验更自然。
- **注**：rasa.com/docs、docs.botpress.com 本次抓取被拦截/重定向，上述为据公开产品知识的概述。

### 5.4 开源小结

- **赛道已热**：LangBot（1.7w+）证明 IM+Agent 开源需求旺盛；Matrix 提供自部署 IM 的协议范本；A2A/MCP 提供 agent 互操作/工具标准。
- **空白点 = 合鸣主场**：**"多 agent 编排" × "自部署 IM 本体" × "移动端一体" × "数据主权"** 的四重交集，目前**无开源项目占位**，LangBot 们只占"寄生型 + 单 agent"。

---

## 6. 方向五：学术前沿（multi-agent collaboration 2025-2026 趋势）

> 来源：arXiv API 实时检索（2026-07 ~ 2026-09 最新）。以下为本轮抓到的代表性工作。

### 6.1 趋势一：「组织科学」派 —— 把组织理论做成可执行、可学习的配置（**对合鸣最相关**）

- **《Toward an Organizational Science of Multi-Agent LLM Systems》(arXiv:2607.25446, 2026-07)**：提出 **IMACS**，把多 agent 框架里纠缠的三件事**拆成正交、可独立替换的三层**：
  - **organization（谁在团队）** = 用经典组织理论建模——**Belbin 团队角色 / Mintzberg 协调机制 / RACI 问责矩阵**；
  - **coordination（怎么对齐）**；
  - **collaboration protocol（用哪个算法融合产出）** = 6 种已发表协作算法统一接口。
  - **核心洞见**：**"问责点(accountability)放在哪，只有在协议把产出路由经过该问责 agent 时才影响结果；且最优放置会随模型家族翻转"** → **组织设计不能硬编码，必须按模型/任务可配置、可学习/可复验证**。
  - 提出 **Adaptive Org Routing**（contextual-bandit 元协议）按任务选协议、在质量-成本权衡下在线学习，**在受控研究中优于任何固定协议**。
- **对合鸣的直接意义**：合鸣的「团队权限体系 / 部门树 / 五级角色（见 org-permission-design）」= 这套"organization 层"的产品化；**合鸣应把"角色-协调-问责-协作协议"做成四个可独立配置的维度**，而不是写死在编排逻辑里；**RACI 问责矩阵**可直接映射到"任务卡片的 owner/approver/reviewer 字段"。

### 6.2 趋势二：动态编排 / 编排者 / 自进化

- **ChatDev Puppeteer（NeurIPS 2025，arXiv:2505.19591）**：可学习中央编排者动态激活/排序 agent（见 3.2）。
- **MEGA（arXiv:2608.10504, 2026-08）**："self-evolving agent optimization infrastructure"，用 **Wisdom Graph** 累积优化 agent 系统——**从"造单个 agent"转向"造能系统性自我改进 agent 的基础设施"**。
- **AFlow（ICLR 2025 oral）**：自动优化 agent 工作流结构。
- **合鸣可借鉴**：**编排策略可学习（RL/bandit）** 是中长期路线；**"Wisdom Graph"式经验累积** → 合鸣 agent 团队可把"历史任务的成功编排"沉淀为可复用的"团队剧本"。

### 6.3 趋势三：长时任务的退化 / 可靠性 / 被动感知

- **《How Fast Do Agents Rot?》(arXiv:2609.01660, 2026-08)**：**生产环境 LLM agent 在长多步工作流上仍不可靠**，benchmark 涨但生产掉——论证这是长时任务的固有问题。**直接支撑合鸣"长任务必须有人审门 + 显式台账 + 可中断"的设计必要性**（不能假设 agent 能一路跑到底）。
- **AgentRadio（arXiv:2607.28430, 2026-07）**："**Passive Awareness for Long-Horizon Multi-Agent Collaboration**"——长时协作里 agent 之间**被动感知彼此状态**（而非全量转发消息）。呼应 **BANDMAS（arXiv:2608.00458）** 的"带宽高效消息调度"——**不是每条消息都广播，按需/因果调度**。
- **合鸣可借鉴**：**多 agent 同群时，用"被动感知 + 选择性通知"而非全量刷屏**——合鸣 IM 里 agent 之间的高频内部消息应**折叠/静默**，只在"需人注意/状态变更"时冒泡，这正是合鸣 IM 相对纯 agent 框架的 UX 优势（IM 有"已读/免打扰/线程折叠"的原生机制）。

### 6.4 趋势四：对齐幻觉 / 协作评估 / 安全

- **《Illusion of Alignment》(arXiv:2608.08210, 2026-08)**：协作对话可能"看似达成一致，实际目标/假设/执行计划仍分歧"（真实用户 18 场会议研究证实）。**→ 合鸣"共识达成"不能只看 agent 说"好"，要有显式的结构化确认（任务卡片的"各方已确认"字段）。**
- **ForestBench（arXiv:2608.08605, 2026-08）**：多 agent 协作的**统一图框架评估**——把执行轨迹建成图来评估"协作质量"（而非只看结果）。**→ 合鸣可内建"协作轨迹图"做调试/审计。**
- **Attacking/Defending Multi-Agent CF（arXiv:2608.03272, 2026-08）**：多 agent 系统的**连通性攻击面**——agent 间连接越密越易被投毒/操纵。**→ 合鸣多 agent 编排要做"最小连通 + 权限隔离"（呼应数据主权/自部署的安全叙事）。**
- **EDGE（arXiv:2608.29971, 2026-08）**：用对话模拟**确定性评估** agent 行为一致性。**→ 合鸣 agent 的回归测试可借鉴"对话模拟 + 一致性度量"。**

### 6.5 趋势五：互操作标准（A2A + MCP）最新状态

- **A2A 1.0.0**（见下文 §7 详述）已**移交 Linux 基金会**（Google 贡献），有 Py/Go/JS/Java/.NET/Rust SDK。
- **MCP** 成为**工具接入的事实标准**（Slack/Copilot Studio/GitHub/Cursor/Factory/LangBot/AutoGen 全线支持）。
- **两者关系（官方口径）**：**MCP = agent↔工具；A2A = agent↔agent**。合鸣两者都吃：**MCP 接工具/插件，A2A 让合鸣的 agent 与外部 agent 互操作**（见 §7 与 §8）。

---

## 7. 深度技术件：A2A 1.0.0（agent 互操作标准，合鸣长任务状态机的骨架）

> 来源：a2aproject/A2A GitHub + a2a-protocol.org 官方 spec（**Latest Released 1.0.0**，前版 0.3.0/0.2.6/0.1.0）。

**定位**：让"不同框架/语言/厂商、跑在不同服务器上的 agent"能**互相发现、协商交互模态、安全协作长任务**，**且互不暴露内部状态/记忆/工具（opaque execution）**。

**关键技术件（合鸣可直接对齐）**
- **传输**：JSON-RPC 2.0 over HTTP(S)（也支持 gRPC / REST / 自定义 binding）；**流式用 SSE；异步长任务用 push notification(webhook)**。
- **发现**：**Agent Card**（描述能力 + 连接信息）→ 合鸣可给每个 agent 一张"Agent Card"，作为其能力/权限的自描述清单。
- **三层结构**：L1 规范数据模型(Protobuf) / L2 抽象操作（**Send Message / Send Streaming Message / Get Task / List Tasks / Cancel Task / Get Agent Card**）/ L3 协议绑定。
- **内容模型**：Message 由 **Part** 组成——**TextPart / FilePart（可内联字节或 url）/ DataPart（结构化 JSON）**，未来支持**内嵌 UI 组件(iframe 引用)**。
- **★ 任务状态机（合鸣最该抄的骨架）**——**Task 有 8 个状态**：
  - `SUBMITTED` → `WORKING` → 终态 `COMPLETED` / `FAILED` / `CANCELED` / `REJECTED`
  - **两个人类介入态**：`INPUT_REQUIRED`（**需要用户补充输入**）、`AUTH_REQUIRED`（**需要授权/认证**）
  - **流式生命周期**：若 agent 返回 Task，SSE 流 MUST 以 Task 对象开头，随后零或多个 **TaskStatusUpdateEvent** / **TaskArtifactUpdateEvent**，任务到终态时流 MUST 关闭。
  - **产物(Artifact)** 与**状态**分离更新（status 变了推 statusUpdate，产物变了推 artifactUpdate）→ **合鸣"任务卡片"应区分"进度区(状态)"与"产物区(交付物)"两块，独立原地更新。**
  - **长任务示例（官方）**：客户端请求长报告生成 + 配 webhook，任务完成后 **webhook 通知**——**这就是"合鸣移动端收长任务完成推送"的标准协议形态。**

**合鸣落地（机制级）**
1. **把 A2A 的 8 态 + INPUT_REQUIRED/AUTH_REQUIRED 直接映射为合鸣"任务卡片"的状态枚举**——人审门 = 卡片进入 `INPUT_REQUIRED` 时弹按钮，授权门 = `AUTH_REQUIRED` 时弹权限确认。
2. **任务卡片 = 状态区(流式更新) + 产物区(Artifact)**，双区独立更新，对齐 A2A 的 status/artifact 分离。
3. **合鸣 agent 对外暴露 A2A Server**（用现成 SDK），使合鸣的 agent 能被外部 agent/系统 A2A 调用，也能调外部 A2A agent——**互操作是"自部署 IM 里的 agent 生态"开放性的关键**。
4. **Agent Card → 合鸣 agent 的能力/权限自描述**，与插件 manifest 对齐。

---

## 8. 合鸣机会点总表（落到机制级）

> 按「短期可落地 / 中期差异化 / 长期路线」分层。

### 8.1 短期（1-2 周，借成熟机制快速补齐）
| # | 机会点 | 借谁 | 具体机制 |
|---|---|---|---|
| 1 | **任务卡片状态机** | A2A 1.0 | 采用 8 态 + `INPUT_REQUIRED`/`AUTH_REQUIRED`；卡片分"状态区(流式)"+"产物区(Artifact)"独立原地更新 |
| 2 | **人审门 = 卡片按钮** | Slack 原则 + GitHub cloud agent | "真实动作必确认"：卡片进入人审态弹「批准/驳回/追问」；可选**置信度分级**，低置信自动挂起 |
| 3 | **四层记忆** | Slack agent 文档 | in-context / short-term(线程) / long-term(workspace 持久) / **shared(多 agent 共享，存频道级)** |
| 4 | **四档协作模式** | AutoGen teams | 群里可切「轮流 / 智能选人(Selector) / 编排者主导(MagenticOne) / 交接接力(Swarm-Handoff)」 |
| 5 | **生产级治理** | LangBot | 访问控制 / 限流 / 敏感词 / 监控 / 异常处理，对齐合鸣自部署的企业可信 |

### 8.2 中期（差异化护城河，LangBot/大厂做不了的）
| # | 机会点 | 为什么是合鸣主场 |
|---|---|---|
| 6 | **IM 本体 = agent 编排画布**（范式 III） | 合鸣自研自部署 IM，agent 是群成员、线程是任务、@是派工、卡片是交接物；LangBot 寄生别家 IM 做不到，大厂不可自部署 |
| 7 | **组织科学四正交层**（org/coordination/RACI 问责/协作协议，可独立配置可学习） | 学术最新（IMACS 2607.25446）；合鸣"团队权限体系/部门树"正是 organization 层，RACI→任务卡片 owner/approver/reviewer |
| 8 | **移动端长任务闭环**（收"进度+人审"推送→批准/纠偏/接管） | Cursor iOS / GitHub 集中管控页已验证；合鸣移动端天然就是"agent 遥控台" |
| 9 | **SOP 团队剧本**（把分工做成可配置模板，而非写死 prompt） | MetaGPT `Code=SOP(Team)` + ChatDev 2.0 零代码；合鸣 IM 对话流=最自然的零代码编排 UI |
| 10 | **A2A Server 互操作 + MCP 工具面** | 让合鸣 agent 生态开放；MCP 统一接插件/工具（Copilot Studio/Cursor/Factory 全在用） |

### 8.3 长期（研究路线）
| # | 机会点 | 依据 |
|---|---|---|
| 11 | **编排策略可学习**（RL/bandit 自适应选协作协议、选发言/交接） | Puppeteer(NeurIPS'25) + IMACS Adaptive Org Routing |
| 12 | **团队经验累积 / 自进化**（历史成功编排沉淀为可复用剧本） | MEGA Wisdom Graph + AFlow |
| 13 | **多 agent 被动感知 + 选择性通知**（内部高频消息折叠，只冒泡关键状态） | AgentRadio + BANDMAS；IM 原生"免打扰/线程折叠"是天然优势 |
| 14 | **协作轨迹图审计 + 对话模拟回归测试** | ForestBench + EDGE；支撑自部署的可信/合规 |
| 15 | **对齐幻觉检测 / 最小连通安全** | Illusion of Alignment + 多 agent CF 连通性攻击面；强化"数据主权+自部署"安全叙事 |

---

## 9. 风险与开放问题

1. **Discord 官方 docs 与 飞书 aily 官网本次抓取被 Cloudflare/JS 壳拦截**，相关结论（§2.3/§2.4）基于公开产品知识，**未直连验证**，落地前应二次核对。
2. **A2A 的 `INPUT_REQUIRED` 目前主要面向"补输入"，`AUTH_REQUIRED` 面向"授权"**；"人审门"（approve/reject 一个具体动作）在 A2A 里是**通过让任务进入 input_required 并附确认消息**实现的，**不是独立的一等 API**——合鸣若要做"细粒度动作审批"需在 A2A 之上加一层。
3. **GitHub coding agent → cloud agent 改名**说明这块**命名/形态仍在快速演进**，引用时注意时效。
4. **"组织设计随模型家族翻转"（IMACS 结论）** 意味着：合鸣的默认角色/问责配置**不能一次写死**，应支持按所选模型/任务重新验证——这是产品上"可配置"的硬需求。
5. **LangBot 是双刃剑**：既是赛道验证（利好），也是直接竞品（其"寄生多平台 + 零部署 Cloud"对合鸣"自部署"定位形成张力）——建议主动评估**合作/生态位区分**，而非纯对抗。

---

## Sources

> 说明：以下为本轮调研实际抓取/检索的来源。标注 [CF 拦截] 者本次未能直连正文，结论依据公开产品知识。WebSearch 工具本轮返回空结果，故改用 WebFetch/直连抓取；部分站点被企业安全策略/Cloudflare 拦截。

**A2A / 互操作标准**
- A2A Protocol README（a2aproject/A2A, Linux Foundation, Apache-2.0）— https://github.com/a2aproject/A2A
- A2A Protocol Specification v1.0.0 — https://a2a-protocol.org/latest/specification/
- A2A SDK（Python/Go/JS/Java/.NET/Rust）— https://github.com/a2aproject/a2a-python

**IM 内嵌 Agent**
- Slack — What is an agent in Slack（agents 官方定义/记忆模型/原则/用例/分发）— https://docs.slack.dev/ai/agents/
- Slack — AI in Slack（Today / Slackbot / 摘要 / 企业搜索）— https://api.slack.com/features/ai
- Microsoft Copilot Studio — Agents overview（三种 harness / handoff / MCP，2026-08-03 更新）— https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-overview
- Discord 开发者文档（Activities / Interactions）— https://discord.com/developers/docs/activities/overview [CF 拦截，未直连]
- Discord 开发者博客 — https://discord.com/blog
- 飞书智能伙伴 aily — https://aily.feishu.cn/ [JS 壳，未取正文]

**Agent 团队协作**
- MetaGPT（Software Company / `Code=SOP(Team)` / MGX）— https://github.com/FoundationAgents/MetaGPT
- ChatDev（1.0 Virtual Software Company / 2.0 DevAll 零代码 / Puppeteer）— https://github.com/OpenBMB/ChatDev
- CAMEL（role-playing / AI User+Assistant / scaling law）— https://github.com/camel-ai/camel
- AutoGen（Teams: RoundRobin / Selector / MagenticOne / Swarm / Handoff / Core）— https://microsoft.github.io/autogen/stable/ ; Teams 教程 — https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html

**人机混合 / 长任务**
- GitHub Copilot cloud agent（原 coding agent；rationale/confidence/approvals；agent management；automations；MCP）— https://docs.github.com/en/copilot/concepts/agents/cloud-agent
- Cursor Cloud Agents（隔离 VM / 多仓库 / iOS/Web/Desktop/Slack 启动 / MCP / builds / automations）— https://cursor.com/docs/cloud-agent ; builds — https://cursor.com/docs/cloud-agent/builds ; automations — https://cursor.com/docs/cloud-agent/automations
- Factory.ai / Droid（Autonomy Stack / 全 SDLC 自动化 / 多端 / Droid Computers / 企业治理）— https://factory.ai/ ; docs — https://docs.factory.ai/
- Devin（Cognition；长时规划 / 实时汇报 / 接受反馈 / 共同决策）— https://cognition.com/blog/introducing-devin

**开源新物种**
- LangBot（生产级多平台 agentic IM bot / Agent+知识库编排+插件+MCP / Matrix 桥接）— https://github.com/langbot-app/LangBot
- Matrix 规范（自部署/去中心化/bridge/event source）— https://matrix.org/developers/ [直连被拦截]
- Rasa（3.x / CALM 方向）— https://rasa.com/docs/rasa/ [部分重定向]
- Botpress（Hub / 低代码）— https://docs.botpress.com/ [CF 拦截]

**学术前沿（arXiv API 实时检索，2026-07 ~ 2026-09）**
- Toward an Organizational Science of Multi-Agent LLM Systems（IMACS / org·coordination·protocol 正交 / RACI / Adaptive Org Routing）— https://arxiv.org/abs/2607.25446
- Multi-Agent Collaboration via Evolving Orchestration（ChatDev Puppeteer, NeurIPS 2025）— https://arxiv.org/abs/2505.19591
- MEGA: Self-Evolving Agent Optimization Infrastructure via Wisdom Graph — https://arxiv.org/abs/2608.10504
- How Fast Do Agents Rot?（长时任务退化/可靠性）— https://arxiv.org/abs/2609.01660
- AgentRadio: Passive Awareness for Long-Horizon Multi-Agent Collaboration — https://arxiv.org/abs/2607.28430
- BANDMAS: Bandwidth-Efficient Multi-Agent Collaboration — https://arxiv.org/abs/2608.00458
- Illusion of Alignment: Detecting Hidden Disagreement in Collaborative Dialogue — https://arxiv.org/abs/2608.08210
- ForestBench: A Unified Graph Framework for Evaluating Multi-Agent Collaboration — https://arxiv.org/abs/2608.08605
- Attacking and Defending Multi-Agent Collaborative Filtering Systems Through Connectivity — https://arxiv.org/abs/2608.03272
- EDGE: Engine for Deterministic Graph Evaluation through Conversation Simulation — https://arxiv.org/abs/2608.29971
