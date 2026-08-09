import type { Run, Task } from "@ensemble/shared";
import { OrchestrationEngine } from "./engine";
import { logger } from "../util/logger";

/**
 * Mode 1 — 单一任务分发：
 * - 单 agent：结果直接作为 run 结果
 * - 多 agent：并行执行，可选 aggregator 汇总；否则分隔拼接
 */
export class SingleMode {
  constructor(private engine: OrchestrationEngine) {}

  async run(run: Run, task: Task): Promise<string> {
    if (task.input.mode !== "single") throw new Error("task is not single mode");
    const { prompt, agentIds, aggregate, aggregatorAgentId } = task.input;

    const jobs = await Promise.all(
      agentIds.map((agentId) => this.engine.executeJob(run, agentId, prompt)),
    );

    const results = jobs
      .filter((j) => j.status === "success" && j.result)
      .map((j) => j.result ?? "");

    // 全部失败 → 抛错（run 置 error）
    if (results.length === 0) {
      const errors = jobs.filter((j) => j.error).map((j) => `${j.agentName}: ${j.error}`).join("\n");
      throw new Error(errors || "all agents failed");
    }

    // 多 agent + 显式汇总
    if (agentIds.length > 1 && aggregate) {
      const aggregator = aggregatorAgentId ?? "claude-coder";
      const context = results.map((r, i) => `--- Result ${i + 1} ---\n${r}`).join("\n\n");
      logger.info(`aggregating ${results.length} results with ${aggregator}`);
      const aggJob = await this.engine.executeJob(
        run,
        aggregator,
        "Aggregate the following N agent results into one coherent report. Preserve key facts, sources and structure.",
        { context },
      );
      if (aggJob.status === "success") return aggJob.result ?? "";
      return results.join("\n\n---\n\n");
    }

    // 单 agent 或多 agent 拼接
    if (results.length === 1) return results[0];
    return results
      .map((r, i) => `--- ${agentIds[i] ?? `Result ${i + 1}`} ---\n${r}`)
      .join("\n\n");
  }
}
