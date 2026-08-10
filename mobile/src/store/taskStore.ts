/**
 * 任务状态管理
 */

import { create } from "zustand";
import type {
  Task,
  Run,
  Job,
  AgentConfig,
  AgentEvent,
  RunStatus,
  JobStatus,
} from "@ensemble/shared-protocol";

// ==================== 事件订阅类型 ====================

/** 任务事件类型 */
export type TaskEventType =
  | "task:added"
  | "task:updated"
  | "run:added"
  | "run:updated"
  | "job:added"
  | "job:updated"
  | "agent:updated"
  | "sync:complete";

/** 任务事件数据 */
export interface TaskEvent {
  type: TaskEventType;
  timestamp: number;
  data: unknown;
}

/** 事件订阅回调 */
type TaskEventCallback = (event: TaskEvent) => void;

// ==================== 选择器类型 ====================

/** 任务摘要（用于列表展示） */
export interface TaskSummary {
  task: Task;
  latestRun: Run | null;
  runCount: number;
  runningJobCount: number;
}

/** Agent 统计 */
export interface AgentStats {
  agent: AgentConfig;
  totalJobs: number;
  runningJobs: number;
  completedJobs: number;
  errorJobs: number;
}

// ==================== Store 接口 ====================

interface TaskStore {
  /** 任务列表 */
  tasks: Task[];
  /** 运行记录 */
  runs: Run[];
  /** 任务详情 */
  jobs: Job[];
  /** Agent 配置 */
  agents: AgentConfig[];
  /** 加载状态 */
  loading: boolean;
  /** 最后同步时间 */
  lastSyncTs: number | null;
  /** 最后事件时间戳 */
  lastEventTs: number | null;

  // Actions
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  removeTask: (taskId: string) => void;
  setRuns: (runs: Run[]) => void;
  addRun: (run: Run) => void;
  updateRun: (runId: string, updates: Partial<Run>) => void;
  removeRun: (runId: string) => void;
  setJobs: (jobs: Job[]) => void;
  addJob: (job: Job) => void;
  updateJob: (jobId: string, updates: Partial<Job>) => void;
  removeJob: (jobId: string) => void;
  setAgents: (agents: AgentConfig[]) => void;
  setLoading: (loading: boolean) => void;
  setLastSyncTs: (ts: number) => void;

  // 事件订阅
  subscribe: (callback: TaskEventCallback) => () => void;

  // 选择器
  getTaskRuns: (taskId: string) => Run[];
  getRunJobs: (runId: string) => Job[];
  getAgentById: (agentId: string) => AgentConfig | undefined;
  getTaskSummaries: () => TaskSummary[];
  getRunningRuns: () => Run[];
  getActiveTasks: () => Task[];
  getRecentTasks: (limit?: number) => Task[];
  getAgentStats: () => AgentStats[];
  getRunsByStatus: (status: RunStatus) => Run[];
  getJobsByStatus: (status: JobStatus) => Job[];
  getRunEvents: (runId: string) => AgentEvent[];
}

// ==================== 事件总线 ====================

const eventListeners = new Set<TaskEventCallback>();

function emitTaskEvent(type: TaskEventType, data: unknown): void {
  const event: TaskEvent = { type, timestamp: Date.now(), data };
  for (const callback of eventListeners) {
    try {
      callback(event);
    } catch (err) {
      console.error("任务事件监听器错误:", err);
    }
  }
}

