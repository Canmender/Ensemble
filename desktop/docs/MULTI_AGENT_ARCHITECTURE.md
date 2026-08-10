# 多 Agent 系统架构设计手册

本文档是合鸣（Ensemble）平台的架构设计源头，涵盖 Memory/Tool 交互协议、ReAct 拆解、状态机编排、角色分工、RAG 集成、对抗式迭代、容器化部署、监控回滚、自动调优等完整知识体系。

---

## 目录

1. [Memory 与 Tool 交互协议](#1-memory-与-tool-交互协议)
2. [ReAct 拆解：Plan → Execute → Reflect](#2-react-拆解plan--execute--reflect)
3. [LangGraph 状态机编排](#3-langgraph-状态机编排)
4. [角色分工：Planner / Critic / Summarizer](#4-角色分工planner--critic--summarizer)
5. [RAG 知识库集成](#5-rag-知识库集成)
6. [Function Calling 调外部 API](#6-function-calling-调外部-api)
7. [对抗式迭代：写代码 vs 找 Bug](#7-对抗式迭代写代码-vs-找-bug)
8. [容器化部署与监控](#8-容器化部署与监控)
9. [自动调优：Prompt 与 Few-shot](#9-自动调优prompt-与-few-shot)
10. [10 万次调用稳定性保障](#10-10-万次调用稳定性保障)

---

## 1. Memory 与 Tool 交互协议

### 1.1 三层记忆架构

```
┌─────────────────────────────────────────────┐
│              Working Memory (上下文窗口)      │  ← 当前对话 + 工具结果
├─────────────────────────────────────────────┤
│              Episodic Memory (近期情境)       │  ← 最近 N 次任务摘要
├─────────────────────────────────────────────┤
│              Semantic Memory (长期知识)       │  ← MEMORY.md + FTS5 + 向量库
└─────────────────────────────────────────────┘
```

### 1.2 Memory-Tool 交互协议

```typescript
interface MemoryToolProtocol {
  // Tool 写入 Memory
  memory_write: {
    input: { key: string; value: string; tags?: string[]; ttl?: number };
    output: { id: string; stored: boolean };
    // 写入 Semantic Memory，自动去重 + 向量化
  };

  // Tool 读取 Memory
  memory_read: {
    input: { query: string; topK?: number; tags?: string[] };
    output: { results: MemoryEntry[] };
    // FTS5 全文检索 + 向量相似度排序
  };

  // Tool 列出 Memory
  memory_list: {
    input: { agentId?: string; limit?: number };
    output: { entries: MemoryEntry[]; total: number };
  };
}
```

### 1.3 记忆生命周期

```
用户对话 → Agent 写入 memory_write
  → Working Memory (当前上下文)
  → Episodic Memory (任务完成后 consolidate)
  → Semantic Memory (LLM 提取关键事实)

下次对话 → Agent 调用 memory_read
  → 检索相关记忆注入上下文
  → 工具结果可引用记忆 ID
```

### 1.4 合鸣当前实现 vs 理想状态

| 维度 | 当前实现 | 理想状态 |
|------|----------|----------|
| 存储 | SQLite FTS5 | FTS5 + 向量库 (Chroma/Qdrant) |
| 检索 | 关键词匹配 | 语义检索 + 关键词混合 |
| Consolidate | LLM 定时提取 | 增量 consolidation + 重要度打分 |
| 工具集成 | memory_write/read/list | + memory_search (向量) + memory_forget |

---

## 2. ReAct 拆解：Plan → Execute → Reflect

### 2.1 标准 ReAct 循环

```
Thought → Action → Observation → Thought → Action → Observation → ... → Final Answer
```

### 2.2 拆解为三阶段

```
┌─────────┐     ┌─────────┐     ┌──────────┐
│  PLAN   │────→│ EXECUTE │────→│ REFLECT  │
│ 制定计划 │     │ 执行步骤 │     │ 反思评估  │
└─────────┘     └─────────┘     └──────────┘
     ↑                                  │
     └──────────── 修订计划 ←────────────┘
```

### 2.3 状态定义

```typescript
interface AgentState {
  // 输入
  task: string;
  context: string[];

  // Plan 阶段
  plan: PlanStep[];
  currentStep: number;

  // Execute 阶段
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  intermediateResults: string[];

  // Reflect 阶段
  reflections: Reflection[];
  qualityScore: number;        // 0-1
  needsRevision: boolean;

  // 终止条件
  maxIterations: number;
  currentIteration: number;
  status: "planning" | "executing" | "reflecting" | "done" | "failed";
}

interface PlanStep {
  id: string;
  description: string;
  tool?: string;
  dependencies: string[];  // 依赖的步骤 ID
  status: "pending" | "running" | "done" | "failed";
}

interface Reflection {
  stepId: string;
  assessment: string;
  issues: string[];
  suggestions: string[];
  score: number;  // 0-1
}
```

### 2.4 实现模板

```typescript
async function planExecuteReflect(task: string): Promise<Result> {
  const state = initState(task);

  while (state.currentIteration < state.maxIterations) {
    // 1. PLAN: 分解任务为步骤
    if (state.status === "planning") {
      state.plan = await planner.plan(state.task, state.context, state.reflections);
      state.status = "executing";
      state.currentStep = 0;
    }

    // 2. EXECUTE: 按计划执行
    if (state.status === "executing") {
      const step = state.plan[state.currentStep];
      const result = await executor.execute(step, state);
      state.intermediateResults.push(result);

      state.currentStep++;
      if (state.currentStep >= state.plan.length) {
        state.status = "reflecting";
      }
    }

    // 3. REFLECT: 评估结果质量
    if (state.status === "reflecting") {
      const reflection = await reflector.reflect(state);
      state.reflections.push(reflection);

      if (reflection.score >= 0.9 || state.currentIteration >= state.maxIterations - 1) {
        state.status = "done";
      } else {
        state.status = "planning";  // 回到 Plan 阶段修订
        state.needsRevision = true;
      }
    }

    state.currentIteration++;
  }

  return compileResult(state);
}
```

---

## 3. LangGraph 状态机编排

### 3.1 核心概念

LangGraph 用**图（Graph）**建模 Agent 工作流：

- **Node**: 计算单元（LLM 调用、工具执行、条件判断）
- **Edge**: 节点间的转移
- **Conditional Edge**: 根据状态决定下一个节点
- **State**: 全局可变状态，在节点间传递
- **Checkpoint**: 状态快照，支持回溯和恢复

### 3.2 状态定义

```typescript
// LangGraph 风格的状态 Schema
const AgentState = {
  messages: Annotation<Message[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  plan: Annotation<PlanStep[]>({
    reducer: (prev, next) => next ?? prev,
    default: () => [],
  }),
  currentStep: Annotation<number>({
    reducer: (prev, next) => next ?? prev,
    default: () => 0,
  }),
  toolResults: Annotation<ToolResult[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  qualityScore: Annotation<number>({
    reducer: (prev, next) => next ?? prev,
    default: () => 0,
  }),
};
```

### 3.3 图定义

```typescript
import { StateGraph, END, START } from "@langchain/langgraph";

const workflow = new StateGraph(AgentState)
  // 节点
  .addNode("planner", planNode)
  .addNode("executor", executeNode)
  .addNode("reflector", reflectNode)
  .addNode("summarizer", summarizeNode)

  // 边
  .addEdge(START, "planner")
  .addEdge("planner", "executor")
  .addConditionalEdges("executor", routeAfterExecute, {
    continue: "executor",      // 还有步骤要执行
    reflect: "reflector",      // 所有步骤完成
  })
  .addConditionalEdges("reflector", routeAfterReflect, {
    revise: "planner",         // 需要修订计划
    summarize: "summarizer",   // 质量达标
    retry: "executor",         // 重试当前步骤
  })
  .addEdge("summarizer", END);

const app = workflow.compile({ checkpointer: new MemorySaver() });
```

### 3.4 路由函数

```typescript
function routeAfterExecute(state: AgentState): string {
  if (state.currentStep < state.plan.length) {
    return "continue";
  }
  return "reflect";
}

function routeAfterReflect(state: AgentState): string {
  const lastReflection = state.reflections[state.reflections.length - 1];
  if (lastReflection.score >= 0.9) {
    return "summarize";
  }
  if (state.currentIteration >= state.maxIterations - 1) {
    return "summarize";  // 达到最大迭代，强制总结
  }
  if (lastReflection.issues.some(i => i.includes("critical"))) {
    return "revise";     // 关键问题，重新规划
  }
  return "retry";        // 一般问题，重试
}
```

### 3.5 Checkpoint 与恢复

```typescript
// 保存检查点
const config = { configurable: { thread_id: "task-123" } };
const result = await app.invoke(initialState, config);

// 从检查点恢复
const checkpoint = await checkpointer.get(config);
const resumed = await app.invoke(null, { ...config, checkpoint });

// 人机交互中断
const interruptConfig = {
  interrupt_before: ["executor"],  // 执行前暂停，等人类确认
};
```

---

## 4. 角色分工：Planner / Critic / Summarizer

### 4.1 角色定义

```
┌─────────────┐
│   Planner   │  分析任务，制定执行计划
│  规划者      │  输入: 任务描述 + 上下文 + 历史反思
│             │  输出: PlanStep[]
└──────┬──────┘
       ↓
┌─────────────┐
│  Executor   │  按计划调用工具执行
│  执行者      │  输入: PlanStep + 工具集
│             │  输出: ToolResult
└──────┬──────┘
       ↓
┌─────────────┐
│   Critic    │  评估执行结果质量
│  评审者      │  输入: 执行结果 + 期望标准
│             │  输出: Reflection (score + issues)
└──────┬──────┘
       ↓
┌─────────────┐
│ Summarizer  │  汇总结果，生成最终输出
│  总结者      │  输入: 所有中间结果 + 反思
│             │  输出: 最终报告/代码/答案
└─────────────┘
```

### 4.2 Prompt 模板

**Planner**:
```
你是一个任务规划专家。给定以下任务，将其分解为可执行的步骤。

任务: {task}
上下文: {context}
历史反思: {reflections}

输出 JSON:
{
  "steps": [
    { "id": "1", "description": "...", "tool": "...", "dependencies": [] }
  ],
  "estimated_complexity": "low|medium|high",
  "risk_assessment": "..."
}
```

**Critic**:
```
你是一个严格的质量评审员。评估以下执行结果。

任务: {task}
执行结果: {result}
期望标准: {criteria}

输出 JSON:
{
  "score": 0.0-1.0,
  "assessment": "...",
  "issues": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"],
  "verdict": "pass|revise|fail"
}
```

**Summarizer**:
```
你是一个专业的总结者。将以下执行过程和结果汇总为最终报告。

任务: {task}
执行步骤: {steps}
工具结果: {toolResults}
反思记录: {reflections}

输出: 结构化的最终报告，包含关键发现、结论、建议。
```

### 4.3 角色间通信

```typescript
interface AgentMessage {
  from: "planner" | "executor" | "critic" | "summarizer";
  to: "planner" | "executor" | "critic" | "summarizer" | "orchestrator";
  type: "plan" | "result" | "feedback" | "summary" | "error";
  payload: unknown;
  timestamp: number;
  correlationId: string;  // 关联同一任务的所有消息
}
```

---

## 5. RAG 知识库集成

### 5.1 RAG 架构

```
用户查询
    ↓
┌─────────────┐
│  Retriever  │  从知识库检索相关文档
│  检索器      │  策略: 向量检索 + BM25 + 混合
└──────┬──────┘
       ↓
┌─────────────┐
│  Reranker   │  重排序，过滤低质量结果
│  重排器      │  模型: cross-encoder / Cohere
└──────┬──────┘
       ↓
┌─────────────┐
│  Generator  │  基于检索结果生成回答
│  生成器      │  注入: system prompt + 检索上下文
└─────────────┘
```

### 5.2 向量数据库选型

| 数据库 | 特点 | 适用场景 |
|--------|------|----------|
| **Chroma** | 轻量、嵌入式 | 本地开发、小规模 |
| **Qdrant** | 高性能、Rust | 生产环境、大规模 |
| **Weaviate** | GraphQL API | 复杂查询 |
| **Pinecone** | 全托管 | 无运维需求 |
| **pgvector** | PostgreSQL 扩展 | 已有 PG 基础设施 |

### 5.3 RAG 工具定义

```typescript
const ragTool: AgentTool = {
  name: "knowledge_search",
  description: "从知识库检索相关文档。用于回答需要专业知识的问题。",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索查询" },
      topK: { type: "number", description: "返回结果数量", default: 5 },
      filters: {
        type: "object",
        properties: {
          source: { type: "string", description: "来源过滤" },
          dateRange: { type: "string", description: "日期范围" },
        },
      },
    },
    required: ["query"],
  },
  execute: async (input, ctx) => {
    const { query, topK = 5, filters } = input as any;

    // 1. 向量检索
    const vectorResults = await vectorStore.similaritySearch(query, topK * 2, filters);

    // 2. BM25 检索（混合检索）
    const bm25Results = await bm25Search(query, topK * 2, filters);

    // 3. 合并去重
    const merged = mergeAndDedupe(vectorResults, bm25Results);

    // 4. Rerank
    const reranked = await reranker.rerank(query, merged, { topK });

    // 5. 格式化输出
    return reranked
      .map((r, i) => `[${i + 1}] ${r.metadata.source}\n${r.content}`)
      .join("\n\n");
  },
};
```

### 5.4 分块策略

```typescript
interface ChunkingStrategy {
  method: "fixed" | "recursive" | "semantic" | "document";
  chunkSize: number;       // 默认 512 tokens
  chunkOverlap: number;    // 默认 50 tokens
  separators?: string[];   // 递归分割符 ["\n\n", "\n", "。", ".", " "]
}

// 语义分块（按段落主题边界）
async function semanticChunk(text: string): Promise<Chunk[]> {
  const sentences = splitSentences(text);
  const embeddings = await embed(sentences);

  const chunks: Chunk[] = [];
  let current: string[] = [];

  for (let i = 0; i < sentences.length; i++) {
    current.push(sentences[i]);

    // 计算与下一句的相似度
    if (i < sentences.length - 1) {
      const similarity = cosine(embeddings[i], embeddings[i + 1]);
      if (similarity < 0.75) {
        // 主题边界，切分
        chunks.push({ content: current.join(" "), metadata: { startIndex: i - current.length + 1 } });
        current = [];
      }
    }
  }

  if (current.length) {
    chunks.push({ content: current.join(" "), metadata: { startIndex: sentences.length - current.length } });
  }

  return chunks;
}
```

---

## 6. Function Calling 调外部 API

### 6.1 Function Calling 协议

```typescript
// Anthropic Claude 格式
interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, JSONSchema>;
    required?: string[];
  };
}

// OpenAI 格式
interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}
```

### 6.2 API 适配层设计

```typescript
// 统一的 API 适配器接口
interface ApiAdapter {
  name: string;
  baseUrl: string;
  auth: AuthConfig;
  endpoints: EndpointDef[];
}

// 定义外部 API
const githubAdapter: ApiAdapter = {
  name: "github",
  baseUrl: "https://api.github.com",
  auth: { type: "token", header: "Authorization", prefix: "Bearer" },
  endpoints: [
    {
      name: "search_repos",
      method: "GET",
      path: "/search/repositories",
      params: { q: "string", sort: "string", per_page: "number" },
      // 自动转换为 Agent Tool
    },
    {
      name: "create_issue",
      method: "POST",
      path: "/repos/{owner}/{repo}/issues",
      params: { owner: "string", repo: "string", title: "string", body: "string" },
    },
  ],
};

// 自动生成 Tool 定义
function adapterToTools(adapter: ApiAdapter): AgentTool[] {
  return adapter.endpoints.map((ep) => ({
    name: `${adapter.name}_${ep.name}`,
    description: `${adapter.name} API: ${ep.method} ${ep.path}`,
    parameters: {
      type: "object",
      properties: ep.params,
      required: Object.keys(ep.params),
    },
    execute: async (input) => {
      const url = buildUrl(adapter.baseUrl + ep.path, input);
      const res = await fetch(url, {
        method: ep.method,
        headers: buildAuthHeaders(adapter.auth),
        body: ep.method !== "GET" ? JSON.stringify(input) : undefined,
      });
      return res.json();
    },
  }));
}
```

### 6.3 工具注册与发现

```typescript
// MCP (Model Context Protocol) 风格的工具注册
class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  // 从 MCP Server 动态发现工具
  async discoverFromMcp(serverUrl: string): Promise<void> {
    const client = new McpClient(serverUrl);
    const tools = await client.listTools();
    for (const tool of tools) {
      this.register(mcpToolToAgentTool(tool));
    }
  }

  // 从 OpenAPI spec 自动生成工具
  async discoverFromOpenApi(specUrl: string): Promise<void> {
    const spec = await fetch(specUrl).then((r) => r.json());
    const tools = openApiToTools(spec);
    tools.forEach((t) => this.register(t));
  }

  forNames(names: string[]): AgentTool[] {
    return names.map((n) => this.tools.get(n)).filter(Boolean) as AgentTool[];
  }
}
```

---

## 7. 对抗式迭代：写代码 vs 找 Bug

### 7.1 架构

```
┌─────────────┐         ┌─────────────┐
│   Coder     │────────→│   Tester    │
│  代码生成    │  代码    │  测试生成    │
│             │←────────│  Bug 发现    │
└─────────────┘  反馈    └─────────────┘
      ↑                            │
      └────────── 修订 ←───────────┘
```

### 7.2 状态定义

```typescript
interface AdversarialState {
  task: string;
  code: string;
  tests: string[];
  bugs: BugReport[];
  coverage: number;        // 0-1
  iteration: number;
  maxIterations: number;
  status: "coding" | "testing" | "fixing" | "done" | "failed";
}

interface BugReport {
  id: string;
  severity: "critical" | "major" | "minor";
  description: string;
  reproduction: string;    // 复现步骤或测试用例
  suggestedFix?: string;
  file?: string;
  line?: number;
}
```

### 7.3 实现

```typescript
async function adversarialCoding(task: string): Promise<AdversarialState> {
  const state: AdversarialState = {
    task,
    code: "",
    tests: [],
    bugs: [],
    coverage: 0,
    iteration: 0,
    maxIterations: 10,
    status: "coding",
  };

  while (state.iteration < state.maxIterations) {
    // 1. Coder 生成/修订代码
    if (state.status === "coding") {
      if (state.iteration === 0) {
        state.code = await coder.generateCode(state.task);
      } else {
        state.code = await coder.fixBugs(state.code, state.bugs);
      }
      state.status = "testing";
    }

    // 2. Tester 生成测试并执行
    if (state.status === "testing") {
      state.tests = await tester.generateTests(state.task, state.code);
      const testResults = await tester.runTests(state.code, state.tests);
      state.coverage = testResults.coverage;
      state.bugs = testResults.bugs;

      if (state.bugs.length === 0 && state.coverage >= 0.9) {
        state.status = "done";
      } else {
        state.status = "fixing";
      }
    }

    // 3. 评估是否继续
    if (state.status === "fixing") {
      const criticalBugs = state.bugs.filter((b) => b.severity === "critical");
      if (criticalBugs.length > 0) {
        state.status = "coding";  // 有关键 Bug，继续修复
      } else if (state.coverage < 0.8) {
        state.status = "testing";  // 覆盖率不足，补充测试
      } else {
        state.status = "done";     // 可接受
      }
    }

    state.iteration++;
  }

  return state;
}
```

### 7.4 测试覆盖率驱动

```typescript
// 覆盖率分析工具
const coverageTool: AgentTool = {
  name: "analyze_coverage",
  description: "分析代码测试覆盖率，找出未覆盖的分支和路径",
  parameters: {
    type: "object",
    properties: {
      code: { type: "string" },
      tests: { type: "array", items: { type: "string" } },
    },
    required: ["code", "tests"],
  },
  execute: async (input) => {
    const { code, tests } = input as any;

    // 运行测试并收集覆盖率
    const result = await runWithCoverage(code, tests);

    return {
      totalLines: result.totalLines,
      coveredLines: result.coveredLines,
      coverage: result.coverage,
      uncoveredBranches: result.uncoveredBranches,
      uncoveredFunctions: result.uncoveredFunctions,
      // 生成针对性测试建议
      suggestions: generateTestSuggestions(result.uncoveredBranches),
    };
  },
};
```

---

## 8. 容器化部署与监控

### 8.1 Docker 架构

```dockerfile
# Dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8787/api/health || exit 1

EXPOSE 8787
CMD ["node", "dist/index.js"]
```

### 8.2 Docker Compose

```yaml
version: "3.8"
services:
  ensemble:
    build: .
    ports:
      - "8787:8787"
    volumes:
      - data:/app/data
      - config:/app/config
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/ensemble.db
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "2.0"

  relay:
    build: ./relay-server
    ports:
      - "8888:8888"
    restart: unless-stopped

  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    volumes:
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards

volumes:
  data:
  config:
```

### 8.3 Prometheus 监控指标

```typescript
import { Registry, Counter, Histogram, Gauge } from "prom-client";

const register = new Registry();

// Agent 执行指标
const agentExecutions = new Counter({
  name: "ensemble_agent_executions_total",
  help: "Total agent executions",
  labelNames: ["agent_id", "mode", "status"],
  registers: [register],
});

const agentDuration = new Histogram({
  name: "ensemble_agent_duration_seconds",
  help: "Agent execution duration",
  labelNames: ["agent_id", "mode"],
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

// LLM 调用指标
const llmCalls = new Counter({
  name: "ensemble_llm_calls_total",
  help: "Total LLM API calls",
  labelNames: ["provider", "model", "status"],
  registers: [register],
});

const llmTokens = new Counter({
  name: "ensemble_llm_tokens_total",
  help: "Total tokens used",
  labelNames: ["provider", "model", "type"],  // type: input/output
  registers: [register],
});

const llmLatency = new Histogram({
  name: "ensemble_llm_latency_seconds",
  help: "LLM API latency",
  labelNames: ["provider", "model"],
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});

// 工具调用指标
const toolCalls = new Counter({
  name: "ensemble_tool_calls_total",
  help: "Total tool calls",
  labelNames: ["tool", "status"],
  registers: [register],
});

const toolDuration = new Histogram({
  name: "ensemble_tool_duration_seconds",
  help: "Tool execution duration",
  labelNames: ["tool"],
  buckets: [0.1, 0.5, 1, 5, 10, 30],
  registers: [register],
});

// 系统指标
const activeRuns = new Gauge({
  name: "ensemble_active_runs",
  help: "Currently active runs",
  registers: [register],
});

const wsConnections = new Gauge({
  name: "ensemble_ws_connections",
  help: "Active WebSocket connections",
  registers: [register],
});

const memoryUsage = new Gauge({
  name: "ensemble_memory_usage_bytes",
  help: "Memory usage",
  labelNames: ["type"],  // heap, rss, external
  registers: [register],
});
```

### 8.4 自动回滚

```yaml
# rollback-policy.yml
rollback:
  triggers:
    - metric: error_rate
      threshold: 0.1  # 错误率 > 10%
      window: 5m
    - metric: p99_latency
      threshold: 30s   # P99 延迟 > 30s
      window: 5m
    - metric: health_check_failures
      threshold: 3     # 连续 3 次健康检查失败

  actions:
    - type: restart
      max_attempts: 2
    - type: rollback
      to: previous_version
    - type: alert
      channel: webhook
      url: "${ALERT_WEBHOOK_URL}"
```

---

## 9. 自动调优：Prompt 与 Few-shot

### 9.1 日志驱动的 Prompt 优化

```typescript
interface PromptTuner {
  // 收集成功/失败案例
  collectExamples(run: RunLog): void;

  // 分析失败原因
  analyzeFailures(): FailureAnalysis;

  // 生成优化建议
  generateSuggestions(): PromptSuggestion[];

  // 自动应用优化
  applyOptimization(suggestion: PromptSuggestion): void;
}

interface RunLog {
  id: string;
  task: string;
  prompt: string;
  fewShot: Example[];
  result: string;
  success: boolean;
  tokenUsage: Usage;
  duration: number;
  toolCalls: ToolCallLog[];
  errors: ErrorLog[];
}

interface FailureAnalysis {
  commonErrors: Array<{ pattern: string; count: number; suggestion: string }>;
  toolMisuse: Array<{ tool: string; pattern: string; suggestion: string }>;
  tokenWaste: Array<{ reason: string; avgWaste: number }>;
  latencyBottlenecks: Array<{ step: string; avgDuration: number }>;
}
```

### 9.2 Few-shot 自动选择

```typescript
class FewShotSelector {
  private examples: Map<string, Example[]> = new Map();

  // 根据任务相似度选择最佳 few-shot
  async select(task: string, k: number = 3): Promise<Example[]> {
    const taskEmbedding = await embed(task);
    const candidates: Array<{ example: Example; score: number }> = [];

    for (const [category, examples] of this.examples) {
      for (const example of examples) {
        const similarity = cosine(taskEmbedding, example.embedding);
        const recency = this.recencyScore(example.timestamp);
        const successBoost = example.success ? 1.2 : 0.8;
        const score = similarity * 0.6 + recency * 0.2 + successBoost * 0.2;

        candidates.push({ example, score });
      }
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((c) => c.example);
  }

  // 从日志中学习新示例
  learnFromRun(run: RunLog): void {
    if (run.success && run.tokenUsage.totalTokens < run.tokenUsage.budgetTokens * 0.8) {
      const category = this.categorizeTask(run.task);
      const examples = this.examples.get(category) ?? [];
      examples.push({
        task: run.task,
        input: run.prompt,
        output: run.result,
        embedding: null, // 异步计算
        timestamp: Date.now(),
        success: true,
      });
      this.examples.set(category, examples);
    }
  }
}
```

### 9.3 自动调优循环

```
每日自动流程:
1. 收集前 24h 日志 (成功/失败/延迟/Token)
2. 分析失败模式 (错误聚类)
3. 选择 Top-K 失败案例
4. 对每个案例生成 Prompt 变体
5. A/B 测试变体 (小流量)
6. 选择最优变体
7. 更新 Prompt 模板
8. 记录变更日志
```

---

## 10. 10 万次调用稳定性保障

### 10.1 稳定性架构

```
┌─────────────────────────────────────────────────────┐
│                    负载均衡层                         │
│              Nginx / Traefik / K8s Ingress          │
├─────────────────────────────────────────────────────┤
│                    应用层                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Instance │  │ Instance │  │ Instance │  ...     │
│  │    1     │  │    2     │  │    3     │          │
│  └──────────┘  └──────────┘  └──────────┘          │
├─────────────────────────────────────────────────────┤
│                    数据层                            │
│         SQLite (WAL) / PostgreSQL / Redis           │
├─────────────────────────────────────────────────────┤
│                    监控层                            │
│         Prometheus + Grafana + AlertManager         │
└─────────────────────────────────────────────────────┘
```

### 10.2 关键保障措施

| 措施 | 实现 | 目标 |
|------|------|------|
| **限流** | p-limit 并发控制 | 防止 LLM API 过载 |
| **重试** | 指数退避 + 抖动 | 处理瞬态故障 |
| **熔断** | 错误率 > 50% 时熔断 | 防止级联故障 |
| **超时** | AbortSignal.timeout() | 防止挂起 |
| **降级** | 备用模型/缓存响应 | 部分可用 |
| **幂等** | 请求 ID 去重 | 防止重复执行 |
| **审计** | 完整事件日志 | 可追溯 |
| **限流** | Token 桶算法 | 控制成本 |

### 10.3 错误处理策略

```typescript
class ResilientLLMProvider {
  private circuitBreaker: CircuitBreaker;
  private retryPolicy: RetryPolicy;

  async call(request: LLMRequest): Promise<LLMResult> {
    return this.circuitBreaker.execute(async () => {
      return this.retryPolicy.execute(async () => {
        // 1. 检查缓存
        const cached = await this.cache.get(request);
        if (cached) return cached;

        // 2. 限流
        await this.rateLimiter.acquire();

        // 3. 调用 LLM
        const result = await this.provider.call(request);

        // 4. 缓存结果
        await this.cache.set(request, result, { ttl: 300 });

        return result;
      });
    });
  }
}

// 熔断器
class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > this.timeout) {
        this.state = "half-open";
      } else {
        throw new Error("Circuit breaker is open");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.state = "open";
    }
  }
}
```

### 10.4 10 万次调用检查清单

- [ ] 限流: LLM API 调用 ≤ 100 req/s
- [ ] 重试: 指数退避 1s → 2s → 4s → 8s，最多 3 次
- [ ] 熔断: 连续 5 次失败后熔断 60s
- [ ] 超时: LLM 调用 120s，工具调用 30s
- [ ] 幂等: 请求 ID 去重，防止重复执行
- [ ] 监控: P50/P95/P99 延迟、错误率、Token 使用
- [ ] 告警: 错误率 > 5%、P99 > 30s、内存 > 80%
- [ ] 日志: 结构化日志，保留 30 天
- [ ] 备份: 数据库每日备份，保留 7 天
- [ ] 回滚: 版本化部署，一键回滚

---

## 合鸣集成路线图

### Phase 1: 基础能力 (当前)
- [x] Memory-Tool 交互协议 (memory_write/read/list)
- [x] ReAct 工具循环 (preReasoning → LLM → postToolResult)
- [x] 上下文压缩 (ContextManager)
- [x] WebSocket 实时推送

### Phase 2: 增强编排
- [ ] Plan-Execute-Reflect 三阶段拆解
- [ ] Planner / Critic / Summarizer 角色分工
- [ ] LangGraph 风格状态机
- [ ] Checkpoint 与恢复

### Phase 3: 知识与集成
- [ ] RAG 知识库 (向量检索 + 混合检索)
- [ ] Function Calling 适配层
- [ ] MCP 工具动态发现
- [ ] OpenAPI 自动生成工具

### Phase 4: 对抗与质量
- [ ] Coder vs Tester 对抗迭代
- [ ] 覆盖率驱动的测试生成
- [ ] 自动 Bug 发现与修复

### Phase 5: 生产化
- [ ] Docker 容器化
- [ ] Prometheus 监控
- [ ] 自动回滚
- [ ] Prompt 自动调优
- [ ] 10 万次调用稳定性验证

---

## 参考资源

| 资源 | 链接 |
|------|------|
| LangGraph 文档 | https://langchain-ai.github.io/langgraph/ |
| Anthropic MCP | https://modelcontextprotocol.io/ |
| Google A2A | https://github.com/google/A2A |
| AutoGen | https://github.com/microsoft/autogen |
| CrewAI | https://github.com/crewAIInc/crewAI |
| ReAct 论文 | https://arxiv.org/abs/2210.03629 |
| Reflexion 论文 | https://arxiv.org/abs/2303.11366 |
| Tree of Thoughts | https://arxiv.org/abs/2305.10601 |
