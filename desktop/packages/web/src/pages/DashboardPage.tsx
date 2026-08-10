/**
 * 看板页面 —— 统一任务创建 + 实时监控
 *
 * 简化设计：只有一种创建模式，由 AI 决定是否需要协作
 * 群聊功能在"消息"页面，工作流/群聊执行在"协作画布"页面
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, ArrowRight, Bot, CheckCircle2, ChevronDown, Loader2,
  MessageSquare, Plus, Workflow, Zap, Send,
} from "lucide-react";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import { useRunStore } from "../store/runs";
import { relativeTime } from "../lib/events";
import { loadRunDetail } from "../lib/loadRunDetail";
import type { Agent, Run } from "../types";
import {
  Badge, Button, Card, Input, Label, Modal, Spinner, StatusDot, Textarea, cls, statusLabel,
} from "../components/ui";

// 状态字形
const STATUS_GLYPH: Record<string, string> = {
  queued: "○",
  running: "✽",
  thinking: "✽",
  success: "✓",
  error: "✗",
  cancelled: "–",
};

const modeIcon: Record<string, React.ReactNode> = {
  single: <Zap className="h-3.5 w-3.5" />,
  workflow: <Workflow className="h-3.5 w-3.5" />,
  chat: <MessageSquare className="h-3.5 w-3.5" />,
};
const modeLabel: Record<string, string> = { single: "单发", workflow: "工作流", chat: "群聊" };

// ---------- 统一创建任务 ----------
function CreateTask({ agents, onRun }: { agents: Agent[]; onRun: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string>("");

  useEffect(() => {
    if (agents.length && !selectedAgent) {
      setSelectedAgent(agents[0].id);
    }
  }, [agents]);

  async function submit() {
    if (!prompt.trim() || !selectedAgent) return;
    setBusy(true);
    try {
      // 统一使用 single 模式，由后端 AI 决定是否需要协作
      const r = await api.post<Run>("/tasks", {
        title: prompt.slice(0, 40),
        input: {
          mode: "single",
          prompt,
          agentIds: [selectedAgent],
        },
      });
      setOpen(false);
      setPrompt("");
      onRun(r.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> 新建任务
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="新建任务" wide>
        <div className="space-y-4">
          {/* 选择智能体 */}
          <div>
            <Label>选择智能体</Label>
            <div className="flex flex-wrap gap-2">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedAgent(a.id)}
                  className={cls(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                    selectedAgent === a.id
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "border-border text-muted hover:border-primary/50",
                  )}
                >
                  <Bot className="h-4 w-4" />
                  <div className="text-left">
                    <div>{a.name}</div>
                    <div className="text-[10px] text-muted">{a.model || "未配模型"}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 任务描述 */}
          <div>
            <Label>任务描述</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你的任务... AI 会自动决定是独立完成还是需要与其他智能体协作。"
              rows={4}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  void submit();
                }
              }}
            />
            <p className="mt-1 text-[11px] text-muted">
              💡 提示：如果需要多个智能体协作，可以到"消息"页面创建群聊
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" onClick={submit} disabled={busy || !prompt.trim() || !selectedAgent}>
              {busy ? <Spinner label="创建中" /> : <><Send className="h-4 w-4" /> 提交任务</>}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ---------- 展开详情 ----------
