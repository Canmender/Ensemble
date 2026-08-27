/**
 * 重连补拉：WS 断线重连成功后的全局增量同步。
 *
 * 服务端事件先落库再广播（WsEnvelope.seq / run_events.seq 单调递增），断线窗口内
 * 错过的事件与状态变化通过 HTTP 补拉端点找回（标准次序：增量拉取 → 原子合并 → 恢复订阅）。
 *
 * 两路补拉：
 *  1. 事件级回填：对本地已有 seq 游标的活跃 run，按 afterSeq 拉取 {seq, jobId, event}
 *     三元组，归并进对应 job.events（游标恰好等于实时已见最大 seq，无重复）。
 *  2. 状态兜底：活跃 run 终态刷新（断线期间结束/出错的 run 不再停留旧状态）。
 *
 * 聊天历史按 seq 增量合并由 ChatRoomPage 消费（chat_messages.seq，v0.8.3+）。
 */
import { wsLink } from "./wslink";
import { api } from "./api";
import { useTaskStore } from "../store/taskStore";

let bootstrapped = false;

/** App 登录后调用一次：注册全局重连补拉动作 */
export function bootstrapResync(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  wsLink.onResync(() => {
    void backfillActiveRuns();
  });
}

/** 对所有活跃（running/queued）run 做事件回填 + 状态兜底 */
async function backfillActiveRuns(): Promise<void> {
  try {
    const { runs } = useTaskStore.getState();
    const activeIds = runs
      .filter((r) => r.status === "running" || r.status === "queued")
      .map((r) => r.id);
    if (activeIds.length === 0) return;
    await Promise.all(activeIds.map((id) => backfillRun(id)));
  } catch {
    /* 补拉失败静默：等下次重连或页面焦点刷新兜底 */
  }
}

async function backfillRun(runId: string): Promise<void> {
  const afterSeq = wsLink.getLastSeq(runId);

  // ① 事件级回填：仅在本地已有实时游标时增量拉取（游标=实时已见最大 seq，严格无重复）。
  //    无游标（订阅后尚未收到任何事件就断线）时跳过，避免把整个历史灌进内存。
  if (afterSeq > 0) {
    try {
      const res = await api.getRunEvents(runId, { afterSeq });
      if (res.data?.events?.length) {
        mergeRunEvents(runId, res.data.events);
      }
      if (typeof res.data?.lastSeq === "number") {
        wsLink.setLastSeq(runId, res.data.lastSeq);
      }
    } catch {
      /* 该 run 回填失败不影响其他 run */
    }
  }

  // ② 状态兜底：run 终态 + job 列表状态（新 job 也会被补进来）
  try {
    const [runRes, jobsRes] = await Promise.all([
      api.getRun(runId).catch(() => null),
      api.getRunJobs(runId).catch(() => null),
    ]);
    const store = useTaskStore.getState();
    if (runRes?.data) {
      store.updateRun(runId, {
        status: runRes.data.status,
        finalResult: runRes.data.finalResult,
        error: runRes.data.error,
      });
    }
    if (jobsRes?.data?.length) {
      const localJobs = new Map(store.jobs.map((j) => [j.id, j]));
      for (const job of jobsRes.data) {
        if (localJobs.has(job.id)) {
          // 只同步状态/结果等字段，不覆盖本地已积累（含刚回填）的事件流
          store.updateJob(job.id, {
            status: job.status,
            result: job.result,
            agentName: job.agentName,
          });
        } else {
          // 断线期间新建的 job：补进 store（events 从回填数据来，此处先置空）
          store.setJobs([...store.jobs, { ...job, events: [] }]);
        }
      }
    }
  } catch {
    /* 状态兜底失败静默 */
  }
}

/** 把补拉回来的事件按 jobId 归并到对应 job.events 尾部（保持 seq 顺序） */
function mergeRunEvents(runId: string, entries: Array<{ seq: number; jobId?: string; event: unknown }>): void {
  const store = useTaskStore.getState();
  const byJob = new Map<string, unknown[]>();
  for (const e of entries) {
    const key = e.jobId ?? "";
    const list = byJob.get(key) ?? [];
    list.push(e.event);
    byJob.set(key, list);
  }
  for (const [jobId, events] of byJob) {
    if (!jobId) continue;
    const job = store.jobs.find((j) => j.id === jobId && j.runId === runId);
    if (!job) continue;
    store.updateJob(jobId, { events: [...job.events, ...(events as never[])] });
  }
}
