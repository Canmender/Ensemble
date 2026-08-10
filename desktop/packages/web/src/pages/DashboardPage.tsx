import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity, AlertCircle, ArrowRight, Bot, CheckCircle2, ChevronDown, Loader2,
  MessageSquare, PlayCircle, Plus, Workflow, Zap, Target, Sparkles,
} from "lucide-react";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import { useRunStore } from "../store/runs";
import { relativeTime } from "../lib/events";
import type { Agent, Run, WorkflowDef } from "../types";
import {
  Badge, Button, Card, Input, Label, Modal, Select, Spinner, StatusDot, Textarea, cls, statusLabel,
} from "../components/ui";

// 已加载历史的 run（守卫：仅加载一次，避免 WS 预建 store 导致历史永不加载）
const historyLoaded = new Set<string>();

// 状态字形（Claude Code Agent View ✽/∙ 风格）
const STATUS_GLYPH: Record<string, string> = {
  queued: "○",
  running: "✽",
  thinking: "✽",
  success: "✓",
  error: "✗",
  cancelled: "–",
};

const modeIcon: Record<string, React.ReactNode> = {
  single: <PlayCircle className="h-3.5 w-3.5" />,
  workflow: <Workflow className="h-3.5 w-3.5" />,
  chat: <MessageSquare className="h-3.5 w-3.5" />,
};
const modeLabel: Record<string, string> = { single: "单发", workflow: "工作流", chat: "群聊" };

