/**
 * 对抗式代码迭代编排器
 *
 * 两个 Agent 对抗式迭代：
 * - Coder: 生成/修订代码
 * - Tester: 生成测试、发现 Bug
 *
 * 目标：测试覆盖率拉满，Bug 清零
 *
 * 参考: AlphaCode, ChatFuzz, adversarial code testing
 */

import type { AgentEvent, AgentTaskInput } from "@ensemble/shared";
import type { LLMProvider, LLMMessage, LLMTool } from "../llm/types";
import type { AgentTool, ToolContext } from "../tools/types";
import type { ContextManager } from "../context/manager";
import { logger } from "../util/logger";

// ========== 类型定义 ==========

export interface BugReport {
  id: string;
  severity: "critical" | "major" | "minor";
  description: string;
  reproduction: string;
  suggestedFix?: string;
  file?: string;
  line?: number;
  test?: string; // 发现此 Bug 的测试用例
}

export interface TestCase {
  id: string;
  name: string;
  code: string;
  type: "unit" | "integration" | "edge" | "regression";
  coversCode?: string; // 覆盖的代码片段
}

export interface CoverageReport {
  totalLines: number;
  coveredLines: number;
  coverage: number; // 0-1
  uncoveredFunctions: string[];
  uncoveredBranches: string[];
  suggestions: string[]; // 针对未覆盖部分的测试建议
}

export interface AdversarialState {
  task: string;
  language: string;
  code: string;
  tests: TestCase[];
  bugs: BugReport[];
  coverage: CoverageReport | null;
  iteration: number;
  maxIterations: number;
  status: "coding" | "testing" | "analyzing" | "fixing" | "done" | "failed";
  history: Array<{
    iteration: number;
    code: string;
    testCount: number;
    bugCount: number;
    coverage: number;
  }>;
}

export interface AdversarialConfig {
  coderProvider: LLMProvider;
  testerProvider: LLMProvider;
  coderModel: string;
  testerModel: string;
  systemPrompt?: string;
  tools: AgentTool[];
  llmTools: LLMTool[];
  ctxManager?: ContextManager;
  signal?: AbortSignal;
  maxIterations?: number;
  coverageThreshold?: number; // 默认 0.9
  bugSeverityThreshold?: "critical" | "major" | "minor"; // 默认 "major"
  onEvent?: (event: AgentEvent) => void;
}

// ========== Coder Agent ==========

const CODER_SYSTEM_PROMPT = `你是一个资深软件工程师。你的任务是根据需求编写高质量代码。

规则：
1. 代码要清晰、可维护、有良好注释
2. 遵循最佳实践和设计模式
3. 考虑边界情况和错误处理
4. 如果收到 Bug 报告，精准修复，不要引入新问题
5. 如果收到测试失败报告，分析原因并修复

输出格式：
- 先简要说明你的思路
- 然后输出完整代码
- 代码用 \`\`\`language 包裹`;

async function coderGenerate(
  task: string,
  language: string,
  context: string,
  config: AdversarialConfig,
): Promise<string> {
  const messages: LLMMessage[] = [
    { role: "system", content: config.systemPrompt ?? CODER_SYSTEM_PROMPT },
    { role: "user", content: `任务: ${task}\n语言: ${language}\n\n${context}` },
  ];

  if (config.ctxManager) {
    const prepared = await config.ctxManager.prepare(messages, "coder");
    messages.length = 0;
    messages.push(...prepared.messages);
  }

  let response = "";
  for await (const ev of config.coderProvider.stream({
    model: config.coderModel,
    messages,
    temperature: 0.3,
    signal: config.signal,
  })) {
    if (ev.type === "text_delta") response += ev.text;
  }

  return response;
}

async function coderFix(
  code: string,
  bugs: BugReport[],
  language: string,
  config: AdversarialConfig,
): Promise<string> {
  const bugReports = bugs
    .map((b) => `[${b.severity}] ${b.description}\n复现: ${b.reproduction}${b.suggestedFix ? `\n建议修复: ${b.suggestedFix}` : ""}`)
    .join("\n\n");

  const messages: LLMMessage[] = [
    { role: "system", content: CODER_SYSTEM_PROMPT },
    { role: "user", content: `请修复以下代码中的 Bug:\n\n原始代码:\n\`\`\`${language}\n${code}\n\`\`\`\n\nBug 报告:\n${bugReports}\n\n输出修复后的完整代码。` },
  ];

  let response = "";
  for await (const ev of config.coderProvider.stream({
    model: config.coderModel,
    messages,
    temperature: 0.2,
    signal: config.signal,
  })) {
    if (ev.type === "text_delta") response += ev.text;
  }

  return response;
}

