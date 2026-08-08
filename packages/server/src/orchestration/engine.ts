import type {
  AgentConfig,
  AgentTaskInput,
  Job,
  Run,
  Task,
  TaskInput,
} from "@multiagent/shared";
import { Store } from "./store";
import { AdapterRegistry } from "../adapters/registry";
import { WsHub } from "../api/ws/hub";
import { newId } from "../util/id";
import { logger } from "../util/logger";
import { SingleMode } from "./single";
import { WorkflowMode } from "./workflow";
import { ChatMode } from "./chat";

/**
 * 编排引擎：统一执行器。
 * - executeJob：跑单个 agent job，逐条落库 + 广播，汇总结论
 * - 三种模式（single/workflow/chat）都通过 executeJob 执行
 * - 取消：每个 job 持 AbortController，run 级注册表统一 abort
 */
export class OrchestrationEngine {
  private runAborts = new Map<string, Set<AbortController>>();
  private agentChains = new Map<string, Promise<unknown>>();
  private agentConfigs = new Map<string, AgentConfig>();

  constructor(
    private store: Store,
    private registry: AdapterRegistry,
    private hub: WsHub,
    private getWorkflowDef?: (id: string) => import("@multiagent/shared").WorkflowDef | undefined,
  ) {}

  setAgents(agents: AgentConfig[]): void {
    this.agentConfigs = new Map(agents.map((a) => [a.id, a]));
  }

  getAgentName(agentId: string): string {
    return this.agentConfigs.get(agentId)?.name ?? agentId;
  }

  /** 创建任务并立即执行，返回新 Run */
  async createAndExecuteTask(title: string, input: TaskInput): Promise<Run> {
    const task: Task = {
      id: newId("task"),
      title,
      mode: input.mode,
      input,
      createdAt: new Date().toISOString(),
    };
    this.store.createTask(task);
    return this.executeTask(task);
  }

  /** 启动一次执行（异步执行，立即返回 queued 的 Run） */
  executeTask(task: Task): Run {
    const run: Run = {
      id: newId("run"),
      taskId: task.id,
      mode: task.mode,
      status: "queued",
      startedAt: new Date().toISOString(),
      taskTitle: task.title,
    };
    this.store.createRun(run);
    // 状态帧（run.status）不落库，seq 用 0（事件去重只依赖 agent.event 的原子 seq）
    this.hub.broadcast(run.id, 0, { type: "run.status", status: "queued" });
    void this.runAsync(run, task);
    return run;
  }

