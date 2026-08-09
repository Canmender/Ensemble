/**
 * 任务状态管理
 */

import { create } from "zustand";
import type { Task, Run, Job, AgentConfig } from "@ensemble/shared-protocol";

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

  // Actions
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  setRuns: (runs: Run[]) => void;
  addRun: (run: Run) => void;
  updateRun: (runId: string, updates: Partial<Run>) => void;
  setJobs: (jobs: Job[]) => void;
  addJob: (job: Job) => void;
  updateJob: (jobId: string, updates: Partial<Job>) => void;
  setAgents: (agents: AgentConfig[]) => void;
  setLoading: (loading: boolean) => void;
  setLastSyncTs: (ts: number) => void;

  // 计算属性
  getTaskRuns: (taskId: string) => Run[];
  getRunJobs: (runId: string) => Job[];
  getAgentById: (agentId: string) => AgentConfig | undefined;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  runs: [],
  jobs: [],
  agents: [],
  loading: false,
  lastSyncTs: null,

  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set((state) => ({ tasks: [task, ...state.tasks] })),
  updateTask: (taskId, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
    })),
  setRuns: (runs) => set({ runs }),
  addRun: (run) => set((state) => ({ runs: [run, ...state.runs] })),
  updateRun: (runId, updates) =>
    set((state) => ({
      runs: state.runs.map((r) => (r.id === runId ? { ...r, ...updates } : r)),
    })),
  setJobs: (jobs) => set({ jobs }),
  addJob: (job) => set((state) => ({ jobs: [job, ...state.jobs] })),
  updateJob: (jobId, updates) =>
    set((state) => ({
      jobs: state.jobs.map((j) => (j.id === jobId ? { ...j, ...updates } : j)),
    })),
  setAgents: (agents) => set({ agents }),
  setLoading: (loading) => set({ loading }),
  setLastSyncTs: (lastSyncTs) => set({ lastSyncTs }),

  getTaskRuns: (taskId) => get().runs.filter((r) => r.taskId === taskId),
  getRunJobs: (runId) => get().jobs.filter((j) => j.runId === runId),
  getAgentById: (agentId) => get().agents.find((a) => a.id === agentId),
}));