// ========== Tester Agent ==========

const TESTER_SYSTEM_PROMPT = `你是一个资深测试工程师。你的任务是为代码编写全面的测试用例，找出潜在 Bug。

规则：
1. 测试要覆盖正常流程、边界情况、错误处理
2. 使用描述性的测试名称
3. 每个测试用例要独立、可重复
4. 发现 Bug 时，提供清晰的复现步骤
5. 关注：空值处理、类型错误、并发问题、资源泄漏、安全漏洞

输出格式：
- 先分析代码结构和潜在风险点
- 然后输出测试代码
- 最后列出发现的 Bug（如果有）`;

async function testerGenerateTests(
  task: string,
  code: string,
  language: string,
  config: AdversarialConfig,
): Promise<{ tests: TestCase[]; analysis: string }> {
  const messages: LLMMessage[] = [
    { role: "system", content: TESTER_SYSTEM_PROMPT },
    { role: "user", content: `任务: ${task}\n语言: ${language}\n\n代码:\n\`\`\`${language}\n${code}\n\`\`\`\n\n请生成全面的测试用例。输出 JSON 格式:\n{\n  "analysis": "代码分析",\n  "tests": [\n    { "name": "测试名", "code": "测试代码", "type": "unit|integration|edge|regression" }\n  ]\n}` },
  ];

  let response = "";
  for await (const ev of config.testerProvider.stream({
    model: config.testerModel,
    messages,
    temperature: 0.3,
    signal: config.signal,
  })) {
    if (ev.type === "text_delta") response += ev.text;
  }

  try {
    const parsed = JSON.parse(response);
    const tests: TestCase[] = (parsed.tests ?? []).map((t: any, i: number) => ({
      id: `test_${Date.now()}_${i}`,
      name: t.name ?? `Test ${i + 1}`,
      code: t.code,
      type: t.type ?? "unit",
    }));
    return { tests, analysis: parsed.analysis ?? "" };
  } catch {
    // JSON 解析失败，将整个响应作为单个测试
    return {
      tests: [{
        id: `test_${Date.now()}`,
        name: "Generated Test",
        code: response,
        type: "unit",
      }],
      analysis: "测试生成解析失败，使用原始输出",
    };
  }
}

async function testerFindBugs(
  code: string,
  language: string,
  config: AdversarialConfig,
): Promise<BugReport[]> {
  const messages: LLMMessage[] = [
    { role: "system", content: `你是一个资深代码审查员。仔细审查代码，找出所有潜在 Bug。

Bug 严重性定义:
- critical: 会导致崩溃、数据丢失、安全漏洞
- major: 功能错误、逻辑错误、性能问题
- minor: 代码风格、可维护性、小的边界问题

输出 JSON 格式:\n{\n  "bugs": [\n    { "severity": "critical|major|minor", "description": "描述", "reproduction": "复现步骤", "suggestedFix": "修复建议" }\n  ]\n}` },
    { role: "user", content: `审查以下 ${language} 代码:\n\n\`\`\`${language}\n${code}\n\`\`\`` },
  ];

  let response = "";
  for await (const ev of config.testerProvider.stream({
    model: config.testerModel,
    messages,
    temperature: 0.2,
    signal: config.signal,
  })) {
    if (ev.type === "text_delta") response += ev.text;
  }

  try {
    const parsed = JSON.parse(response);
    return (parsed.bugs ?? []).map((b: any, i: number) => ({
      id: `bug_${Date.now()}_${i}`,
      severity: b.severity ?? "major",
      description: b.description ?? "",
      reproduction: b.reproduction ?? "",
      suggestedFix: b.suggestedFix,
    }));
  } catch {
    return [];
  }
}

// ========== 覆盖率分析 ==========