function RunDetail({ runId }: { runId: string }) {
  const live = useRunStore((s) => s.live[runId]);
  const jobs = useMemo(() => Object.values(live?.jobs ?? {}), [live?.jobs]);
  const events = useMemo(() => (live?.events ?? []).slice().sort((a, b) => a.seq - b.seq), [live?.events]);
  const messages = live?.messages ?? [];

  // 协作链
  const orderedJobs = useMemo(() => {
    const jobOrder = [...new Set(events.map((e) => e.jobId).filter(Boolean))] as string[];
    const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));
    const ordered = jobOrder.map((id) => byId[id]).filter(Boolean);
    const rest = jobs.filter((j) => !jobOrder.includes(j.id));
    return [...ordered, ...rest];
  }, [jobs, events]);

  if (!live) return <Spinner label="加载中" />;

  return (
    <div className="space-y-3">
      {/* 协作链 */}
      {orderedJobs.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto rounded-lg bg-bg p-2">
          {orderedJobs.map((j, i) => {
            const nodeColor =
              j.status === "success"
                ? "border-success/40 bg-success/5"
                : j.status === "error"
                  ? "border-destructive/40 bg-destructive/5"
                  : j.status === "running" || j.status === "thinking"
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-surface";
            return (
              <Fragment key={j.id}>
                {i > 0 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted" />}
                <span className={cls("flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs", nodeColor)}>
                  <StatusDot status={j.status} />
                  <Bot className={cls("h-3 w-3", j.status === "error" ? "text-destructive" : "text-primary")} />
                  <span className="font-medium text-fg">{j.agentName}</span>
                  <span className="text-[10px] text-muted">{statusLabel(j.status)}</span>
                </span>
              </Fragment>
            );
          })}
        </div>
      )}

      {/* Jobs */}
      {jobs.length > 0 && (
        <div className="space-y-1.5">
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center gap-2.5 rounded-lg bg-bg px-3 py-2">
              <StatusDot status={j.status} />
              <Bot className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-fg">{j.agentName}</span>
              <span className="text-[10px] text-muted">{statusLabel(j.status)}</span>
              {j.result && (
                <span className="ml-auto max-w-[45%] truncate font-mono text-[11px] text-muted">{j.result}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Chat messages */}
      {messages.length > 0 && (
        <div className="space-y-1.5">
          {messages.map((m, i) => (
            <div key={i} className="flex gap-2 rounded-lg bg-bg px-3 py-2">
              <span className={cls("shrink-0 text-[10px] font-semibold", m.agentId === "user" ? "text-muted" : "text-primary")}>
                {m.agentId === "user" ? "你" : `@${m.agentId}`}
              </span>
              <span className="line-clamp-2 text-xs text-fg">{m.content}</span>
            </div>
          ))}
        </div>
      )}

      {/* Event tail */}
      <div className="max-h-48 overflow-y-auto rounded-lg bg-bg p-3 font-mono text-[11px]">
        {events.length === 0 ? (
          <span className="text-muted">等待事件…</span>
        ) : (
          <div className="space-y-0.5">
            {events.slice(-60).map((item, i) => {
              const ev = item.event as any;
              if (ev.type === "output") {
                return <div key={i} className={cls(ev.kind === "thinking" ? "text-muted/70 italic" : "text-fg")}>{ev.text}</div>;
              }
              if (ev.type === "tool_use") {
                return <div key={i} className="text-amber-600 dark:text-amber-400">🔧 {ev.tool} {JSON.stringify(ev.input ?? {}).slice(0, 60)}</div>;
              }
              if (ev.type === "status") {
                return <div key={i} className="text-muted">· {statusLabel(ev.status)}</div>;
              }
              if (ev.type === "error") {
                return <div key={i} className="text-destructive">✖ {ev.message}</div>;
              }
              return null;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- 运行卡片 ----------
function RunCard({ run, expanded, onToggle }: { run: Run; expanded: boolean; onToggle: () => void }) {
  const live = useRunStore((s) => s.live[run.id]);
  const status = live?.status ?? run.status;
  const finalResult = live?.finalResult ?? run.finalResult;
  const jobs = useMemo(() => Object.values(live?.jobs ?? {}), [live?.jobs]);
  const agents = useMemo(
    () => jobs.map((j) => j.agentName).filter((v, i, a) => a.indexOf(v) === i),
    [jobs],
  );

  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status === "running" || j.status === "thinking" || j.status === "starting"),
    [jobs],
  );
  const activeAgents = useMemo(() => [...new Set(activeJobs.map((j) => j.agentName))], [activeJobs]);
  const waitingInput = useMemo(
    () => live?.events.some(
      (e) => e.event.type === "status" && String(e.event.detail ?? "").includes("等待用户确认"),
    ),
    [live?.events],
  );
  const statusBorder =
    status === "success"
      ? "border-l-success"
      : status === "error" || status === "cancelled"
        ? "border-l-destructive"
        : status === "running" || status === "queued"
          ? "border-l-primary"
          : "border-l-transparent";

  // 确定模式（如果有多个 job 则可能是工作流/群聊）
  const displayMode = jobs.length > 1 ? (run.mode === "chat" ? "chat" : "workflow") : "single";

  return (
    <Card
      className={cls(
        "overflow-hidden border-l-2 transition-all",
        statusBorder,
        expanded ? "shadow-card-hover" : "hover:-translate-y-0.5 hover:shadow-card-hover",
      )}
    >
      <button onClick={onToggle} aria-expanded={expanded} className="w-full px-3.5 py-3 text-left">
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          <span className="text-xs font-bold text-muted/70">{STATUS_GLYPH[status] ?? "·"}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{run.taskTitle ?? "未命名"}</span>
          <Badge color={displayMode === "single" ? "brand" : displayMode === "workflow" ? "violet" : "amber"}>
            {modeLabel[displayMode]}
          </Badge>
          <ChevronDown className={cls("h-4 w-4 shrink-0 text-muted transition-transform", expanded && "rotate-180")} />
        </div>

        {/* agents */}
        {(agents.length > 0 || displayMode !== "single") && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {agents.length > 0 ? (
              agents.map((name) => (
                <span
                  key={name}
                  className={cls(
                    "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                    activeAgents.includes(name)
                      ? "bg-primary text-primary-fg"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  <Bot className="h-2.5 w-2.5" /> {name}
                </span>
              ))
            ) : (
              <span className="text-[10px] text-muted">等待执行</span>
            )}
            <span className="ml-auto text-[10px] text-muted">{relativeTime(run.startedAt)}</span>
          </div>
        )}

        {/* 活跃 agent + HITL 等待输入 */}
        {waitingInput ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-warning">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
            等待输入（需确认工具执行）
          </div>
        ) : activeAgents.length > 0 ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-primary">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            活跃：{activeAgents.join("、")}
          </div>
        ) : null}

        {/* 工作流步骤进度 */}
        {displayMode !== "single" && jobs.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5">
            {jobs.map((j) => (
              <span
                key={j.id}
                className={cls(
                  "h-1 flex-1 rounded-full",
                  j.status === "success"
                    ? "bg-success"
                    : j.status === "error" || j.status === "cancelled"
                      ? "bg-destructive"
                      : j.status === "running" || j.status === "thinking"
                        ? "animate-pulse bg-primary"
                        : "bg-muted/30",
                )}
              />
            ))}
            <span className="text-[10px] text-muted">
              {jobs.filter((j) => j.status === "success").length}/{jobs.length}
            </span>
          </div>
        )}

        {/* summary */}
        {(finalResult || status === "running" || status === "queued") && (
          <div
            className={cls(
              "mt-1.5 line-clamp-2 font-mono text-[11px]",
              status === "success"
                ? "text-success"
                : status === "error"
                  ? "text-destructive"
                  : "text-muted",
            )}
          >
            {finalResult ?? (status === "running" || status === "queued" ? "运行中…" : "")}
          </div>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-3.5 py-3">
          <RunDetail runId={run.id} />
        </div>
      )}
    </Card>
  );
}

// ---------- 看板页 ----------
export default function DashboardPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [r, a] = await Promise.all([api.get<Run[]>("/runs").catch(() => []), api.get<Agent[]>("/agents").catch(() => [])]);
    setRuns(r);
    setAgents(a);
  }, []);

  useEffect(() => {
    wsClient.subscribe("*");
    void refresh();
    const t = setInterval(refresh, 6000);
    return () => {
      wsClient.unsubscribe("*");
      clearInterval(t);
    };
  }, [refresh]);

  const toggleDetail = useCallback(
    async (runId: string) => {
      setExpanded((prev) => (prev === runId ? null : runId));
      await loadRunDetail(runId, { loadEvents: true, loadChatMessages: true });
    },
    [],
  );

  const columns = useMemo(() => {
    return [
      { key: "queued", title: "准备中", color: "text-muted", runs: runs.filter((r) => r.status === "queued") },
      { key: "running", title: "进行中", color: "text-primary", runs: runs.filter((r) => r.status === "running") },
      { key: "done", title: "已完成", color: "text-success", runs: runs.filter((r) => ["success", "error", "cancelled"].includes(r.status)) },
    ];
  }, [runs]);

  const active = columns[1].runs.length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
            <Activity className="h-6 w-6 text-primary" /> 看板
          </h1>
          <p className="mt-1 text-sm text-muted">实时监控任务执行 · AI 自动决定协作方式</p>
        </div>
        <div className="flex items-center gap-2">
          <CreateTask agents={agents} onRun={(id) => setExpanded(id)} />
          <Link to="/workflows">
            <Button variant="secondary">
              <Workflow className="h-4 w-4" /> 协作画布
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-5 grid grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted">全部</div>
          <div className="mt-1 text-2xl font-bold text-fg">{runs.length}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1 text-xs text-muted">○ 准备中</div>
          <div className="mt-1 text-2xl font-bold text-muted">{columns[0].runs.length}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1 text-xs text-muted"><Loader2 className="h-3 w-3 animate-spin" /> 进行中</div>
          <div className="mt-1 text-2xl font-bold text-primary">{active}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1 text-xs text-muted"><CheckCircle2 className="h-3 w-3" /> 已完成</div>
          <div className="mt-1 text-2xl font-bold text-success">{columns[2].runs.length}</div>
        </Card>
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-3 gap-3">
        {columns.map((col) => (
          <div key={col.key} className="min-h-[40vh]">
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className={cls("text-sm font-semibold", col.color)}>{col.title}</span>
              <span className="rounded-full bg-muted/10 px-2 py-0.5 text-xs text-muted">{col.runs.length}</span>
            </div>
            <div className="space-y-2.5">
              {col.runs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted">
                  {col.key === "queued" ? "暂无准备中的任务" : "暂无"}
                </div>
              ) : (
                col.runs.map((r) => (
                  <RunCard
                    key={r.id}
                    run={r}
                    expanded={expanded === r.id}
                    onToggle={() => void toggleDetail(r.id)}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
