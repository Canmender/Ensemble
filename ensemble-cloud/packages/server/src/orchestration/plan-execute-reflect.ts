/**
 * Plan-Execute-Reflect 编排模式
 *
 * 将 ReAct 循环拆解为三阶段：
 * 1. Plan: 分解任务为可执行步骤
 * 2. Execute: 按计划调用工具执行
 * 3. Reflect: 评估结果质量，决定是否修订
 *
 * 参考: LangGraph Plan-and-Execute, Reflexion
 */

import type { AgentEvent, AgentTaskInput } from "@ensemble/shared";
import type { LLMProvider, LLMMessage, LLMTool } from "../llm/types";
import type { AgentTool, ToolContext } from "../tools/types";
import type { ContextManager } from "../context/manager";
import { logger } from "../util/logger";

// ========== 状态定义 ==========

export interface PlanStep {
  id: string;
  description: string;
  tool?: string;
  dependencies: string[];
  status: "pending" | "running" | "done" | "failed";
  result?: string;
  error?: string;
}

export interface Reflection {
  stepId: string;
  assessment: string;
  issues: string[];
  suggestions: string[];
  score: number; // 0-1
  verdict: "pass" | "revise" | "fail";
}

export interface PlanExecuteReflectState {
  // 输入
  task: string;
  context: string[];

  // Plan 阶段
  plan: PlanStep[];
  planVersion: number;

  // Execute 阶段
  currentStep: number;
  toolResults: Array<{ stepId: string; tool: string; input: unknown; output: string }>;

  // Reflect 阶段
  reflections: Reflection[];
  qualityScore: number;

  // 终止条件
  maxIterations: number;
  currentIteration: number;
  status: "planning" | "executing" | "reflecting" | "summarizing" | "done" | "failed";

  // 最终输出
  finalResult?: string;
  summary?: string;
}

// ========== 配置 ==========

export interface PlanExecuteReflectConfig {
  provider: LLMProvider;
  model: string;
  systemPrompt?: string;
  tools: AgentTool[];
  llmTools: LLMTool[];
  ctxManager?: ContextManager;
  signal?: AbortSignal;
  maxIterations?: number;
  qualityThreshold?: number; // 默认 0.85
  onEvent?: (event: AgentEvent) => void;
}

// ========== Planner ==========

const PLANNER_PROMPT = `你是一个任务规划专家。将以下任务分解为可执行的步骤。

规则：
1. 每个步骤应该是独立可验证的
2. 步骤之间有明确的依赖关系
3. 每个步骤可以指定使用的工具
4. 步骤数量控制在 3-10 个

输出 JSON 格式:
{
  "steps": [
    { "id": "1", "description": "步骤描述", "tool": "工具名(可选)", "dependencies": [] }
  ],
  "reasoning": "规划思路"
}`;

async function plan(
  state: PlanExecuteReflectState,
  config: PlanExecuteReflectConfig,
): Promise<PlanStep[]> {
  const messages: LLMMessage[] = [
    { role: "system", content: config.systemPrompt ?? PLANNER_PROMPT },
    { role: "user", content: `任务: ${state.task}\n\n上下文: ${state.context.join("\n")}\n\n${state.reflections.length > 0 ? `历史反思:\n${state.reflections.map((r) => `- ${r.assessment} (评分: ${r.score}): ${r.suggestions.join(", ")}`).join("\n")}` : ""}` },
  ];

  if (config.ctxManager) {
    const prepared = await config.ctxManager.prepare(messages, "planner");
    messages.length = 0;
    messages.push(...prepared.messages);
  }

  let response = "";
  for await (const ev of config.provider.stream({
    model: config.model,
    messages,
    temperature: 0.3,
    signal: config.signal,
  })) {
    if (ev.type === "text_delta") response += ev.text;
  }

  try {
    const parsed = JSON.parse(response);
    return (parsed.steps ?? []).map((s: any, i: number) => ({
      id: s.id ?? String(i + 1),
      description: s.description,
      tool: s.tool,
      dependencies: s.dependencies ?? [],
      status: "pending" as const,
    }));
  } catch {
    // JSON 解析失败，创建单步计划
    return [{
      id: "1",
      description: state.task,
      dependencies: [],
      status: "pending",
    }];
  }
}

// ========== Executor ==========

