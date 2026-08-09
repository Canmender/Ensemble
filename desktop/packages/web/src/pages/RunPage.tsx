import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Brain, CheckCircle2, Copy, Wrench, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import { useRunStore } from "../store/runs";
import { fmtTime } from "../lib/events";
import type { Run as RunType } from "../types";
import { Badge, Button, Card, Spinner, StatusDot, cls, statusLabel } from "../components/ui";

/** reactflow 动态加载：仅在用户切换到"画布"视图时才加载（~140KB） */
const WorkflowCanvas = lazy(() =>
  Promise.all([
    import("reactflow"),
    import("reactflow/dist/style.css"),
  ]).then(([rf]) => {
    return {
      default: function WorkflowCanvasInner({ jobs }: { jobs: any[] }) {
        const { ReactFlow, Background, Controls } = rf;
        const nodes = useMemo(
          () =>
            jobs.map((j, i) => ({
              id: j.id,
              position: { x: (i % 3) * 210, y: Math.floor(i / 3) * 110 },
              data: { label: j.agentName },
              className: cls(
                "rounded-lg border-2 bg-surface px-3 py-2 font-medium text-fg",
                j.status === "success"
                  ? "!border-success"
                  : j.status === "error"
                    ? "!border-destructive"
                    : j.status === "running" || j.status === "thinking"
                      ? "!border-primary"
                      : "!border-border",
              ),
            })),
          [jobs],
        );
        const edges = useMemo(
          () =>
            jobs.slice(1).map((j, i) => ({
              id: `e-${i}`,
              source: jobs[i].id,
              target: j.id,
              animated: jobs[i].status === "running" || j.status === "running",
            })),
          [jobs],
        );
        return (
          <div className="min-h-0 flex-1" style={{ minHeight: 320 }}>
            <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
              <Background />
              <Controls />
            </ReactFlow>
          </div>
        );
      },
    };
  }),
);

const modeLabel: Record<string, string> = { single: "单一分发", workflow: "工作流", chat: "群聊" };

// ---------- 日志行 ----------
function LogLine({ item }: { item: any }) {
  const ev = item.event;
  const jobId = item.jobId;

  if (ev.type === "tool_use") {
    return (
      <div className="flex gap-2 py-0.5 text-amber-700">
        <span className="w-20 shrink-0 text-right text-[11px] text-muted/70">{fmtTime(ev.ts ?? Date.now())}</span>
        <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="font-mono text-[13px]">
          <span className="font-semibold">{ev.tool}</span>
          <span className="text-muted"> {JSON.stringify(ev.input ?? {}).slice(0, 120)}</span>
        </span>
      </div>
    );
  }

  if (ev.type === "status") {
    return (
      <div className="flex gap-2 py-0.5 text-muted">
        <span className="w-20 shrink-0 text-right text-[11px] text-muted/70">{fmtTime(ev.ts ?? Date.now())}</span>
        <span className="shrink-0">·</span>
        <span className="text-xs">
          {statusLabel(ev.status)}
          {ev.detail ? ` · ${ev.detail}` : ""}
        </span>
      </div>
    );
  }

  if (ev.type === "output") {
    const isThinking = ev.kind === "thinking";
    return (
      <div className="flex gap-2 py-0.5">
        <span className="w-20 shrink-0 text-right text-[11px] text-muted/70">{fmtTime(ev.ts ?? Date.now())}</span>
        <span className={cls("shrink-0", isThinking ? "text-muted/70" : "text-primary")}>
          {isThinking ? <Brain className="h-3.5 w-3.5" /> : <span className="inline-block w-2">▍</span>}
        </span>
        <span className={cls("whitespace-pre-wrap font-mono text-[13px] leading-relaxed", isThinking ? "text-muted italic" : "text-fg")}>
          {ev.text}
        </span>
      </div>
    );
  }

  if (ev.type === "error") {
    return (
      <div className="flex gap-2 py-0.5 text-red-600">
        <span className="w-20 shrink-0 text-right text-[11px] text-muted/70">{fmtTime(ev.ts ?? Date.now())}</span>
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="whitespace-pre-wrap font-mono text-[13px]">{ev.message}</span>
      </div>
    );
  }

  if (ev.type === "done") {
    return (
      <div className="flex gap-2 py-0.5 text-emerald-600">
        <span className="w-20 shrink-0 text-right text-[11px] text-muted/70">{fmtTime(ev.ts ?? Date.now())}</span>
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-medium">
          完成 · {ev.outcome}
          {ev.usage?.totalCostUsd ? ` · $${ev.usage.totalCostUsd.toFixed(4)}` : ""}
        </span>
      </div>
    );
  }

  return null;
}

