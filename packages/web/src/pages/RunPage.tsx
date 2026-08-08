import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import { useRunStore } from "../store/runs";
import { fmtTime } from "../lib/events";
import type { Run as RunType } from "../types";
import { Badge, Button, Card, Spinner, StatusDot, cls, statusLabel } from "../components/ui";

const modeLabel: Record<string, string> = { single: "单一分发", workflow: "工作流", chat: "群聊" };

// ---------- 日志行 ----------
function LogLine({ item }: { item: any }) {
  const ev = item.event;
  const jobId = item.jobId;

  if (ev.type === "tool_use") {
    return (
      <div className="flex gap-2 py-0.5 text-amber-700">
        <span className="w-20 shrink-0 text-right text-[11px] text-ink-300">{fmtTime(ev.ts ?? Date.now())}</span>
        <span className="shrink-0">🔧</span>
        <span className="font-mono text-[13px]">
          <span className="font-semibold">{ev.tool}</span>
          <span className="text-ink-400"> {JSON.stringify(ev.input ?? {}).slice(0, 120)}</span>
        </span>
      </div>
    );
  }

  if (ev.type === "status") {
    return (
      <div className="flex gap-2 py-0.5 text-ink-400">
        <span className="w-20 shrink-0 text-right text-[11px] text-ink-300">{fmtTime(ev.ts ?? Date.now())}</span>
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
        <span className="w-20 shrink-0 text-right text-[11px] text-ink-300">{fmtTime(ev.ts ?? Date.now())}</span>
        <span className={cls("shrink-0", isThinking ? "text-ink-300" : "text-brand-500")}>{isThinking ? "💭" : "▍"}</span>
        <span className={cls("whitespace-pre-wrap font-mono text-[13px] leading-relaxed", isThinking ? "text-ink-400 italic" : "text-ink-800")}>
          {ev.text}
        </span>
      </div>
    );
  }

  if (ev.type === "error") {
    return (
      <div className="flex gap-2 py-0.5 text-red-600">
        <span className="w-20 shrink-0 text-right text-[11px] text-ink-300">{fmtTime(ev.ts ?? Date.now())}</span>
        <span className="shrink-0">✖</span>
        <span className="whitespace-pre-wrap font-mono text-[13px]">{ev.message}</span>
      </div>
    );
  }

  if (ev.type === "done") {
    return (
      <div className="flex gap-2 py-0.5 text-emerald-600">
        <span className="w-20 shrink-0 text-right text-[11px] text-ink-300">{fmtTime(ev.ts ?? Date.now())}</span>
        <span className="shrink-0">✓</span>
        <span className="text-xs font-medium">
          完成 · {ev.outcome}
          {ev.usage?.totalCostUsd ? ` · $${ev.usage.totalCostUsd.toFixed(4)}` : ""}
        </span>
      </div>
    );
  }

  return null;
}

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const runId = id!;
  const live = useRunStore((s) => s.live[runId]);
  const [run, setRun] = useState<RunType | null>(null);
  const [loaded, setLoaded] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

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
          <Link to="/" className="text-ink-400 hover:text-ink-600">←</Link>
          <h1 className="text-lg font-bold text-ink-900">{run?.taskTitle ?? "运行"}</h1>
          <Badge color={run?.mode === "single" ? "brand" : run?.mode === "workflow" ? "violet" : "amber"}>
            {modeLabel[run?.mode ?? ""]}
          </Badge>
          <span className="flex items-center gap-1.5 text-sm">
            <StatusDot status={status} />
            <span className="font-medium text-ink-700">{statusLabel(status)}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {status === "running" || status === "queued" ? (
            <Button variant="danger" onClick={() => wsClient.cancel(runId)}>
              取消
            </Button>
          ) : null}
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
                <div className={cls("max-w-[80%] rounded-2xl px-4 py-2.5", m.agentId === "user" ? "bg-brand-600 text-white" : "bg-ink-100")}>
                  {m.agentId !== "user" && (
                    <div className="mb-1 text-[11px] font-semibold text-violet-600">@{m.agentId}</div>
                  )}
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</div>
                </div>
              </div>
            ))}
            {(status === "running" || status === "queued") && (
              <div className="flex items-center gap-2 text-ink-400">
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
            <div className="mb-2 px-1 text-xs font-semibold text-ink-400">执行单元</div>
            {jobs.length === 0 ? (
              <div className="px-1 text-xs text-ink-300">暂无</div>
            ) : (
              <ul className="space-y-1.5">
                {jobs.map((j) => (
                  <li key={j.id}>
                    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-ink-50">
                      <StatusDot status={j.status} />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-ink-700">{j.agentName}</div>
                        <div className="text-[10px] text-ink-400">#{j.id.slice(-6)}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Log */}
          <Card className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2">
              <span className="text-xs font-semibold text-ink-400">实时日志</span>
              <span className="text-[11px] text-ink-300">{sortedEvents.length} 条事件</span>
            </div>
            <div ref={logRef} className="flex-1 overflow-y-auto bg-ink-50/40 p-3 font-mono text-[13px]">
              {sortedEvents.length === 0 ? (
                <div className="text-xs text-ink-300">等待事件…</div>
              ) : (
                sortedEvents.map((item, i) => <LogLine key={i} item={item} />)
              )}
            </div>
          </Card>

          {/* Result */}
          <Card className="flex flex-col overflow-hidden">
            <div className="border-b border-ink-100 px-3 py-2 text-xs font-semibold text-ink-400">结果</div>
            <div className="flex-1 overflow-y-auto p-3">
              {live?.error ? (
                <div className="whitespace-pre-wrap text-sm text-red-600">{live.error}</div>
              ) : live?.finalResult ? (
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">{live.finalResult}</div>
              ) : (
                <div className="text-xs text-ink-300">运行完成前此处显示最终结果</div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
