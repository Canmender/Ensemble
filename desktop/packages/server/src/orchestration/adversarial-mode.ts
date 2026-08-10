/**
 * 对抗模式编排器
 *
 * 实现 Coder vs Tester 对抗迭代
 */

import type { Run, Task, AgentEvent, Job } from "@ensemble/shared";
import type { OrchestrationEngine } from "./engine";
import { adversarialCoding } from "./adversarial";
import { logger } from "../util/logger";

export class AdversarialMode {
  constructor(private engine: OrchestrationEngine) {}

  async run(run: Run, task: Task): Promise<string> {
    const input = task.input;
    if (input.mode !== "adversarial") throw new Error("Invalid mode for AdversarialMode");

    const coderAgentId = input.coderAgentId;
    const testerAgentId = input.testerAgentId;
    const coderAdapter = this.engine.getRegistry().get(coderAgentId);
    const testerAdapter = this.engine.getRegistry().get(testerAgentId);

    // 创建 Job
    const job: Job = {
      id: `job-${Date.now()}`,
      runId: run.id,
      seq: 1,
      agentId: coderAgentId,
      agentName: `${this.engine.getAgentName(coderAgentId)} vs ${this.engine.getAgentName(testerAgentId)}`,
      prompt: input.prompt,
      status: "running",
      events: [],
      startedAt: new Date().toISOString(),
    };

    this.engine.getStore().createJob(job);
    this.engine.getHub().broadcast(run.id, 0, {
      type: "job.status",
      jobId: job.id,
      agentId: coderAgentId,
      status: "running",
    });

    const controller = new AbortController();
    this.engine.getRunAborts().get(run.id)?.add(controller);

    try {
      // 获取 Provider
      const coderConfig = this.engine.getAgentConfig(coderAgentId);
      const testerConfig = this.engine.getAgentConfig(testerAgentId);
      const coderProvider = this.engine.getProviderRegistry().get(coderConfig?.providerId ?? "");
      const testerProvider = this.engine.getProviderRegistry().get(testerConfig?.providerId ?? "");

      if (!coderProvider || !testerProvider) {
        throw new Error("Provider not configured for coder or tester agent");
      }

      // 获取工具
      const tools = this.engine.getToolRegistry()?.forNames(
        [...(coderConfig?.tools ?? []), ...(testerConfig?.tools ?? [])]
      ) ?? [];

      const llmTools = tools.map((t: any) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));

      // 执行对抗迭代
      const config = {
        coderProvider,
        testerProvider,
        coderModel: coderConfig?.model ?? "",
        testerModel: testerConfig?.model ?? "",
        tools,
        llmTools,
        signal: controller.signal,
        maxIterations: input.maxIterations ?? 10,
        coverageThreshold: input.coverageThreshold ?? 0.9,
        onEvent: (event: AgentEvent) => {
          const seq = this.engine.getStore().appendRunEvent(run.id, job.id, event);
          this.engine.getHub().broadcast(run.id, seq, {
            type: "agent.event",
            jobId: job.id,
            agentId: coderAgentId,
            event,
          });
          job.events.push(event);
        },
      };

      const toolCtx = {
        cwd: coderConfig?.cwd,
        signal: controller.signal,
        agentId: coderAgentId,
      };

      let finalResult = "";
      for await (const event of adversarialCoding(input.prompt, input.language, config, toolCtx)) {
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
        agentId: coderAgentId,
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
        agentId: coderAgentId,
        status: "error",
      });

      throw err;
    } finally {
      this.engine.getRunAborts().get(run.id)?.delete(controller);
    }
  }
}
