import { create } from "zustand";

export interface AgentEventItem {
  seq: number;
  jobId?: string;
  event: {
    type: string;
    ts?: number;
    text?: string;
    kind?: string;
    tool?: string;
    input?: unknown;
    outcome?: string;
    result?: string;
    message?: string;
    status?: string;
    detail?: string;
    usage?: { totalCostUsd?: number; [k: string]: unknown };
    output?: string;
    [k: string]: unknown;
  };
}

export interface LiveJob {
  id: string;
  agentId: string;
  agentName: string;
  status: string;
  events: AgentEventItem[];
  result?: string;
  sessionId?: string;
  prompt?: string;
}

export interface ToolConfirmRequest {
  confirmId: string;
  tool: string;
  args: unknown;
}

export interface LiveRun {
  status: string;
  jobs: Record<string, LiveJob>;
  events: AgentEventItem[];
  messages: Array<{ jobId?: string; agentId: string; content: string }>;
  finalResult?: string;
  error?: string;
  /** 待确认的工具调用（HITL） */
  pendingConfirm?: ToolConfirmRequest;
}

/** 每 run 已消费的 event seq（去重：catchUp 与 WS 推送可能重叠） */
const seenSeqs = new Map<string, Set<number>>();

/** 事件缓冲：高频 token 流合并渲染（50ms 节流，避免每 token 一次 setState） */
const pendingEvents = new Map<string, AgentEventItem[]>();
let flushTimer: number | undefined;

function flushPending(): void {
  flushTimer = undefined;
  if (pendingEvents.size === 0) return;
  useRunStore.setState((s) => {
    const live = { ...s.live };
    for (const [runId, items] of pendingEvents) {
      const run = live[runId];
      if (!run) continue;
      let seen = seenSeqs.get(runId);
      if (!seen) {
        seen = new Set();
        seenSeqs.set(runId, seen);
      }
      const fresh = items.filter((i) => !seen.has(i.seq));
      if (!fresh.length) continue;
      for (const i of fresh) seen.add(i.seq);
      const jobs = { ...run.jobs };
      for (const item of fresh) {
        if (item.jobId && jobs[item.jobId]) {
          jobs[item.jobId] = { ...jobs[item.jobId], events: [...jobs[item.jobId].events, item] };
        }
      }
      // 裁剪事件（保留最近 2000 条，避免长会话无限增长）
      live[runId] = { ...run, jobs, events: [...run.events, ...fresh].slice(-2000) };
    }
    pendingEvents.clear();
    return { live };
  });
}

interface RunStore {
  live: Record<string, LiveRun>;
  getOrCreate: (runId: string) => LiveRun;
  setStatus: (runId: string, status: string) => void;
  upsertJob: (runId: string, jobId: string, patch: Partial<LiveJob>) => void;
  appendEvent: (runId: string, item: AgentEventItem) => void;
  appendMessage: (runId: string, m: LiveRun["messages"][number]) => void;
  setFinal: (runId: string, finalResult?: string, error?: string) => void;
  setPendingConfirm: (runId: string, confirm: ToolConfirmRequest) => void;
  clearPendingConfirm: (runId: string) => void;
}

function blankRun(): LiveRun {
  return { status: "queued", jobs: {}, events: [], messages: [] };
}

export const useRunStore = create<RunStore>((set, get) => ({
  live: {},

  getOrCreate(runId) {
    const existing = get().live[runId];
    if (existing) return existing;
    const run = blankRun();
    set((s) => ({ live: { ...s.live, [runId]: run } }));
    return run;
  },

  setStatus(runId, status) {
    set((s) => ({
      live: { ...s.live, [runId]: { ...s.live[runId], status } },
    }));
  },

  upsertJob(runId, jobId, patch) {
    set((s) => {
      const run = s.live[runId];
      if (!run) return s;
      const job = run.jobs[jobId] ?? {
        id: jobId,
        agentId: patch.agentId ?? "",
        agentName: patch.agentName ?? "",
        status: "queued",
        events: [],
      };
      return {
        live: {
          ...s.live,
          [runId]: { ...run, jobs: { ...run.jobs, [jobId]: { ...job, ...patch } } },
        },
      };
    });
  },

  appendEvent(runId, item) {
    // 入缓冲，50ms 节流合并（高频 token 流只触发一次渲染批次）
    const list = pendingEvents.get(runId) ?? [];
    list.push(item);
    pendingEvents.set(runId, list);
    if (flushTimer === undefined) {
      flushTimer = window.setTimeout(flushPending, 50);
    }
  },

  appendMessage(runId, m) {
    set((s) => {
      const run = s.live[runId];
      if (!run) return s;
      return { live: { ...s.live, [runId]: { ...run, messages: [...run.messages, m] } } };
    });
  },

  setFinal(runId, finalResult, error) {
    set((s) => {
      const run = s.live[runId];
      if (!run) return s;
      return {
        live: {
          ...s.live,
          [runId]: { ...run, finalResult: finalResult ?? run.finalResult, error: error ?? run.error },
        },
      };
    });
  },

  setPendingConfirm(runId, confirm) {
    set((s) => {
      const run = s.live[runId];
      if (!run) return s;
      return { live: { ...s.live, [runId]: { ...run, pendingConfirm: confirm } } };
    });
  },

  clearPendingConfirm(runId) {
    set((s) => {
      const run = s.live[runId];
      if (!run) return s;
      return { live: { ...s.live, [runId]: { ...run, pendingConfirm: undefined } } };
    });
  },
}));
