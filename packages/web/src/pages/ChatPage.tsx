import { useEffect, useRef, useState } from "react";
import { MessageSquare, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import { useRunStore } from "../store/runs";
import type { Agent, Run } from "../types";
import { Button, Card, Input, Select, Spinner, Textarea, cls, statusLabel } from "../components/ui";

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
    </div>
  );
}

