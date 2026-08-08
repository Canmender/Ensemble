import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { relativeTime } from "../lib/events";
import type { Agent, Run, Task, TaskMode, WorkflowDef } from "../types";
import {
  Badge, Button, Card, EmptyState, Input, Label, Modal, Select, Spinner, StatusDot, Textarea, cls, statusLabel,
} from "../components/ui";

const MODES: Array<{ value: TaskMode; label: string; icon: string; desc: string }> = [
  { value: "single", label: "单一分发", icon: "🎯", desc: "一个任务发给一个或多个 Agent 并行执行" },
  { value: "workflow", label: "工作流", icon: "🛠️", desc: "DAG 编排：按依赖顺序在多个 Agent 间流转" },
  { value: "chat", label: "群聊", icon: "💬", desc: "多个 Agent 围绕任务轮转对话、委派接力" },
];

const modeLabel: Record<string, string> = { single: "单发", workflow: "工作流", chat: "群聊" };

function CreateTaskDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (runId: string) => void }) {
  const [mode, setMode] = useState<TaskMode>("single");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [maxRounds, setMaxRounds] = useState(3);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      const [a, w] = await Promise.all([api.get<Agent[]>("/agents"), api.get<WorkflowDef[]>("/workflows")]);
      setAgents(a);
      setWorkflows(w ?? []);
      if (a.length) {
        setAgentIds([a[0].id]);
        setParticipantIds(a.slice(0, 2).map((x) => x.id));
      }
      if (w?.length) setWorkflowId(w[0].id);
    })();
  }, []);

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
    setSubmitting(true);
    try {
      const run = await api.post<Run>("/tasks", { title: title || prompt.slice(0, 40), input });
      onCreated(run.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Mode picker */}
      <div>
        <Label>协作模式</Label>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={cls(
                "rounded-xl border p-3 text-left transition-all",
                mode === m.value
                  ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100"
                  : "border-ink-200 hover:border-brand-300",
              )}
            >
              <div className="text-xl">{m.icon}</div>
              <div className="mt-1 text-sm font-medium text-ink-800">{m.label}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-ink-400">{m.desc}</div>
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
                  agentIds.includes(a.id)
                    ? "border-brand-500 bg-brand-50 font-medium text-brand-700"
                    : "border-ink-200 text-ink-600 hover:border-brand-300",
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
              <option key={w.id} value={w.id}>
                {w.name}（{w.nodes.length} 节点）
              </option>
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
                    participantIds.includes(a.id)
                      ? "border-violet-500 bg-violet-50 font-medium text-violet-700"
                      : "border-ink-200 text-ink-600 hover:border-violet-300",
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
        <Label>任务内容</Label>
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} placeholder="描述任务…（工作流中可用 {{task.prompt}} 注入）" />
      </div>

      <div className="flex justify-end gap-3 border-t border-ink-100 pt-4">
        <Button onClick={onClose} variant="ghost">
          取消
        </Button>
        <Button variant="primary" onClick={submit} disabled={submitting || !prompt.trim()}>
          {submitting ? <Spinner label="创建中" /> : "创建并运行"}
        </Button>
      </div>
    </div>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runsByTask, setRunsByTask] = useState<Record<string, Run[]>>({});
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  async function refresh() {
    const [t, r] = await Promise.all([api.get<Task[]>("/tasks"), api.get<Run[]>("/runs")]);
    setTasks(t ?? []);
    const grouped: Record<string, Run[]> = {};
    for (const run of r ?? []) {
      (grouped[run.taskId] ??= []).push(run);
    }
    setRunsByTask(grouped);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function rerun(task: Task) {
    const run = await api.post<Run>(`/tasks/${task.id}/rerun`);
    navigate(`/runs/${run.id}`);
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">任务</h1>
          <p className="mt-1 text-sm text-ink-500">创建与管理多 Agent 协作任务</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          + 新建任务
        </Button>
      </header>

      {tasks.length === 0 ? (
        <Card>
          <EmptyState icon="📋" title="还没有任务" desc="创建一个任务，选择单一分发 / 工作流 / 群聊模式" />
        </Card>
      ) : (
        <div className="space-y-4">
          {tasks.map((t) => {
            const runs = runsByTask[t.id] ?? [];
            const latest = runs[0];
            return (
              <Card key={t.id} className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink-900">{t.title}</span>
                      <Badge color={t.mode === "single" ? "brand" : t.mode === "workflow" ? "violet" : "amber"}>
                        {modeLabel[t.mode]}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-400">
                      创建于 {relativeTime(t.createdAt)} · {runs.length} 次运行
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {latest && (
                      <Link
                        to={`/runs/${latest.id}`}
                        className="flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-600 hover:border-brand-400 hover:text-brand-700"
                      >
                        <StatusDot status={latest.status} />
                        {statusLabel(latest.status)}
                      </Link>
                    )}
                    <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => rerun(t)}>
                      重新运行
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {runs.slice(0, 5).map((r) => (
                    <Link
                      key={r.id}
                      to={`/runs/${r.id}`}
                      className="flex items-center gap-1.5 rounded-md bg-ink-50 px-2 py-1 text-xs text-ink-500 hover:bg-brand-50 hover:text-brand-700"
                    >
                      <StatusDot status={r.status} />
                      {new Date(r.startedAt).toLocaleTimeString("zh-CN", { hour12: false })}
                    </Link>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新建任务" wide>
        <CreateTaskDialog
          onClose={() => setShowCreate(false)}
          onCreated={(runId) => {
            setShowCreate(false);
            navigate(`/runs/${runId}`);
          }}
        />
      </Modal>
    </div>
  );
}
