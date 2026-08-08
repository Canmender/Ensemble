import type { Run, Task, WorkflowDef, WorkflowEdge, WorkflowNode } from "@multiagent/shared";
import { OrchestrationEngine } from "./engine";
import { logger } from "../util/logger";

/**
 * Mode 2 — 工作流编排（DAG）：
 * - 校验节点/边合法、无环（Kahn 拓扑）
 * - 按依赖并行调度：每轮执行所有"依赖已终态"的节点
 * - 模板注入：{{task.prompt}} / {{job.<id>.result}}
 * - 边条件：on_success / on_failure / if_output_matches
 */
export class WorkflowMode {
  constructor(private engine: OrchestrationEngine) {}

  async run(run: Run, task: Task): Promise<string> {
    if (task.input.mode !== "workflow") throw new Error("task is not workflow mode");
    const def = this.engine.getWorkflow(task.input.workflowId);
    if (!def) throw new Error(`workflow not found: ${task.input.workflowId}`);

    const { inEdges, outEdges } = buildGraph(def);
    const { nodeById } = collect(def);
    assertAcyclic(def);

    const results = new Map<string, string>();
    const errors = new Map<string, string>();
    const state = new Map<string, string>(); // id → success | error | cancelled | skipped
    const pending = new Set(def.nodes.map((n) => n.id));

    while (pending.size > 0) {
      // 当前就绪：所有前驱已到达终态（在 state 中）
      const ready = [...pending].filter((id) =>
        (inEdges.get(id) ?? []).every((e) => state.has(e.from)),
      );
      if (ready.length === 0) {
        // 死锁：依赖无法满足（例如某节点被永久 skip）
        for (const id of pending) errors.set(id, "blocked by unmet dependencies");
        break;
      }

      const jobs = await Promise.all(
        ready.map((id) =>
          this.execNode(run, def, nodeById.get(id)!, inEdges, results, errors, state, task),
        ),
      );
      for (const id of ready) pending.delete(id);
      void jobs;
    }

    // 汇点节点（无出边）的结果作为 run 结果
    const terminal = def.nodes
      .filter((n) => (outEdges.get(n.id) ?? []).length === 0)
      .map((n) => results.get(n.id))
      .filter(Boolean);

    if (terminal.length) return terminal[terminal.length - 1]!;

    if (errors.size > 0) throw new Error([...errors.values()].join("\n"));
    return "workflow completed with no terminal result";
  }

  private async execNode(
    run: Run,
    _def: WorkflowDef,
    node: WorkflowNode,
    inEdges: Map<string, WorkflowEdge[]>,
    results: Map<string, string>,
    errors: Map<string, string>,
    state: Map<string, string>,
    task: Task,
  ): Promise<void> {
    for (const e of inEdges.get(node.id) ?? []) {
      const upState = state.get(e.from);
      const upResult = results.get(e.from);
      if (!edgeSatisfied(e, upState, upResult)) {
        state.set(node.id, "skipped");
        logger.debug(`node ${node.id} skipped (edge ${e.from}→${node.id})`);
        return;
      }
    }

    const prompt = renderTemplate(node.prompt, task, results);
    const job = await this.engine.executeJob(run, node.agentId, prompt);

    state.set(node.id, job.status);
    if (job.status === "success") {
      results.set(node.id, job.result ?? "");
    } else {
      errors.set(node.id, `${node.id} (${node.agentId}): ${job.error ?? job.result ?? "failed"}`);
    }
  }
}

function collect(def: WorkflowDef): { nodeById: Map<string, WorkflowNode> } {
  return { nodeById: new Map(def.nodes.map((n) => [n.id, n])) };
}

function buildGraph(def: WorkflowDef): {
  inEdges: Map<string, WorkflowEdge[]>;
  outEdges: Map<string, WorkflowEdge[]>;
} {
  const inEdges = new Map<string, WorkflowEdge[]>();
  const outEdges = new Map<string, WorkflowEdge[]>();
  for (const n of def.nodes) {
    inEdges.set(n.id, []);
    outEdges.set(n.id, []);
  }
  for (const e of def.edges) {
    if (!inEdges.has(e.from) || !inEdges.has(e.to)) {
      throw new Error(`workflow edge references unknown node: ${e.from} → ${e.to}`);
    }
    inEdges.get(e.to)!.push(e);
    outEdges.get(e.from)!.push(e);
  }
  return { inEdges, outEdges };
}

/** 邻接表 + DFS 三色标记，检测环；无入边的孤立节点不计 */
function assertAcyclic(def: WorkflowDef): void {
  const adj = new Map<string, string[]>();
  for (const n of def.nodes) adj.set(n.id, []);
  for (const e of def.edges) adj.get(e.from)!.push(e.to);

  const state = new Map<string, 0 | 1 | 2>(); // 0=未访问 1=在栈中 2=已完成
  const hasCycle = (id: string): boolean => {
    const s = state.get(id) ?? 0;
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    for (const next of adj.get(id) ?? []) {
      if (hasCycle(next)) return true;
    }
    state.set(id, 2);
    return false;
  };

  for (const n of def.nodes) {
    if (hasCycle(n.id)) throw new Error(`workflow contains a cycle`);
  }
}

/** 判定一条边是否满足触发条件 */
function edgeSatisfied(e: WorkflowEdge, upState: string | undefined, upResult: string | undefined): boolean {
  if (e.when === "on_success") return upState === "success";
  if (e.when === "on_failure") return upState !== "success" && upState !== "cancelled" && !!upState;
  if (typeof e.when === "object" && e.when.type === "if_output_matches") {
    if (upState !== "success") return false;
    try {
      return new RegExp(e.when.regex).test(upResult ?? "");
    } catch {
      return true;
    }
  }
  return true;
}

function renderTemplate(tpl: string, task: Task, results: Map<string, string>): string {
  const taskPrompt = task.input.mode === "workflow" ? task.input.prompt : "";
  return tpl
    .replace(/\{\{task\.prompt\}\}/g, taskPrompt)
    .replace(/\{\{job\.([\w-]+)\.result\}\}/g, (_m, id: string) => results.get(id) ?? "");
}
