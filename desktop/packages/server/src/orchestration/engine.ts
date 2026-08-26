import type {
  AgentConfig,
  AgentEvent,
  AgentTaskInput,
  Job,
  MessageAttachment,
  Run,
  Task,
  TaskInput,
} from "@ensemble/shared";
import type { SteeringMessage } from "../adapters/types";
import type { EventSink } from "../plugins/events";
import { Store } from "./store";
import { AdapterRegistry } from "../adapters/registry";
import { WsHub } from "../api/ws/hub";
import { newId } from "../util/id";
import { logger } from "../util/logger";
import { SingleMode } from "./single";
import { WorkflowMode } from "./workflow";
import { ChatMode } from "./chat";
import { PlanMode } from "./plan";
import { AdversarialMode } from "./adversarial-mode";

/**
 * 编排引擎：统一执行器。
 * - executeJob：跑单个 agent job，逐条落库 + 广播，汇总结论
 * - 三种模式（single/workflow/chat）都通过 executeJob 执行
 * - 取消：每个 job 持 AbortController，run 级注册表统一 abort
 * - steering：用户在 agent 运行中注入消息（参考 OpenClaw）
 */
export class OrchestrationEngine {
  private runAborts = new Map<string, Set<AbortController>>();
  private agentChains = new Map<string, Promise<unknown>>();
  private agentConfigs = new Map<string, AgentConfig>();
  /** Steering 消息队列：runId → 待注入消息 */
  private steeringQueues = new Map<string, SteeringMessage[]>();
  /** run 级取消标记：取消后不再启动新 job（取消是"粘性"的） */
  private cancelledRuns = new Set<string>();

  constructor(
    private store: Store,
    private registry: AdapterRegistry,
    private hub: WsHub,
    private getWorkflowDef?: (id: string) => import("@ensemble/shared").WorkflowDef | undefined,
    /** 事件总线（R3 解耦）：设置后 chat/message 走 emit，hub 直调退役 */
    private events?: EventSink,
  ) {}

  setAgents(agents: AgentConfig[]): void {
    this.agentConfigs = new Map(agents.map((a) => [a.id, a]));
  }

  getAgentName(agentId: string): string {
    return this.agentConfigs.get(agentId)?.name ?? agentId;
  }