async function executeStep(
  step: PlanStep,
  state: PlanExecuteReflectState,
  config: PlanExecuteReflectConfig,
  toolCtx: ToolContext,
): Promise<string> {
  const tool = step.tool ? config.tools.find((t) => t.name === step.tool) : undefined;

  if (tool) {
    // 直接调用指定工具
    const messages: LLMMessage[] = [
      { role: "system", content: `你是一个执行者。使用工具 "${tool.name}" 完成以下步骤。\n\n工具描述: ${tool.description}\n\n步骤: ${step.description}` },
      { role: "user", content: `任务上下文: ${state.task}\n\n已完成步骤: ${state.toolResults.map((r) => `- ${r.stepId}: ${r.output.slice(0, 200)}`).join("\n")}` },
    ];

    let response = "";
    for await (const ev of config.provider.stream({
      model: config.model,
      messages,
      tools: config.llmTools.filter((t) => t.name === step.tool),
      temperature: 0.3,
      signal: config.signal,
    })) {
      if (ev.type === "text_delta") response += ev.text;
      if (ev.type === "tool_call") {
        const result = await tool.execute(ev.call.input, toolCtx);
        return result;
      }
    }
    return response;
  } else {
    // 使用 LLM 直接执行
    const messages: LLMMessage[] = [
      { role: "system", content: `你是一个执行者。完成以下任务步骤，给出详细结果。\n\n步骤: ${step.description}` },
      { role: "user", content: `任务: ${state.task}\n\n已完成步骤:\n${state.toolResults.map((r) => `- ${r.stepId}: ${r.output.slice(0, 200)}`).join("\n")}` },
    ];

    if (config.ctxManager) {
      const prepared = await config.ctxManager.prepare(messages, "executor");
      messages.length = 0;
      messages.push(...prepared.messages);
    }

    let response = "";
    for await (const ev of config.provider.stream({
      model: config.model,
      messages,
      temperature: 0.3,
      signal: config.signal,
    })) {
      if (ev.type === "text_delta") response += ev.text;
    }
    return response;
  }
}

// ========== Reflector ==========

const REFLECTOR_PROMPT = `你是一个严格的质量评审员。评估以下执行结果。

评分标准:
- 0.9-1.0: 优秀，可直接使用
- 0.7-0.9: 良好，有小问题但可接受
- 0.5-0.7: 一般，需要修订
- 0.0-0.5: 差，需要重新规划

输出 JSON:
{
  "score": 0.0-1.0,
  "assessment": "整体评估",
  "issues": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"],
  "verdict": "pass|revise|fail"
}`;

async function reflect(
  state: PlanExecuteReflectState,
  config: PlanExecuteReflectConfig,
): Promise<Reflection> {
  const messages: LLMMessage[] = [
    { role: "system", content: REFLECTOR_PROMPT },
    { role: "user", content: `任务: ${state.task}\n\n计划:\n${state.plan.map((s) => `${s.id}. ${s.description}`).join("\n")}\n\n执行结果:\n${state.toolResults.map((r) => `- 步骤 ${r.stepId} (${r.tool ?? "LLM"}): ${r.output.slice(0, 500)}`).join("\n")}` },
  ];

  let response = "";
  for await (const ev of config.provider.stream({
    model: config.model,
    messages,
    temperature: 0.2,
    signal: config.signal,
  })) {
    if (ev.type === "text_delta") response += ev.text;
  }

  try {
    const parsed = JSON.parse(response);
    return {
      stepId: "overall",
      assessment: parsed.assessment ?? "",
      issues: parsed.issues ?? [],
      suggestions: parsed.suggestions ?? [],
      score: parsed.score ?? 0.5,
      verdict: parsed.verdict ?? "revise",
    };
  } catch {
    return {
      stepId: "overall",
      assessment: "评估解析失败",
      issues: ["无法解析评审结果"],
      suggestions: ["重试评审"],
      score: 0.5,
      verdict: "revise",
    };
  }
}

// ========== Summarizer ==========

const SUMMARIZER_PROMPT = `你是一个专业的总结者。将以下执行过程和结果汇总为最终报告。

输出格式:
## 任务完成报告

### 任务描述
{任务描述}

### 执行过程
{关键步骤和结果}

### 最终结果
{结论和产出}

### 质量评估
{评分和改进建议}`;

async function summarize(
  state: PlanExecuteReflectState,
  config: PlanExecuteReflectConfig,
): Promise<string> {
  const messages: LLMMessage[] = [
    { role: "system", content: SUMMARIZER_PROMPT },
    { role: "user", content: `任务: ${state.task}\n\n执行步骤:\n${state.plan.map((s) => `${s.id}. ${s.description} [${s.status}]${s.result ? `\n   结果: ${s.result.slice(0, 300)}` : ""}`).join("\n")}\n\n反思记录:\n${state.reflections.map((r) => `- 评分 ${r.score}: ${r.assessment}`).join("\n")}` },
  ];

  let response = "";
  for await (const ev of config.provider.stream({
    model: config.model,
    messages,
    temperature: 0.3,
    signal: config.signal,
  })) {
    if (ev.type === "text_delta") response += ev.text;
  }

  return response;
}

