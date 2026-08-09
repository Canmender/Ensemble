import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import { useRunStore } from "../store/runs";
import type { Agent, Run, WorkflowDef } from "../types";
import { Button, Card, Input, Label, Select, Spinner, Textarea, cls, statusLabel } from "../components/ui";

/** 审批面板：头脑风暴通过后放入看板/工作流开始制作 */
function ApprovalPanel({ runTitle, messages }: { runTitle: string; messages: any[] }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [mode, setMode] = useState<"single" | "workflow">("single");
  const [agentId, setAgentId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Run | null>(null);

  useEffect(() => {
    // 默认任务 prompt = 讨论的最后一条 assistant 结论
    const last = [...messages].reverse().find((m) => m.agentId !== "user");
    if (last) setPrompt(last.content.slice(0, 800));
    void api.get<Agent[]>("/agents").then((a) => {
      setAgents(a);
      const enabled = a.find((x) => x.enabled);
      if (enabled) setAgentId(enabled.id);
    });
    void api.get<WorkflowDef[]>("/workflows").then((w) => {
      setWorkflows(w ?? []);
      if (w?.length) setWorkflowId(w[0].id);
    });
  }, []);

  async function approve() {
    if (!prompt.trim()) return;
    setSubmitting(true);
    try {
      const input =
        mode === "single"
          ? { mode: "single" as const, prompt, agentIds: [agentId] }
          : { mode: "workflow" as const, workflowId, prompt };
      const run = await api.post<Run>("/tasks", { title: `${runTitle.slice(0, 30)} → 制作`, input });
      setCreated(run);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-4 border-primary/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold text-fg">审批头脑风暴结果</span>
        <span className="text-xs text-muted">通过后将作为制作任务放入看板 / 工作流</span>
      </div>

      <div className="mb-3">
        <Label>制作任务内容（默认取讨论结论）</Label>
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} />
      </div>

      <div className="mb-3 flex items-end gap-3">
        <div className="w-32">
          <Label>制作方式</Label>
          <Select value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="single">单发</option>
            <option value="workflow">工作流</option>
          </Select>
        </div>
        {mode === "single" ? (
          <div className="flex-1">
            <Label>执行 Agent</Label>
            <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="flex-1">
            <Label>工作流</Label>
            <Select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <Button variant="primary" onClick={approve} disabled={submitting || !prompt.trim()}>
          <ShieldCheck className="h-4 w-4" /> 审批通过，开始制作
        </Button>
      </div>

      {created && (
        <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
          <span>✓ 已创建，已放入看板开始执行</span>
          <Link to={`/runs/${created.id}`} className="text-primary hover:underline">
            查看运行
          </Link>
          <Link to="/" className="text-primary hover:underline">看板</Link>
          <Link to="/workflows" className="text-primary hover:underline">工作流</Link>
        </div>
      )}
    </Card>
  );
}

/** 头脑风暴空间：agent 之间的想法迸发地，不直接参与项目制作 */
export default function ChatPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [rounds, setRounds] = useState(3);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentRun, setCurrentRun] = useState<Run | null>(null);

  const live = useRunStore((s) => (activeRunId ? s.live[activeRunId] : undefined));
  const messages = live?.messages ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.get<Agent[]>("/agents").then((a) => {
      setAgents(a);
      const enabled = a.filter((x) => x.enabled).slice(0, 2);
      if (enabled.length >= 2) setParticipants(enabled.map((x) => x.id));
    });
  }, []);

  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    wsClient.subscribe(activeRunId);
    void api.get<{ run: Run; chatMessages: any[] }>(`/runs/${activeRunId}`).then((d) => {
      if (cancelled) return;
      setCurrentRun(d.run);
      const store = useRunStore.getState();
      store.getOrCreate(activeRunId);
      store.setStatus(activeRunId, d.run.status);
      if (d.run.finalResult) store.setFinal(activeRunId, d.run.finalResult);
      for (const m of d.chatMessages ?? []) {
        store.appendMessage(activeRunId, { jobId: m.jobId, agentId: m.agentId, content: m.content });
      }
    });
    return () => {
      cancelled = true;
      wsClient.unsubscribe(activeRunId);
    };
  }, [activeRunId]);

  // 自动滚动到最新
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  function toggleParticipant(id: string) {
    setParticipants((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function start() {
    if (!topic.trim() || participants.length < 2) return;
    setBusy(true);
    try {
      const run = await api.post<Run>("/tasks", {
        title: `头脑风暴：${topic.slice(0, 30)}`,
        input: { mode: "chat", prompt: topic, participantIds: participants, maxRounds: rounds },
      });
      setActiveRunId(run.id);
      setCurrentRun(run);
    } finally {
      setBusy(false);
    }
  }

  const status = live?.status ?? currentRun?.status;

  return (
    <div className="mx-auto flex max-w-3xl flex-col px-8 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <MessageSquare className="h-6 w-6 text-primary" /> 群聊 · 头脑风暴
        </h1>
        <p className="mt-1 text-sm text-muted">Agent 之间的想法迸发地 —— 项目前期的讨论空间，不直接参与制作</p>
      </header>

      {/* 发起面板 */}
      <Card className="mb-4 p-5">
        <div className="mb-3">
          <div className="mb-1.5 text-xs font-semibold text-muted">参与 Agent（≥2）</div>
          <div className="flex flex-wrap gap-2">
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => toggleParticipant(a.id)}
                className={cls(
                  "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  participants.includes(a.id)
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-border text-muted hover:border-primary/50",
                )}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Input
            className="flex-1"
            placeholder="头脑风暴话题… 如：如何设计一个实时协作看板的 UX？"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <Select className="w-28" value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} 轮
              </option>
            ))}
          </Select>
          <Button variant="primary" onClick={start} disabled={busy || !topic.trim() || participants.length < 2}>
            <Sparkles className="h-4 w-4" /> 开始头脑风暴
          </Button>
        </div>
      </Card>

      {/* 消息流 */}
      {activeRunId ? (
        <Card className="flex min-h-[55vh] flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="text-xs font-medium text-fg">{currentRun?.taskTitle ?? "头脑风暴"}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              {status === "running" || status === "queued" ? (
                <>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                  Agent 们正在讨论…
                </>
              ) : (
                statusLabel(status ?? "")
              )}
            </span>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted/70">等待第一个想法…</div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={cls("flex", m.agentId === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cls(
                      "max-w-[80%] rounded-2xl px-4 py-2.5",
                      m.agentId === "user" ? "bg-primary text-primary-fg" : "bg-bg",
                    )}
                  >
                    {m.agentId !== "user" && (
                      <div className="mb-1 text-[11px] font-semibold text-primary">@{m.agentId}</div>
                    )}
                    <div className={cls("whitespace-pre-wrap text-sm leading-relaxed", m.agentId === "user" ? "" : "text-fg")}>
                      {m.content}
                    </div>
                  </div>
                </div>
              ))
            )}
            {(status === "running" || status === "queued") && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Spinner label="讨论进行中" />
              </div>
            )}
          </div>
        </Card>
      ) : (
        <Card className="flex min-h-[40vh] flex-col items-center justify-center p-8 text-center">
          <MessageSquare className="mb-3 h-8 w-8 text-muted/50" />
          <div className="text-sm text-muted">选择 Agent 并输入话题，开始一场头脑风暴</div>
          <div className="mt-1 max-w-sm text-xs text-muted/70">讨论结果不会直接修改项目，只为前期想法提供灵感</div>
        </Card>
      )}

      {/* 头脑风暴完成 → 审批面板 */}
      {activeRunId && status === "success" && (
        <ApprovalPanel runTitle={currentRun?.taskTitle ?? "头脑风暴"} messages={messages} />
      )}
    </div>
  );
}

