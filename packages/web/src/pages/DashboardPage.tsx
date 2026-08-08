import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { relativeTime } from "../lib/events";
import type { Agent, Run } from "../types";
import { Badge, Button, Card, Input, Select, StatusDot, Spinner, Textarea, statusLabel } from "../components/ui";

const modeLabel: Record<string, string> = { single: "单发", workflow: "工作流", chat: "群聊" };

export default function DashboardPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // 快捷创建
  const [agentId, setAgentId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      const [a, r] = await Promise.all([api.get<Agent[]>("/agents"), api.get<Run[]>("/runs?mode=single")]);
      setAgents(a);
      setRuns(r ?? []);
      if (a.length && !agentId) setAgentId(a[0].id);
      setLoading(false);
    })();
    // 周期刷新最近运行
    const t = setInterval(() => {
      api.get<Run[]>("/runs").then(setRuns).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, []);

  async function quickCreate() {
    if (!prompt.trim() || !agentId) return;
    setSubmitting(true);
    try {
      const run = await api.post<Run>("/tasks", {
        title: prompt.slice(0, 40),
        input: { mode: "single", prompt, agentIds: [agentId] },
      });
      navigate(`/runs/${run.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  const active = runs.filter((r) => r.status === "running" || r.status === "queued").length;

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-ink-900">概览</h1>
        <p className="mt-1 text-sm text-ink-500">多 Agent 协作平台 · 调度 Hermes 与 Claude Code</p>
      </header>

      {/* 统计卡片 */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs font-medium text-ink-400">可用 Agent</div>
          <div className="mt-1 text-3xl font-bold text-ink-900">{agents.length}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-medium text-ink-400">进行中</div>
          <div className="mt-1 flex items-center gap-2 text-3xl font-bold text-ink-900">
            {active}
            {active > 0 && <span className="mb-3 inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" />}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-medium text-ink-400">历史运行</div>
          <div className="mt-1 text-3xl font-bold text-ink-900">{runs.length}</div>
        </Card>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* 快捷创建 */}
        <Card className="p-6">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-ink-900">
            <span>⚡</span> 快捷创建任务
          </h2>
          <div className="space-y-4">
            <div>
              <Select value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={loading || !agents.length}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.kind})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Textarea
                placeholder="给 Agent 的任务描述…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
              />
            </div>
            <Button variant="primary" onClick={quickCreate} disabled={submitting || !prompt.trim()}>
              {submitting ? <Spinner label="创建中" /> : "运行"}
            </Button>
            <Link to="/tasks" className="ml-3 text-xs text-brand-600 hover:underline">
              更多模式（工作流 / 群聊）→
            </Link>
          </div>
        </Card>

        {/* 最近运行 */}
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
              <span>🕘</span> 最近运行
            </h2>
            <Link to="/tasks" className="text-xs text-brand-600 hover:underline">
              查看全部
            </Link>
          </div>
          {loading ? (
            <Spinner label="加载中" />
          ) : runs.length === 0 ? (
            <div className="py-10 text-center text-sm text-ink-400">还没有运行记录</div>
          ) : (
            <ul className="space-y-2">
              {runs.slice(0, 8).map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/runs/${r.id}`}
                    className="flex items-center gap-3 rounded-lg border border-ink-100 px-3 py-2.5 hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    <StatusDot status={r.status} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink-800">
                        {r.taskTitle ?? "未命名任务"}
                      </div>
                      <div className="text-xs text-ink-400">
                        {modeLabel[r.mode] ?? r.mode} · {relativeTime(r.startedAt)}
                      </div>
                    </div>
                    <Badge color={r.status === "success" ? "green" : r.status === "error" ? "red" : r.status === "running" ? "brand" : "ink"}>
                      {statusLabel(r.status)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