// ==================== Store 实现 ====================

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  runs: [],
  jobs: [],
  agents: [],
  loading: false,
  lastSyncTs: null,
  lastEventTs: null,

  // ========== 任务 CRUD ==========

  setTasks: (tasks) => {
    set({ tasks });
    emitTaskEvent("task:updated", { count: tasks.length });
  },

  addTask: (task) => {
    set((state) => ({ tasks: [task, ...state.tasks], lastEventTs: Date.now() }));
    emitTaskEvent("task:added", task);
  },

  updateTask: (taskId, updates) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
      lastEventTs: Date.now(),
    }));
    emitTaskEvent("task:updated", { taskId, updates });
  },

  removeTask: (taskId) => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
      // 同时清理关联的 runs 和 jobs
      runs: state.runs.filter((r) => r.taskId !== taskId),
      jobs: state.jobs.filter((j) => {
        const run = state.runs.find((r) => r.id === j.runId);
        return run?.taskId !== taskId;
      }),
      lastEventTs: Date.now(),
    }));
    emitTaskEvent("task:updated", { taskId, removed: true });
  },

  // ========== Run CRUD ==========

  setRuns: (runs) => {
    set({ runs });
    emitTaskEvent("run:updated", { count: runs.length });
  },

  addRun: (run) => {
    set((state) => ({ runs: [run, ...state.runs], lastEventTs: Date.now() }));
    emitTaskEvent("run:added", run);
  },

  updateRun: (runId, updates) => {
    set((state) => ({
      runs: state.runs.map((r) => (r.id === runId ? { ...r, ...updates } : r)),
      lastEventTs: Date.now(),
    }));
    emitTaskEvent("run:updated", { runId, updates });
  },

  removeRun: (runId) => {
    set((state) => ({
      runs: state.runs.filter((r) => r.id !== runId),
      jobs: state.jobs.filter((j) => j.runId !== runId),
      lastEventTs: Date.now(),
    }));
    emitTaskEvent("run:updated", { runId, removed: true });
  },

  // ========== Job CRUD ==========

  setJobs: (jobs) => {
    set({ jobs });
    emitTaskEvent("job:updated", { count: jobs.length });
  },

  addJob: (job) => {
    set((state) => ({ jobs: [job, ...state.jobs], lastEventTs: Date.now() }));
    emitTaskEvent("job:added", job);
  },

  updateJob: (jobId, updates) => {
    set((state) => ({
      jobs: state.jobs.map((j) => (j.id === jobId ? { ...j, ...updates } : j)),
      lastEventTs: Date.now(),
    }));
    emitTaskEvent("job:updated", { jobId, updates });
  },

  removeJob: (jobId) => {
    set((state) => ({
      jobs: state.jobs.filter((j) => j.id !== jobId),
      lastEventTs: Date.now(),
    }));
    emitTaskEvent("job:updated", { jobId, removed: true });
  },

  // ========== Agent ==========

  setAgents: (agents) => {
    set({ agents });
    emitTaskEvent("agent:updated", { count: agents.length });
  },

  // ========== 状态 ==========

  setLoading: (loading) => set({ loading }),
  setLastSyncTs: (lastSyncTs) => {
    set({ lastSyncTs });
    emitTaskEvent("sync:complete", { ts: lastSyncTs });
  },

  // ========== 事件订阅 ==========

  subscribe: (callback) => {
    eventListeners.add(callback);
    return () => {
      eventListeners.delete(callback);
    };
  },

  // ========== 选择器 ==========

  /** 获取任务的所有运行 */
  getTaskRuns: (taskId) => get().runs.filter((r) => r.taskId === taskId),

  /** 获取运行的所有 Job */
  getRunJobs: (runId) => get().jobs.filter((j) => j.runId === runId),

  /** 按 ID 查找 Agent */
  getAgentById: (agentId) => get().agents.find((a) => a.id === agentId),

  /** 获取任务摘要列表（带最新运行状态） */
  getTaskSummaries: () => {
    const { tasks, runs, jobs } = get();
    return tasks.map((task) => {
      const taskRuns = runs.filter((r) => r.taskId === task.id);
      const latestRun = taskRuns.length > 0 ? taskRuns[0] : null;
      const runningJobCount = jobs.filter(
        (j) => j.runId === latestRun?.id && j.status === "running"
      ).length;

      return {
        task,
        latestRun,
        runCount: taskRuns.length,
        runningJobCount,
      };
    });
  },

  /** 获取所有正在运行的 Run */
  getRunningRuns: () => get().runs.filter((r) => r.status === "running"),

  /** 获取有活跃运行的任务 */
  getActiveTasks: () => {
    const { tasks, runs } = get();
    const runningTaskIds = new Set(
      runs.filter((r) => r.status === "running").map((r) => r.taskId)
    );
    return tasks.filter((t) => runningTaskIds.has(t.id));
  },

  /** 获取最近的任务 */
  getRecentTasks: (limit = 10) => {
    return get()
      .tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  },

  /** 获取 Agent 统计信息 */
  getAgentStats: () => {
    const { agents, jobs } = get();
    return agents.map((agent) => {
      const agentJobs = jobs.filter((j) => j.agentId === agent.id);
      return {
        agent,
        totalJobs: agentJobs.length,
        runningJobs: agentJobs.filter((j) => j.status === "running").length,
        completedJobs: agentJobs.filter((j) => j.status === "success").length,
        errorJobs: agentJobs.filter((j) => j.status === "error").length,
      };
    });
  },

  /** 按状态过滤 Run */
  getRunsByStatus: (status) => get().runs.filter((r) => r.status === status),

  /** 按状态过滤 Job */
  getJobsByStatus: (status) => get().jobs.filter((j) => j.status === status),

  /** 获取运行的所有事件（按时间排序） */
  getRunEvents: (runId) => {
    return get()
      .jobs.filter((j) => j.runId === runId)
      .flatMap((j) => j.events)
      .sort((a, b) => a.ts - b.ts);
  },
}));