  /** 创建任务并立即执行，返回新 Run（userId 用于多用户数据隔离） */
  async createAndExecuteTask(title: string, input: TaskInput, userId?: string): Promise<Run> {
    const task: Task = {
      id: newId("task"),
      title,
      mode: input.mode,
      input,
      userId,
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
      userId: task.userId,
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
          : mode === "plan"
            ? new PlanMode(this).run(run, task)
            : mode === "adversarial"
              ? new AdversarialMode(this).run(run, task)
              : new ChatMode(this).run(run, task));

      // 执行期间被取消（各模式可能正常返回）→ 统一标记 cancelled，不覆盖为 success
      if (this.cancelledRuns.has(run.id)) {
        throw Object.assign(new Error("run cancelled"), { code: "RUN_CANCELLED" });
      }

      this.store.updateRun(run.id, { status: "success", finalResult: result, endedAt: new Date().toISOString() });
      this.hub.broadcast(run.id, 0, { type: "run.status", status: "success" });
      this.hub.broadcast(run.id, 0, { type: "run.result", result: result ?? "" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cancelled =
        [...aborts].some((a) => a.signal.aborted) ||
        (err as { code?: string })?.code === "RUN_CANCELLED" ||
        this.cancelledRuns.has(run.id);
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
      this.cleanupSteering(run.id);
      this.cancelledRuns.delete(run.id);
      this.store.cleanupRunSeqCounters(run.id);
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
      // run 已取消：不再启动新 job（取消是 run 级终态）
      if (this.cancelledRuns.has(run.id)) {
        const err = new Error("run cancelled") as Error & { code?: string };
        err.code = "RUN_CANCELLED";
        throw err;
      }

      const seq = this.store.nextJobSeq(run.id);

      const job: Job = {
        id: newId("job"),
        runId: run.id,
        seq,
        userId: run.userId,
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
          runId: run.id,
          steeringQueue: this.getSteeringQueue(run.id),
        })) {
          // 原子分配 seq（MAX+1 与 INSERT 在同一同步块，并行 job 不冲突）
          const seq = this.store.appendRunEvent(run.id, job.id, ev, run.userId);
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
        const cancelled =
          controller.signal.aborted ||
          (err as { code?: string })?.code === "RUN_CANCELLED" ||
          this.cancelledRuns.has(run.id);
        job.status = cancelled ? "cancelled" : "error";
        job.error = cancelled ? "cancelled" : message;
        job.endedAt = new Date().toISOString();
        // 错误/取消帧落库并广播，保持内存态与持久态一致（重连补拉不缺帧）
        const errEv: AgentEvent = {
          type: "error",
          message: cancelled ? "cancelled" : message,
          ts: Date.now(),
        };
        job.events.push(errEv);
        const eseq = this.store.appendRunEvent(run.id, job.id, errEv, run.userId);
        this.hub.broadcast(run.id, eseq, { type: "agent.event", jobId: job.id, agentId, event: errEv }, job.id);
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
    // run 级取消标记：后续 executeJob 检查后不再启动新 job（取消是"粘性"的）
    this.cancelledRuns.add(runId);
    const aborts = this.runAborts.get(runId);
    if (aborts) {
      for (const ac of aborts) ac.abort();
    }
    // 通知涉及 adapter 终止子进程（local agent 等），避免孤儿进程
    for (const job of this.store.getJobs(runId)) {
      try {
        this.registry.get(job.agentId)?.cancel();
      } catch {
        /* adapter 取消失败不影响主流程 */
      }
    }
  }

  /** 该 run 是否已被取消（供编排模式提前终止） */
  isRunCancelled(runId: string): boolean {
    return this.cancelledRuns.has(runId);
  }

  /**
   * 注入 steering 消息（参考 OpenClaw）：
   * 用户在 agent 运行中发送的消息，会在下一个检查点注入上下文。
   */
  addSteering(runId: string, content: string): void {
    // 仅对活跃（queued/running）run 注入；已结束/已取消的 run 忽略，避免队列永久泄漏
    const run = this.store.getRun(runId);
    if (!run || (run.status !== "queued" && run.status !== "running")) return;
    let queue = this.steeringQueues.get(runId);
    if (!queue) {
      queue = [];
      this.steeringQueues.set(runId, queue);
    }
    queue.push({ content, timestamp: Date.now() });
    logger.info(`steering message queued for run ${runId}: ${content.slice(0, 50)}...`);
  }

  /** 获取指定 run 的 steering 队列（供 executor 消费） */
  getSteeringQueue(runId: string): SteeringMessage[] {
    let queue = this.steeringQueues.get(runId);
    if (!queue) {
      queue = [];
      this.steeringQueues.set(runId, queue);
    }
    return queue;
  }

  /** 清理 steering 队列 */
  private cleanupSteering(runId: string): void {
    this.steeringQueues.delete(runId);
  }

  /** 查找工作流定义（供 WorkflowMode 调度） */
  getWorkflow(id: string) {
    if (this.getWorkflowDef) return this.getWorkflowDef(id);
    return this.store.getWorkflow(id);
  }

  // ========== Getter 方法（供 PlanMode 等编排器使用） ==========

  getStore(): Store {
    return this.store;
  }

  getHub(): WsHub {
    return this.hub;
  }

  getRegistry(): AdapterRegistry {
    return this.registry;
  }

  getRunAborts(): Map<string, Set<AbortController>> {
    return this.runAborts;
  }

  getProviderRegistry(): any {
    return (this.registry as any).deps?.providerRegistry;
  }

  getToolRegistry(): any {
    return (this.registry as any).deps?.toolRegistry;
  }

  getAgentConfig(agentId: string): AgentConfig | undefined {
    return this.agentConfigs.get(agentId);
  }

  /** 该 agent 在本 run 中的最近一次 session（供 chat 跨轮 resume） */
  getLatestSessionId(runId: string, agentId: string): string | undefined {
    return this.store.getLatestJobForAgent(runId, agentId)?.sessionId;
  }

  /** 持久化并广播一条群聊消息（opts.id = 客户端幂等 ID；重复投递静默丢弃，不重复推送） */
  broadcastChatMessage(
    runId: string,
    jobId: string | undefined,
    agentId: string,
    role: "user" | "assistant",
    content: string,
    attachment?: MessageAttachment,
    opts?: { id?: string },
  ): void {
    const run = this.store.getRun(runId);
    const id = opts?.id ?? newId("msg");
    const seq = this.store.createChatMessage({
      id,
      runId,
      jobId,
      agentId,
      role,
      content,
      attachment,
      userId: run?.userId,
      ts: new Date().toISOString(),
    });
    // 幂等命中（同 clientMsgId 重发）：消息已在库，跳过会话元数据更新与广播
    if (seq === null) return;
    // 更新关联会话元数据：lastMessage；agent 回复增加未读计数
    const conv = this.store.getConversationByRunId(runId);
    if (conv) {
      this.store.updateConversationMeta(conv.id, content, new Date().toISOString());
      if (role === "assistant") this.store.incrementUnread(conv.id);
    }
    // R3 事件化：经事件总线到 hub（engine 不再直接依赖传输层广播接口形态）；
    // 未接总线时（测试/渐进迁移期）保持直调兜底
    const payload = {
      type: "chat.message" as const,
      jobId: jobId ?? "",
      agentId,
      content,
      attachment,
      id,
      seq,
    };
    if (this.events) {
      this.events.emit("chat/message", { runId, jobId, agentId, role, content, attachment, id, seq, userId: run?.userId });
    } else {
      this.hub.broadcast(runId, 0, payload);
    }
    // 已送达标记（WS broadcast 后即写，对在线接收方近似正确；离线方补拉后由 sync 机制覆盖）
    this.store.markDelivered([id]);
  }

  private withAgentLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.agentChains.get(agentId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    next.catch(() => { /* suppress unhandled-rejection only */ });
    // 链上只存串行化占位（空值），不持有带结果的 Job（避免长期 agent 常驻大对象）
    this.agentChains.set(agentId, next.then(() => undefined, () => undefined));
    return next;
  }
}