async function analyzeCoverage(
  code: string,
  tests: TestCase[],
  language: string,
  config: AdversarialConfig,
): Promise<CoverageReport> {
  const messages: LLMMessage[] = [
    { role: "system", content: `你是一个测试覆盖率分析专家。分析代码和测试，估算覆盖率并找出未覆盖的部分。

输出 JSON:\n{\n  "totalLines": 数字,\n  "coveredLines": 数字,\n  "coverage": 0-1,\n  "uncoveredFunctions": ["函数名"],\n  "uncoveredBranches": ["分支描述"],\n  "suggestions": ["测试建议"]\n}` },
    { role: "user", content: `代码:\n\`\`\`${language}\n${code}\n\`\`\`\n\n测试:\n${tests.map((t) => `- ${t.name}: ${t.code.slice(0, 200)}`).join("\n")}` },
  ];

  let response = "";
  for await (const ev of config.testerProvider.stream({
    model: config.testerModel,
    messages,
    temperature: 0.2,
    signal: config.signal,
  })) {
    if (ev.type === "text_delta") response += ev.text;
  }

  try {
    const parsed = JSON.parse(response);
    return {
      totalLines: parsed.totalLines ?? 0,
      coveredLines: parsed.coveredLines ?? 0,
      coverage: parsed.coverage ?? 0,
      uncoveredFunctions: parsed.uncoveredFunctions ?? [],
      uncoveredBranches: parsed.uncoveredBranches ?? [],
      suggestions: parsed.suggestions ?? [],
    };
  } catch {
    return {
      totalLines: 0,
      coveredLines: 0,
      coverage: 0,
      uncoveredFunctions: [],
      uncoveredBranches: [],
      suggestions: ["覆盖率分析解析失败"],
    };
  }
}

// ========== 代码提取 ==========

function extractCode(response: string, language: string): string {
  // 提取代码块
  const codeBlockRegex = new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\`\`\``, "i");
  const match = response.match(codeBlockRegex);
  if (match) {
    return match[1].trim();
  }

  // 尝试无语言标记的代码块
  const genericMatch = response.match(/```\n([\s\S]*?)```/);
  if (genericMatch) {
    return genericMatch[1].trim();
  }

  // 如果没有代码块，返回整个响应（可能就是纯代码）
  return response;
}

// ========== 主编排函数 ==========

export async function* adversarialCoding(
  task: string,
  language: string,
  config: AdversarialConfig,
  toolCtx: ToolContext,
): AsyncGenerator<AgentEvent> {
  const maxIterations = config.maxIterations ?? 10;
  const coverageThreshold = config.coverageThreshold ?? 0.9;
  const severityThreshold = config.bugSeverityThreshold ?? "major";

  const state: AdversarialState = {
    task,
    language,
    code: "",
    tests: [],
    bugs: [],
    coverage: null,
    iteration: 0,
    maxIterations,
    status: "coding",
    history: [],
  };

  const emit = (event: AgentEvent) => {
    config.onEvent?.(event);
  };

  yield { type: "status", status: "starting", detail: "对抗式代码迭代模式", ts: Date.now() };

  while (state.iteration < state.maxIterations) {
    if (config.signal?.aborted) {
      yield { type: "status", status: "cancelled", ts: Date.now() };
      yield { type: "done", outcome: "cancelled", result: "cancelled by user", ts: Date.now() };
      return;
    }

    // ========== CODING ==========
    if (state.status === "coding") {
      yield { type: "status", status: "running", detail: `Coder 生成代码 (迭代 ${state.iteration + 1})`, ts: Date.now() };

      const context = state.iteration === 0
        ? ""
        : `历史迭代:\n${state.history.map((h) => `- 迭代 ${h.iteration}: ${h.bugCount} 个 Bug, 覆盖率 ${(h.coverage * 100).toFixed(1)}%`).join("\n")}\n\n${state.bugs.length > 0 ? `待修复 Bug:\n${state.bugs.map((b) => `[${b.severity}] ${b.description}`).join("\n")}` : ""}`;

      const response = state.iteration === 0
        ? await coderGenerate(state.task, state.language, context, config)
        : await coderFix(state.code, state.bugs, state.language, config);

      state.code = extractCode(response, state.language);
      state.status = "testing";

      yield { type: "output", kind: "text", text: `✅ 代码${state.iteration === 0 ? "生成" : "修订"}完成 (${state.code.split("\n").length} 行)`, ts: Date.now() };
    }

    // ========== TESTING ==========
    if (state.status === "testing") {
      yield { type: "status", status: "running", detail: "Tester 生成测试", ts: Date.now() };

      // 生成测试
      const { tests, analysis } = await testerGenerateTests(state.task, state.code, state.language, config);
      state.tests = tests;

      yield { type: "output", kind: "thinking", text: `🧪 测试分析: ${analysis}\n生成 ${tests.length} 个测试用例`, ts: Date.now() };

      // 查找 Bug
      yield { type: "status", status: "thinking", detail: "Tester 查找 Bug", ts: Date.now() };
      state.bugs = await testerFindBugs(state.code, state.language, config);

      // 分析覆盖率
      yield { type: "status", status: "thinking", detail: "分析测试覆盖率", ts: Date.now() };
      state.coverage = await analyzeCoverage(state.code, state.tests, state.language, config);

      yield { type: "output", kind: "thinking", text: `📊 覆盖率: ${(state.coverage.coverage * 100).toFixed(1)}%\n🐛 Bug: ${state.bugs.length} 个 (严重: ${state.bugs.filter((b) => b.severity === "critical").length}, 重要: ${state.bugs.filter((b) => b.severity === "major").length})`, ts: Date.now() };

      state.status = "analyzing";
    }

    // ========== ANALYZING ==========
    if (state.status === "analyzing") {
      // 记录历史
      state.history.push({
        iteration: state.iteration + 1,
        code: state.code,
        testCount: state.tests.length,
        bugCount: state.bugs.length,
        coverage: state.coverage?.coverage ?? 0,
      });

      // 判断是否完成
      const criticalBugs = state.bugs.filter((b) => b.severity === "critical");
      const majorBugs = state.bugs.filter((b) => b.severity === "major");
      const hasBlockingBugs = severityThreshold === "critical"
        ? criticalBugs.length > 0
        : severityThreshold === "major"
          ? criticalBugs.length + majorBugs.length > 0
          : state.bugs.length > 0;

      const coverageOk = (state.coverage?.coverage ?? 0) >= coverageThreshold;
      const bugsOk = !hasBlockingBugs;

      if (coverageOk && bugsOk) {
        state.status = "done";
      } else {
        state.status = "fixing";
        yield { type: "output", kind: "thinking", text: `🔄 需要继续迭代: ${!coverageOk ? `覆盖率不足 (${((state.coverage?.coverage ?? 0) * 100).toFixed(1)}% < ${(coverageThreshold * 100).toFixed(1)}%)` : ""} ${!bugsOk ? `还有 ${hasBlockingBugs ? "阻塞性" : ""} Bug` : ""}`, ts: Date.now() };
      }
    }

    // ========== FIXING ==========
    if (state.status === "fixing") {
      state.status = "coding"; // 回到 Coding 阶段
    }

    state.iteration++;
  }

  // ========== DONE ==========
  const finalResult = generateReport(state);

  yield { type: "output", kind: "text", text: finalResult, ts: Date.now() };
  yield { type: "status", status: "success", ts: Date.now() };
  yield {
    type: "done",
    outcome: state.status === "done" ? "success" : "max_turns",
    result: finalResult,
    ts: Date.now(),
  };
}

