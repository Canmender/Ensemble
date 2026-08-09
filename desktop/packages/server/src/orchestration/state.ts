import type { JobStatus, RunStatus } from "@ensemble/shared";

/**
 * 状态机纯函数。定义合法的状态流转，供引擎与前端共用。
 *
 * Run:  queued → running → success | error | cancelled
 * Job:  queued → starting → running → success | error | cancelled
 */

export const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["success", "error", "cancelled"],
  success: [],
  error: [],
  cancelled: [],
};

export const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["starting", "running", "cancelled"],
  starting: ["running", "error", "cancelled"],
  running: ["success", "error", "cancelled"],
  success: [],
  error: [],
  cancelled: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalRun(status: RunStatus): boolean {
  return status === "success" || status === "error" || status === "cancelled";
}

export function isTerminalJob(status: JobStatus): boolean {
  return status === "success" || status === "error" || status === "cancelled";
}