// ========== 主编排函数 ==========

export async function* planExecuteReflect(
  task: string,
  context: string[],
  config: PlanExecuteReflectConfig,
  toolCtx: ToolContext,
): AsyncGenerator<AgentEvent> {
  const maxIterations = config.maxIterations ?? 5;
  const qualityThreshold = config.qualityThreshold ?? 0.85;

  const state: PlanExecuteReflectState = {
    task,
    context,
    plan: [],
    planVersion: 0,
    currentStep: 0,
    toolResults: [],
    reflections: [],
    qualityScore: 0,
    maxIterations,
    currentIteration: 0,
    status: "planning",
  };

  const emit = (event: AgentEvent) => {
    config.onEvent?.(event);
  };

  yield { type: "status", status: "starting", detail: "Plan-Execute-Reflect 模式", ts: Date.now() };

  while (state.currentIteration < state.maxIterations) {
    if (config.signal?.aborted) {
      yield { type: "status", status: "cancelled", ts: Date.now() };
      yield { type: "done", outcome: "cancelled", result: "cancelled by user", ts: Date.now() };
      return;
    }

    // ========== PLAN ==========
    if (state.status === "planning") {
      yield { type: "status", status: "running", detail: `规划中 (v${state.planVersion + 1})`, ts: Date.now() };

      state.plan = await plan(state, config);
      state.planVersion++;
      state.currentStep = 0;
      state.toolResults = [];
      state.status = "executing";

      yield { type: "output", kind: "thinking", text: `📋 计划 (${state.plan.length} 步):\n${state.plan.map((s) => `${s.id}. ${s.description}${s.tool ? ` [${s.tool}]` : ""}`).join("\n")}`, ts: Date.now() };
    }

    // ========== EXECUTE ==========
    if (state.status === "executing") {
      while (state.currentStep < state.plan.length) {
        if (config.signal?.aborted) {
          yield { type: "status", status: "cancelled", ts: Date.now() };
          yield { type: "done", outcome: "cancelled", result: "cancelled by user", ts: Date.now() };
          return;
        }

        const step = state.plan[state.currentStep];
        step.status = "running";

        yield { type: "status", status: "running", detail: `执行步骤 ${step.id}: ${step.description.slice(0, 50)}`, ts: Date.now() };

        try {
          const result = await executeStep(step, state, config, toolCtx);
          step.status = "done";
          step.result = result;

          state.toolResults.push({
            stepId: step.id,
            tool: step.tool ?? "llm",
            input: step.description,
            output: result,
          });

          yield { type: "tool_result", tool: step.tool ?? "llm", output: result.slice(0, 500), ts: Date.now() };
        } catch (err) {
          step.status = "failed";
          step.error = err instanceof Error ? err.message : String(err);

          yield { type: "error", message: `步骤 ${step.id} 失败: ${step.error}`, ts: Date.now() };
        }

        state.currentStep++;
      }

      state.status = "reflecting";
    }

    // ========== REFLECT ==========
    if (state.status === "reflecting") {
      yield { type: "status", status: "thinking", detail: "评估结果质量", ts: Date.now() };

      const reflection = await reflect(state, config);
      state.reflections.push(reflection);
      state.qualityScore = reflection.score;

      yield { type: "output", kind: "thinking", text: `🔍 评审结果: ${reflection.score.toFixed(2)} (${reflection.verdict})\n${reflection.assessment}${reflection.issues.length ? `\n问题: ${reflection.issues.join(", ")}` : ""}`, ts: Date.now() };

      if (reflection.score >= qualityThreshold || state.currentIteration >= state.maxIterations - 1) {
        state.status = "summarizing";
      } else {
        // 回到 Plan 阶段修订
        state.status = "planning";
        state.context.push(`[反思] ${reflection.assessment}\n问题: ${reflection.issues.join(", ")}\n建议: ${reflection.suggestions.join(", ")}`);
      }
    }

    state.currentIteration++;
  }

  // ========== SUMMARIZE ==========
  if (state.status === "summarizing") {
    yield { type: "status", status: "running", detail: "生成最终报告", ts: Date.now() };

    state.summary = await summarize(state, config);
    state.finalResult = state.summary;
    state.status = "done";

    yield { type: "output", kind: "text", text: state.summary, ts: Date.now() };
  }

  // ========== DONE ==========
  yield { type: "status", status: "success", ts: Date.now() };
  yield {
    type: "done",
    outcome: state.status === "done" ? "success" : "error",
    result: state.finalResult ?? "执行完成",
    ts: Date.now(),
  };
}
