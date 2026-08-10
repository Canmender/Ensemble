/**
 * Plan 模式编排器
 *
 * 实现 Plan-Execute-Reflect 三阶段循环
 */

import type { Run, Task, AgentEvent, Job } from "@ensemble/shared";
import type { OrchestrationEngine } from "./engine";
import type { AgentAdapter } from "../adapters/types";
import { planExecuteReflect } from "./plan-execute-reflect";
import { logger } from "../util/logger";
import { newId } from "../util/id";

export class PlanMode {
  constructor(private engine: OrchestrationEngine) {}

  async run(run: Run, task: Task): Promise<string> {
    const input = task.input;
    if (input.mode !== "plan") throw new Error("Invalid mode for PlanMode");

    const agentId = input.agentId;
    const adapter = this.engine.getRegistry().get(agentId);

    // 创建一个 Job 来跟踪整个 Plan-Execute-Reflect 过程
    const job: Job = {
      id: newId("job"),
      runId: run.id,
      seq: 1,
      agentId,
      agentName: this.engine.getAgentName(agentId),
      prompt: input.prompt,
      status: "running",
      events: [],
      startedAt: new Date().toISOString(),
    };

    this.engine.getStore().createJob(job);
    this.engine.getHub().broadcast(run.id, 0, {
      type: "job.status",
      jobId: job.id,
      agentId,
      status: "running",
    });

    const controller = new AbortController();
    this.engine.getRunAborts().get(run.id)?.add(controller);

    try {
      // 获取工具列表
      const tools = this.engine.getToolRegistry()?.forNames(
        this.engine.getAgentConfig(agentId)?.tools ?? []
      ) ?? [];

      const llmTools = tools.map((t: any) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));

      // 执行 Plan-Execute-Reflect
      const config = {
        provider: this.engine.getProviderRegistry().get(
          this.engine.getAgentConfig(agentId)?.providerId ?? ""
        )!,
        model: this.engine.getAgentConfig(agentId)?.model ?? "",
        systemPrompt: this.engine.getAgentConfig(agentId)?.systemPrompt,
        tools,
        llmTools,
        signal: controller.signal,
        maxIterations: input.maxIterations ?? 5,
        qualityThreshold: input.qualityThreshold ?? 0.85,
        onEvent: (event: AgentEvent) => {
          // 广播事件
          const seq = this.engine.getStore().appendRunEvent(run.id, job.id, event);
          this.engine.getHub().broadcast(run.id, seq, {
            type: "agent.event",
            jobId: job.id,
            agentId,
            event,
          });
          job.events.push(event);
        },
      };

      const toolCtx = {
        cwd: this.engine.getAgentConfig(agentId)?.cwd,
        signal: controller.signal,
        agentId,
      };

      let finalResult = "";
      for await (const event of planExecuteReflect(input.prompt, [], config, toolCtx)) {
        if (event.type === "done") {
          finalResult = event.result ?? "";
          job.status = event.outcome === "success" ? "success" : "error";
          job.result = finalResult;
        }
      }

      // 更新 Job 状态
      job.endedAt = new Date().toISOString();
      this.engine.getStore().updateJob(job.id, {
        status: job.status,
        result: job.result,
        endedAt: job.endedAt,
      });
      this.engine.getHub().broadcast(run.id, 0, {
        type: "job.status",
        jobId: job.id,
        agentId,
        status: job.status,
      });

      return finalResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      job.status = "error";
      job.error = message;
      job.endedAt = new Date().toISOString();

      this.engine.getStore().updateJob(job.id, {
        status: "error",
        error: message,
        endedAt: job.endedAt,
      });
      this.engine.getHub().broadcast(run.id, 0, {
        type: "job.status",
        jobId: job.id,
        agentId,
        status: "error",
      });

      throw err;
    } finally {
      this.engine.getRunAborts().get(run.id)?.delete(controller);
    }
  }
}