// ---------- 工具时间线（n8n/agenttrace 模式：工具调用链） ----------
function ToolTimeline({ items }: { items: any[] }) {
  const steps = items.filter(
    (it) =>
      it.event.type === "tool_use" ||
      it.event.type === "tool_result" ||
      it.event.type === "done",
  );
  if (steps.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted/70">
        还没有工具调用
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto bg-bg/40 p-3 font-mono text-[12px]">
      <div className="space-y-1.5">
        {steps.map((it, i) => {
          const ev = it.event as any;
          if (ev.type === "tool_use") {
            return (
              <div key={i} className="flex gap-2">
                <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0">
                  <span className="font-semibold text-fg">{ev.tool}</span>
                  <span className="ml-2 text-muted">{JSON.stringify(ev.input ?? {}).slice(0, 120)}</span>
                </div>
              </div>
            );
          }
          if (ev.type === "tool_result") {
            return (
              <div key={i} className="line-clamp-2 pl-6 text-[11px] text-muted">
                {String(ev.output ?? "").slice(0, 160)}
              </div>
            );
          }
          if (ev.type === "done") {
            return (
              <div key={i} className="pt-1 text-[11px] font-medium text-success">
                ✓ 完成 · {ev.outcome}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const runId = id!;
  const navigate = useNavigate();
  const live = useRunStore((s) => s.live[runId]);
  const [run, setRun] = useState<RunType | null>(null);
  const [loaded, setLoaded] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [collapseLog, setCollapseLog] = useState(false);
  const [view, setView] = useState<"log" | "timeline" | "canvas">("log");

  /** 会话续跑：用前次结果作为 context 创建新任务（single 模式） */
  async function continueTask() {
    if (!run) return;
    try {
      const task = await api.get<any>(`/tasks/${run.taskId}`);
      const input = task.input;
      const prevResult = live?.finalResult ?? run.finalResult;
      if (input?.mode === "single") {
        const newRun = await api.post<any>("/tasks", {
          title: `${run.taskTitle ?? "任务"}（续）`,
          input: {
            mode: "single",
            prompt: `继续上次任务。之前的结果：\n${prevResult ?? "(无)"}\n\n请基于以上继续处理或给出下一步。`,
            agentIds: input.agentIds,
          },
        });
        navigate(`/runs/${newRun.id}`);
      }
    } catch {
      /* 忽略 */
    }
  }

  useEffect(() => {
    setRun(null);
    setLoaded(false);
    wsClient.subscribe(runId);
    void api.get<{ run: RunType; jobs: any[]; chatMessages: any[] }>(`/runs/${runId}`).then((d) => {
      setRun(d.run);
      const store = useRunStore.getState();
      store.getOrCreate(runId);
      store.setStatus(runId, d.run.status);
      if (d.run.finalResult) store.setFinal(runId, d.run.finalResult, d.run.error);
      // 历史 events 由 wsClient.subscribe 的 catchUp（/events?afterSeq=）补拉
      for (const job of d.jobs ?? []) {
        store.upsertJob(runId, job.id, {
          agentId: job.agentId,
          agentName: job.agentName,
          status: job.status,
          result: job.result,
          sessionId: job.sessionId,
        });
      }
      for (const m of d.chatMessages ?? []) {
        store.appendMessage(runId, { jobId: m.jobId, agentId: m.agentId, content: m.content });
      }
      setLoaded(true);
    });
    return () => wsClient.unsubscribe(runId);
  }, [runId]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [live?.events.length, autoScroll]);

  // 按 seq 排序的事件（合并所有 job）
  const sortedEvents = useMemo(() => {
    return (live?.events ?? []).slice().sort((a, b) => a.seq - b.seq);
  }, [live?.events]);

  const jobs = useMemo(() => Object.values(live?.jobs ?? {}), [live?.jobs]);
  const messages = live?.messages ?? [];

  // 长任务日志限制（只渲染最近 800 条，避免 DOM 爆炸）
  const LOG_LIMIT = 800;
  const hiddenCount = sortedEvents.length > LOG_LIMIT ? sortedEvents.length - LOG_LIMIT : 0;
  const visibleEvents = hiddenCount ? sortedEvents.slice(-LOG_LIMIT) : sortedEvents;

  const status = live?.status ?? run?.status ?? "queued";
  const isChat = run?.mode === "chat";

  if (!loaded && !run) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="加载运行…" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-muted hover:text-fg">←</Link>
          <h1 className="text-lg font-bold text-fg">{run?.taskTitle ?? "运行"}</h1>
          <Badge color={run?.mode === "single" ? "brand" : run?.mode === "workflow" ? "violet" : "amber"}>
            {modeLabel[run?.mode ?? ""]}
          </Badge>
          <span className="flex items-center gap-1.5 text-sm">
            <StatusDot status={status} />
            <span className="font-medium text-fg">{statusLabel(status)}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {status === "running" || status === "queued" ? (
            <Button variant="danger" onClick={() => wsClient.cancel(runId)}>
              取消
            </Button>
          ) : (
            (live?.finalResult || run?.finalResult) && (
              <Button variant="secondary" onClick={() => void continueTask()} className="text-xs">
                继续对话
              </Button>
            )
          )}
          <Button
            variant="ghost"
            onClick={() => setAutoScroll((v) => !v)}
            className="text-xs"
          >
            {autoScroll ? "自动滚动 ✓" : "自动滚动"}
          </Button>
        </div>
      </div>

      {isChat ? (
        /* Chat 视图 */
        <Card className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={cls("flex", m.agentId === "user" ? "justify-end" : "justify-start")}>
                <div className={cls("max-w-[80%] rounded-2xl px-4 py-2.5", m.agentId === "user" ? "bg-primary text-white" : "bg-muted/10")}>
                  {m.agentId !== "user" && (
                    <div className="mb-1 text-[11px] font-semibold text-violet-600">@{m.agentId}</div>
                  )}
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</div>
                </div>
              </div>
            ))}
            {(status === "running" || status === "queued") && (
              <div className="flex items-center gap-2 text-muted">
                <Spinner label="Agent 们正在对话…" />
              </div>
            )}
          </div>
        </Card>
      ) : (
        /* Job 列表 + 日志 + 结果 */
        <div className="grid flex-1 min-h-0 grid-cols-[240px_1fr_300px] gap-4">
          {/* Jobs */}
          <Card className="overflow-y-auto p-3">
            <div className="mb-2 px-1 text-xs font-semibold text-muted">执行单元</div>
            {jobs.length === 0 ? (
              <div className="px-1 text-xs text-muted/70">暂无</div>
            ) : (
              <ul className="space-y-1.5">
                {jobs.map((j) => (
                  <li key={j.id}>
                    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-bg">
                      <StatusDot status={j.status} />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-fg">{j.agentName}</div>
                        <div className="text-[10px] text-muted">#{j.id.slice(-6)}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Log / Timeline（ChatDB 结果优先 + n8n 工具时间线） */}
          <Card className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-semibold text-muted">
                {view === "log" ? "过程日志" : view === "timeline" ? "工具时间线" : "协作画布"}
              </span>
              <div className="flex items-center gap-1.5">
                {view === "log" && !collapseLog && (
                  <span className="text-[11px] text-muted/70">{sortedEvents.length} 条事件</span>
                )}
                <div className="flex overflow-hidden rounded-md border border-border text-[11px]">
                  {(["log", "timeline", "canvas"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={cls(
                        "px-1.5 py-0.5 transition-colors",
                        view === v ? "bg-primary text-primary-fg" : "text-muted hover:bg-muted/10 hover:text-fg",
                      )}
                    >
                      {v === "log" ? "日志" : v === "timeline" ? "时间线" : "画布"}
                    </button>
                  ))}
                </div>
                {view === "log" && (
                  <button
                    onClick={() => setCollapseLog((v) => !v)}
                    className="rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-muted/10 hover:text-fg"
                  >
                    {collapseLog ? "展开过程" : "折叠过程"}
                  </button>
                )}
              </div>
            </div>
            {view === "timeline" ? (
              <ToolTimeline items={sortedEvents} />
            ) : view === "canvas" ? (
              <Suspense fallback={<div className="flex flex-1 items-center justify-center text-xs text-muted"><Spinner label="加载画布…" /></div>}>
                <WorkflowCanvas jobs={jobs} />
              </Suspense>
            ) : collapseLog ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
                <span className="text-xs text-muted">过程日志已折叠，聚焦结果</span>
                {!live?.finalResult && <span className="text-[11px] text-muted/70">运行中，日志仍在记录</span>}
              </div>
            ) : (
              <div ref={logRef} className="flex-1 overflow-y-auto bg-bg/40 p-3 font-mono text-[13px]">
                {sortedEvents.length === 0 ? (
                  <div className="text-xs text-muted/70">等待事件…</div>
                ) : (
                  <>
                    {hiddenCount > 0 && (
                      <div className="py-1 text-[11px] text-muted/70">… 前面 {hiddenCount} 条事件已折叠</div>
                    )}
                    {visibleEvents.map((item, i) => <LogLine key={i} item={item} />)}
                  </>
                )}
              </div>
            )}
          </Card>

          {/* Result */}
          <Card className="flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-semibold text-muted">结果</span>
              {live?.finalResult && (
                <button
                  onClick={() => void navigator.clipboard.writeText(live.finalResult ?? "")}
                  className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-muted/10 hover:text-fg"
                  title="复制结果"
                >
                  <Copy className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {live?.error ? (
                <div className="whitespace-pre-wrap text-sm text-destructive">{live.error}</div>
              ) : live?.finalResult ? (
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{live.finalResult}</div>
              ) : (
                <div className="text-xs text-muted/70">运行完成前此处显示最终结果</div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