// ---------- 快速创建（单发） ----------
function QuickCreate({ agents, onRun }: { agents: Agent[]; onRun: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (agents.length && !agentId) setAgentId(agents[0].id);
  }, [agents]);

  async function run() {
    if (!prompt.trim() || !agentId) return;
    setBusy(true);
    try {
      const r = await api.post<Run>("/tasks", {
        title: prompt.slice(0, 40),
        input: { mode: "single", prompt, agentIds: [agentId] },
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
        <Zap className="h-4 w-4" /> 快速运行
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="快速创建任务">
        <div className="space-y-4">
          <div>
            <Select value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={!agents.length}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}（{a.model || "未配模型"}）</option>
              ))}
            </Select>
          </div>
          <Textarea placeholder="给 Agent 的任务…" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" onClick={run} disabled={busy || !prompt.trim()}>
              {busy ? <Spinner label="创建中" /> : "运行"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ---------- 完整创建（详细配置） ----------
function FullCreate({ agents, onRun }: { agents: Agent[]; onRun: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"single" | "workflow" | "chat">("single");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [maxRounds, setMaxRounds] = useState(3);
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (agents.length && !agentIds.length) {
      setAgentIds([agents[0].id]);
      setParticipantIds(agents.slice(0, 2).map((a) => a.id));
    }
    void api.get<WorkflowDef[]>("/workflows").then((w) => {
      setWorkflows(w ?? []);
      if (w?.length) setWorkflowId(w[0].id);
    });
  }, [agents]);

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function submit() {
    if (!prompt.trim()) return;
    let input: any;
    if (mode === "single") {
      if (!agentIds.length) return;
      input = { mode, prompt, agentIds };
    } else if (mode === "workflow") {
      if (!workflowId) return;
      input = { mode, workflowId, prompt };
    } else {
      if (participantIds.length < 2) return;
      input = { mode, prompt, participantIds, maxRounds };
    }
    setBusy(true);
    try {
      const r = await api.post<Run>("/tasks", { title: title || prompt.slice(0, 40), input });
      setOpen(false);
      setTitle("");
      setPrompt("");
      onRun(r.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> 完整创建
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="完整创建任务" wide>
        <div className="space-y-4">
          {/* 模式选择 */}
          <div>
            <Label>协作模式</Label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "single" as const, label: "单一分发", icon: Target, desc: "一个任务发给一个或多个 Agent 并行执行" },
                { value: "workflow" as const, label: "工作流", icon: Workflow, desc: "DAG 编排：按依赖顺序在多个 Agent 间流转" },
                { value: "chat" as const, label: "群聊", icon: MessageSquare, desc: "多个 Agent 围绕任务轮转对话" },
              ].map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={cls(
                    "rounded-xl border p-3 text-left transition-all",
                    mode === m.value ? "border-primary bg-primary/10 ring-2 ring-ring/30" : "border-border hover:border-primary/50",
                  )}
                >
                  <m.icon className="h-5 w-5 text-primary" />
                  <div className="mt-1 text-sm font-medium text-fg">{m.label}</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-muted">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>标题</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="任务标题（可选）" />
          </div>

          {mode === "single" && (
            <div>
              <Label>选择 Agent（可多选，并行执行）</Label>
              <div className="flex flex-wrap gap-2">
                {agents.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAgentIds(toggle(agentIds, a.id))}
                    className={cls(
                      "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                      agentIds.includes(a.id) ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted hover:border-primary/50",
                    )}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === "workflow" && (
            <div>
              <Label>工作流</Label>
              <Select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}（{w.nodes.length} 节点）</option>
                ))}
              </Select>
            </div>
          )}

          {mode === "chat" && (
            <div className="space-y-3">
              <div>
                <Label>参与者（≥2 个）</Label>
                <div className="flex flex-wrap gap-2">
                  {agents.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setParticipantIds(toggle(participantIds, a.id))}
                      className={cls(
                        "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                        participantIds.includes(a.id) ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted hover:border-primary/50",
                      )}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="w-40">
                <Label>最大轮数</Label>
                <Input type="number" min={1} value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))} />
              </div>
            </div>
          )}

          <div>
            <Label>任务描述</Label>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="详细描述任务…" rows={4} />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" onClick={submit} disabled={busy || !prompt.trim()}>
              {busy ? <Spinner label="创建中" /> : "创建任务"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ---------- 展开详情（协作细节） ----------
function RunDetail({ runId }: { runId: string }) {
  const live = useRunStore((s) => s.live[runId]);
  const jobs = useMemo(() => Object.values(live?.jobs ?? {}), [live?.jobs]);
  const events = useMemo(() => (live?.events ?? []).slice().sort((a, b) => a.seq - b.seq), [live?.events]);
  const messages = live?.messages ?? [];

  // 协作链：按事件首次出现顺序排列各 job（工作流/单发协作流转可视化）
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
      {/* 协作链：按执行顺序的 agent 流转（状态色节点） */}
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
  const jobs = Object.values(live?.jobs ?? {});
  const agents = jobs.map((j) => j.agentName).filter((v, i, a) => a.indexOf(v) === i);

  // AI Inbox：活跃 agent（正在工作的）高亮 + 状态色左边框 + HITL 等待输入
  const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "thinking" || j.status === "starting");
  const activeAgents = [...new Set(activeJobs.map((j) => j.agentName))];
  const waitingInput = live?.events.some(
    (e) => e.event.type === "status" && String(e.event.detail ?? "").includes("等待用户确认"),
  );
  const statusBorder =
    status === "success"
      ? "border-l-success"
      : status === "error" || status === "cancelled"
        ? "border-l-destructive"
        : status === "running" || status === "queued"
          ? "border-l-primary"
          : "border-l-transparent";

  return (
    <Card
      className={cls(
        "overflow-hidden border-l-2 transition-all",
        statusBorder,
        expanded ? "shadow-card-hover" : "hover:-translate-y-0.5 hover:shadow-card-hover",
      )}
    >
      <button onClick={onToggle} className="w-full px-3.5 py-3 text-left">
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          <span className="text-xs font-bold text-muted/70">{STATUS_GLYPH[status] ?? "·"}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{run.taskTitle ?? "未命名"}</span>
          <Badge color={run.mode === "single" ? "brand" : run.mode === "workflow" ? "violet" : "amber"}>
            {modeLabel[run.mode]}
          </Badge>
          <ChevronDown className={cls("h-4 w-4 shrink-0 text-muted transition-transform", expanded && "rotate-180")} />
        </div>

        {/* agents */}
        {(agents.length > 0 || run.mode !== "single") && (
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
              <span className="text-[10px] text-muted">{run.mode === "single" ? "1 个 Agent" : "等待执行"}</span>
            )}
            <span className="ml-auto text-[10px] text-muted">{relativeTime(run.startedAt)}</span>
          </div>
        )}

        {/* 活跃 agent + HITL 等待输入（AI Inbox） */}
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

        {/* 工作流步骤进度（与工作流页同步） */}
        {run.mode === "workflow" && jobs.length > 0 && (
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

        {/* summary（结果优先，过程展开看） */}
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

  /** 展开时加载该 run 的历史到 store（WS 只提供实时事件） */
  const toggleDetail = useCallback(
    async (runId: string) => {
      setExpanded((prev) => (prev === runId ? null : runId));
      const store = useRunStore.getState();
      if (historyLoaded.has(runId)) return;
      try {
        const d = await api.get<{ run: Run; jobs: any[]; chatMessages: any[] }>(`/runs/${runId}`);
        store.getOrCreate(runId);
        store.setStatus(runId, d.run.status);
        if (d.run.finalResult) store.setFinal(runId, d.run.finalResult, d.run.error);
        let evSeq = 0;
        for (const job of d.jobs ?? []) {
          store.upsertJob(runId, job.id, {
            agentName: job.agentName,
            status: job.status,
            result: job.result,
            sessionId: job.sessionId,
          });
          for (const ev of job.events ?? []) {
            evSeq -= 1;
            store.appendEvent(runId, { seq: evSeq, jobId: job.id, event: ev });
          }
        }
        for (const m of d.chatMessages ?? []) {
          store.appendMessage(runId, { jobId: m.jobId, agentId: m.agentId, content: m.content });
        }
        historyLoaded.add(runId);
      } catch {
        /* 加载失败不标记，可重试 */
      }
    },
    [],
  );

  const liveAll = useRunStore((s) => s.live);
  const columns = useMemo(() => {
    const waiting = (r: Run) =>
      liveAll[r.id]?.events.some(
        (e) => e.event.type === "status" && String(e.event.detail ?? "").includes("等待用户确认"),
      );
    return [
      { key: "queued", title: "准备中", color: "text-muted", runs: runs.filter((r) => r.status === "queued") },
      { key: "running", title: "进行中", color: "text-primary", runs: runs.filter((r) => r.status === "running" && !waiting(r)) },
      { key: "review", title: "审核中", color: "text-warning", runs: runs.filter((r) => r.status === "running" && waiting(r)) },
      { key: "done", title: "已完成", color: "text-success", runs: runs.filter((r) => ["success", "error", "cancelled"].includes(r.status)) },
    ];
  }, [runs, liveAll]);

  const active = columns[1].runs.length + columns[2].runs.length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
            <Activity className="h-6 w-6 text-primary" /> 看板
          </h1>
          <p className="mt-1 text-sm text-muted">实时监控多 Agent 协作 · 全部任务按状态分列</p>
        </div>
        <div className="flex items-center gap-2">
          <QuickCreate agents={agents} onRun={(id) => setExpanded(id)} />
          <FullCreate agents={agents} onRun={(id) => setExpanded(id)} />
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
          <div className="mt-1 text-2xl font-bold text-success">{columns[3].runs.length}</div>
        </Card>
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-4 gap-3">
        {columns.map((col) => (
          <div key={col.key} className="min-h-[40vh]">
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className={cls("text-sm font-semibold", col.color)}>{col.title}</span>
              <span className="rounded-full bg-muted/10 px-2 py-0.5 text-xs text-muted">{col.runs.length}</span>
            </div>
            <div className="space-y-2.5">
              {col.runs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted">
                  {col.key === "queued" ? "暂无准备中的任务" : col.key === "review" ? "暂无待审核的任务" : "暂无"}
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