  private async runAsync(run: Run, task: Task): Promise<void> {
    this.store.updateRun(run.id, { status: "running" });
    this.hub.broadcast(run.id, 0, { type: "run.status", status: "running" });

    const aborts = new Set<AbortController>();
    this.runAborts.set(run.id, aborts);

    try {
      const mode = task.mode;
      const result = await (mode === "single"
        ? new SingleMode(this).run(run, task)
        : mode === "workflow"
          ? new WorkflowMode(this).run(run, task)
          : new ChatMode(this).run(run, task));

      this.store.updateRun(run.id, { status: "success", finalResult: result, endedAt: new Date().toISOString() });
      this.hub.broadcast(run.id, 0, { type: "run.status", status: "success" });
      this.hub.broadcast(run.id, 0, { type: "run.result", result: result ?? "" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cancelled = [...aborts].some((a) => a.signal.aborted);
      const status = cancelled ? "cancelled" : "error";
      this.store.updateRun(run.id, {
        status,
        error: cancelled ? "cancelled by user" : message,
        endedAt: new Date().toISOString(),
      });
      this.hub.broadcast(run.id, 0, { type: "run.status", status });
      this.hub.broadcast(run.id, 0, {
        type: "run.error",
        message: cancelled ? "cancelled by user" : message,
      });
      if (!cancelled) logger.error("run failed", { run: run.id, message });
    } finally {
      this.runAborts.delete(run.id);
    }
  }

  /**
   * 执行一个 job：创建 → 落库 → 逐条广播事件 → 汇总。
   * 同一 agent 的 job 串行（防单实例打爆），不同 agent 并行。
   */
  async executeJob(
    run: Run,
    agentId: string,
    prompt: string,
    input: Omit<AgentTaskInput, "prompt" | "signal"> = {},
    parentJobId?: string,
  ): Promise<Job> {
    return this.withAgentLock(agentId, async () => {
      const seq = this.store.nextJobSeq(run.id);

      const job: Job = {
        id: newId("job"),
        runId: run.id,
        seq,
        agentId,
        agentName: this.getAgentName(agentId),
        prompt,
        status: "queued",
        events: [],
        parentJobId,
        startedAt: new Date().toISOString(),
      };
      this.store.createJob(job);
      this.hub.broadcast(run.id, 0, {
        type: "job.status",
        jobId: job.id,
        agentId,
        status: "queued",
      });

      const controller = new AbortController();
      this.runAborts.get(run.id)?.add(controller);
      const cleanup = () => this.runAborts.get(run.id)?.delete(controller);

      this.store.updateJob(job.id, { status: "running" });
      this.hub.broadcast(run.id, 0, {
        type: "job.status",
        jobId: job.id,
        agentId,
        status: "running",
      });

      const adapter = this.registry.get(agentId);
      try {
        for await (const ev of adapter.startTask({
          ...input,
          prompt,
          signal: controller.signal,
        })) {
          // 原子分配 seq（MAX+1 与 INSERT 在同一同步块，并行 job 不冲突）
          const seq = this.store.appendRunEvent(run.id, job.id, ev);
          this.hub.broadcast(
            run.id,
            seq,
            { type: "agent.event", jobId: job.id, agentId, event: ev },
            job.id,
          );
          job.events.push(ev);
          if (ev.type === "done") {
            job.status =
              ev.outcome === "success"
                ? "success"
                : ev.outcome === "cancelled"
                  ? "cancelled"
                  : "error";
            job.result = ev.result;
            job.usage = ev.usage;
            job.sessionId = ev.sessionId;
            job.endedAt = new Date().toISOString();
          } else if (ev.type === "error") {
            job.error = ev.message;
          }
        }
        if (!job.endedAt) {
          job.status = "error";
          job.error = "agent stream ended without a done event";
          job.endedAt = new Date().toISOString();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (controller.signal.aborted) {
          job.status = "cancelled";
          job.error = "cancelled";
        } else {
          job.status = "error";
          job.error = message;
        }
        job.endedAt = new Date().toISOString();
        job.events.push({ type: "error", message, ts: Date.now() });
      } finally {
        cleanup();
      }

      this.store.updateJob(job.id, {
        status: job.status,
        result: job.result,
        usage: job.usage,
        sessionId: job.sessionId,
        error: job.error,
        endedAt: job.endedAt,
      });
      this.hub.broadcast(run.id, 0, {
        type: "job.status",
        jobId: job.id,
        agentId,
        status: job.status,
      });
      return job;
    });
  }

  cancelRun(runId: string): void {
    const aborts = this.runAborts.get(runId);
    if (!aborts) return;
    for (const ac of aborts) ac.abort();
  }

  /** 查找工作流定义（供 WorkflowMode 调度） */
  getWorkflow(id: string) {
    if (this.getWorkflowDef) return this.getWorkflowDef(id);
    return this.store.getWorkflow(id);
  }

  /** 该 agent 在本 run 中的最近一次 session（供 chat 跨轮 resume） */
  getLatestSessionId(runId: string, agentId: string): string | undefined {
    return this.store.getLatestJobForAgent(runId, agentId)?.sessionId;
  }

  /** 持久化并广播一条群聊消息 */
  broadcastChatMessage(
    runId: string,
    jobId: string | undefined,
    agentId: string,
    role: "user" | "assistant",
    content: string,
  ): void {
    this.store.createChatMessage({
      id: newId("msg"),
      runId,
      jobId,
      agentId,
      role,
      content,
      ts: new Date().toISOString(),
    });
    this.hub.broadcast(runId, 0, {
      type: "chat.message",
      jobId: jobId ?? "",
      agentId,
      content,
    });
  }

  private withAgentLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.agentChains.get(agentId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.agentChains.set(agentId, next.catch(() => {}));
    return next;
  }
}
