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
}

export interface LiveRun {
  status: string;
  jobs: Record<string, LiveJob>;
  events: AgentEventItem[];
  messages: Array<{ jobId?: string; agentId: string; content: string }>;
  finalResult?: string;
  error?: string;
}

interface RunStore {
  live: Record<string, LiveRun>;
  getOrCreate: (runId: string) => LiveRun;
  setStatus: (runId: string, status: string) => void;
  upsertJob: (runId: string, jobId: string, patch: Partial<LiveJob>) => void;
  appendEvent: (runId: string, item: AgentEventItem) => void;
  appendMessage: (runId: string, m: LiveRun["messages"][number]) => void;
  setFinal: (runId: string, finalResult?: string, error?: string) => void;
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
    set((s) => {
      const run = s.live[runId];
      if (!run) return s;
      const jobs = { ...run.jobs };
      if (item.jobId && jobs[item.jobId]) {
        jobs[item.jobId] = { ...jobs[item.jobId], events: [...jobs[item.jobId].events, item] };
      }
      return {
        live: { ...s.live, [runId]: { ...run, jobs, events: [...run.events, item] } },
      };
    });
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
}));