// ========== 报告生成 ==========

function generateReport(state: AdversarialState): string {
  const lines: string[] = [];

  lines.push("# 对抗式代码迭代报告\n");
  lines.push(`## 任务\n${state.task}\n`);
  lines.push(`## 迭代次数\n${state.iteration} / ${state.maxIterations}\n`);

  lines.push("## 最终代码");
  lines.push(`\`\`\`${state.language}\n${state.code}\n\`\`\`\n`);

  lines.push(`## 测试用例 (${state.tests.length} 个)`);
  for (const test of state.tests) {
    lines.push(`- **${test.name}** [${test.type}]`);
  }
  lines.push("");

  if (state.bugs.length > 0) {
    lines.push(`## 剩余 Bug (${state.bugs.length} 个)`);
    for (const bug of state.bugs) {
      lines.push(`- [${bug.severity}] ${bug.description}`);
      if (bug.suggestedFix) lines.push(`  - 建议: ${bug.suggestedFix}`);
    }
    lines.push("");
  }

  if (state.coverage) {
    lines.push("## 覆盖率报告");
    lines.push(`- 总行数: ${state.coverage.totalLines}`);
    lines.push(`- 覆盖行数: ${state.coverage.coveredLines}`);
    lines.push(`- 覆盖率: ${(state.coverage.coverage * 100).toFixed(1)}%`);
    if (state.coverage.uncoveredFunctions.length > 0) {
      lines.push(`- 未覆盖函数: ${state.coverage.uncoveredFunctions.join(", ")}`);
    }
    if (state.coverage.suggestions.length > 0) {
      lines.push("- 建议:");
      for (const s of state.coverage.suggestions) {
        lines.push(`  - ${s}`);
      }
    }
    lines.push("");
  }

  lines.push("## 迭代历史");
  for (const h of state.history) {
    lines.push(`- 迭代 ${h.iteration}: ${h.testCount} 个测试, ${h.bugCount} 个 Bug, 覆盖率 ${(h.coverage * 100).toFixed(1)}%`);
  }

  return lines.join("\n");
}
