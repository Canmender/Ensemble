import { Fragment, useEffect, useState } from "react";
import { Bot, ChevronDown, Workflow } from "lucide-react";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import { useRunStore } from "../store/runs";
import { relativeTime } from "../lib/events";
import type { Run } from "../types";
import { Card, Spinner, StatusDot, cls, statusLabel } from "../components/ui";

const historyLoaded = new Set<string>();

async function loadRunDetail(runId: string) {
  if (historyLoaded.has(runId)) return;
  try {
    const d = await api.get<any>(`/runs/${runId}`);
    const store = useRunStore.getState();
    store.getOrCreate(runId);
    store.setStatus(runId, d.run.status);
    if (d.run.finalResult) store.setFinal(runId, d.run.finalResult, d.run.error);
    let evSeq = 0;
    for (const job of d.jobs ?? []) {
      store.upsertJob(runId, job.id, { agentName: job.agentName, status: job.status, result: job.result });
      for (const ev of job.events ?? []) {
        evSeq -= 1; // 负 seq，避免与 WS 真实 seq 冲突/去重错乱
        store.appendEvent(runId, { seq: evSeq, jobId: job.id, event: ev });
      }
    }
    historyLoaded.add(runId);
  } catch {
    /* 失败不标记，可重试 */
  }
}

/** 工作流步骤链：已完成 / 当前 / 待执行，实时递进 */
function WorkflowChain({ runId }: { runId: string }) {
  const live = useRunStore((s) => s.live[runId]);
  const jobs = Object.values(live?.jobs ?? {});
  const events = (live?.events ?? []).slice().sort((a, b) => a.seq - b.seq);
  const order = [...new Set(events.map((e) => e.jobId).filter(Boolean))] as string[];
  const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));
  const ordered = [
    ...order.map((id) => byId[id]).filter(Boolean),
    ...jobs.filter((j) => !order.includes(j.id)),
  ];

  const currentIdx = ordered.findIndex((j) => ["running", "thinking", "starting"].includes(j.status));
  const currentJob = currentIdx >= 0 ? ordered[currentIdx] : undefined;

  return (
    <div className="mt-3">
      {/* 步骤链 */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
        {ordered.map((j, i) => {
          const failed = j.status === "error" || j.status === "cancelled";
          const done = j.status === "success" || failed || (currentIdx >= 0 && i < currentIdx);
          const isCurrent = i === currentIdx;
          return (
            <Fragment key={j.id}>
              {i > 0 && <span className="shrink-0 text-muted">→</span>}
              <div
                className={cls(
                  "flex shrink-0 flex-col items-center gap-0.5 rounded-lg border px-3 py-2 text-center",
                  failed
                    ? "border-destructive/50 bg-destructive/5"
                    : isCurrent
                      ? "border-primary bg-primary/10"
                      : done
                        ? "border-success/40 bg-success/5"
                        : "border-border bg-surface opacity-60",
                )}
              >
                <span className="text-[10px] text-muted">Step {i + 1}</span>
                <Bot className={cls("h-4 w-4", failed ? "text-destructive" : isCurrent ? "text-primary" : done ? "text-success" : "text-muted")} />
                <span className="max-w-[90px] truncate text-xs font-medium text-fg">{j.agentName}</span>
                <span className={cls("text-[10px]", failed ? "text-destructive" : done ? "text-success" : isCurrent ? "text-primary" : "text-muted")}>
                  {failed ? "✗ 失败" : done ? "✓ 完成" : isCurrent ? statusLabel(j.status) : "待执行"}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>

      {/* 当前步骤说明 + 已完成步骤输出 */}
      {currentJob && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-primary">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          当前：Step {currentIdx + 1} · {currentJob.agentName} 正在执行…
        </div>
      )}

      {ordered.map((j, i) => j.result && !["queued", "running", "thinking", "starting"].includes(j.status) && (
        <details key={j.id} className="mt-1 rounded-lg bg-bg p-2 text-xs">
          <summary className={cls("cursor-pointer hover:text-fg", j.status === "error" || j.status === "cancelled" ? "text-destructive" : "text-muted")}>
            Step {i + 1} · {j.agentName} 的输出
          </summary>
          <div className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg">
            {j.result.slice(0, 800)}
          </div>
        </details>
      ))}
    </div>
  );
}

export default function WorkflowsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function refresh() {
    setRuns(await api.get<Run[]>("/runs?mode=workflow").catch(() => []));
  }

  useEffect(() => {
    wsClient.subscribe("*");
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => {
      wsClient.unsubscribe("*");
      clearInterval(t);
    };
  }, []);

  async function toggle(id: string) {
    setExpanded(expanded === id ? null : id);
    await loadRunDetail(id);
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <Workflow className="h-6 w-6 text-primary" /> 工作流
        </h1>
        <p className="mt-1 text-sm text-muted">链式递进：实时查看每个步骤的执行位置、已完成输出与下一步</p>
      </header>

      {runs.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">还没有工作流运行，到"任务"页创建 workflow 模式任务</Card>
      ) : (
        <div className="space-y-3">
          {runs.map((r) => (
            <Card key={r.id} className="p-4">
              <button onClick={() => void toggle(r.id)} className="flex w-full items-center gap-3">
                <StatusDot status={r.status} />
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-medium text-fg">{r.taskTitle}</div>
                  <div className="text-xs text-muted">{relativeTime(r.startedAt)}</div>
                </div>
                <span className="text-xs font-medium text-muted">{statusLabel(r.status)}</span>
                <ChevronDown className={cls("h-4 w-4 text-muted transition-transform", expanded === r.id && "rotate-180")} />
              </button>
              {expanded === r.id && <WorkflowChain runId={r.id} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
